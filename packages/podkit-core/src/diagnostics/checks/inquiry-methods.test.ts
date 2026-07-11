/**
 * Unit tests for iPod Firmware Inquiry Methods diagnostic check
 *
 * The `checkInquiryMethods` pure function accepts an injected probe function,
 * so no real filesystem or native bindings are touched.
 */

import { describe, it, expect } from 'bun:test';
import { checkInquiryMethods, inquiryMethodsCheck } from './inquiry-methods.js';
import type { ProbeFn } from './inquiry-methods.js';
import type { InquiryMethodsAvailability } from '@podkit/ipod-firmware';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAvailability(
  scsiAvailable: boolean,
  usbAvailable: boolean,
  scsiReason?: string,
  usbReason?: string
): InquiryMethodsAvailability {
  return {
    scsi: { available: scsiAvailable, ...(scsiReason ? { reason: scsiReason } : {}) },
    usb: { available: usbAvailable, ...(usbReason ? { reason: usbReason } : {}) },
  };
}

function makeProbe(a: InquiryMethodsAvailability): ProbeFn {
  return async () => a;
}

// ── Check metadata ────────────────────────────────────────────────────────────

describe('inquiryMethodsCheck metadata', () => {
  it('has correct id and scope', () => {
    expect(inquiryMethodsCheck.id).toBe('inquiry-methods');
    expect(inquiryMethodsCheck.name).toBe('iPod Firmware Inquiry Methods');
    expect(inquiryMethodsCheck.scope).toBe('system');
    // iPod-only — the SCSI/USB inquiry transports it probes are
    // specific to iPod firmware, so it must not run on mass-storage devices.
    expect(inquiryMethodsCheck.applicableTo).toEqual(['ipod']);
    expect(inquiryMethodsCheck.repair).toBeUndefined();
  });
});

// ── Status derivation ─────────────────────────────────────────────────────────

describe('checkInquiryMethods status', () => {
  it('pass when USB is available (SCSI also up)', async () => {
    const probe = makeProbe(makeAvailability(true, true));
    const result = await checkInquiryMethods(probe, 'darwin');
    expect(result.status).toBe('pass');
    expect(result.repairable).toBe(false);
  });

  it('pass when USB is available but SCSI is down (Linux without /dev/sg*)', async () => {
    // A Linux host with working USB but no SCSI generic devices must not warn.
    const probe = makeProbe(
      makeAvailability(
        false,
        true,
        'no /dev/sg* nodes present — SCSI inquiry unavailable (no SCSI generic devices on this system)'
      )
    );
    const result = await checkInquiryMethods(probe, 'linux');
    expect(result.status).toBe('pass');
  });

  it('warn when USB is down and SCSI is available (SCSI fallback active)', async () => {
    const probe = makeProbe(makeAvailability(true, false, undefined, 'libusb not loadable'));
    const result = await checkInquiryMethods(probe, 'linux');
    expect(result.status).toBe('warn');
  });

  it('warn when both USB and SCSI are down', async () => {
    const probe = makeProbe(
      makeAvailability(false, false, 'iPodDriver.kext not present', 'libusb not loadable')
    );
    const result = await checkInquiryMethods(probe, 'darwin');
    expect(result.status).toBe('warn');
  });
});

// ── Summary text ──────────────────────────────────────────────────────────────

describe('checkInquiryMethods summary', () => {
  it('macOS pass with both up: mentions USB and kext', async () => {
    const probe = makeProbe(makeAvailability(true, true));
    const result = await checkInquiryMethods(probe, 'darwin');
    expect(result.summary).toContain('USB inquiry available');
    expect(result.summary).toContain('iPodDriver.kext present');
  });

  it('Linux pass with both up: mentions USB and sg*', async () => {
    const probe = makeProbe(makeAvailability(true, true));
    const result = await checkInquiryMethods(probe, 'linux');
    expect(result.summary).toContain('USB inquiry available');
    expect(result.summary).toContain('/dev/sg* present');
  });

  it('USB down + SCSI up: summary surfaces USB failure', async () => {
    const probe = makeProbe(
      makeAvailability(
        true,
        false,
        undefined,
        'libusb not loadable: libudev.so.1: cannot open shared object file'
      )
    );
    const result = await checkInquiryMethods(probe, 'linux');
    expect(result.summary).toContain('USB transport unavailable');
    expect(result.summary).toContain('SCSI fallback active');
    expect(result.summary).toContain('libudev.so.1');
  });

  it('USB up + SCSI down (kext): mentions kext inactive', async () => {
    const probe = makeProbe(
      makeAvailability(false, true, 'iPodDriver.kext not present — SCSI inquiry unavailable')
    );
    const result = await checkInquiryMethods(probe, 'darwin');
    expect(result.summary).toContain('USB inquiry available');
    expect(result.summary).toContain('iPodDriver.kext not present');
  });

  it('USB up + SCSI down (no sg* on Linux): mentions no sg nodes', async () => {
    const probe = makeProbe(
      makeAvailability(
        false,
        true,
        'no /dev/sg* nodes present — SCSI inquiry unavailable (no SCSI generic devices on this system)'
      )
    );
    const result = await checkInquiryMethods(probe, 'linux');
    expect(result.summary).toContain('USB inquiry available');
    expect(result.summary).toContain('no /dev/sg*');
  });

  it('USB up + SCSI not readable: surfaces permission requirement', async () => {
    const probe = makeProbe(
      makeAvailability(
        false,
        true,
        '/dev/sg* present but not readable by current uid (gid plugdev or sudo required)'
      )
    );
    const result = await checkInquiryMethods(probe, 'linux');
    expect(result.summary).toContain('USB inquiry available');
    expect(result.summary).toContain('not readable');
    expect(result.summary).toContain('plugdev');
  });

  it('both down: mentions both USB and SCSI unavailable', async () => {
    const probe = makeProbe(
      makeAvailability(false, false, 'iPodDriver.kext not present', 'libusb not loadable')
    );
    const result = await checkInquiryMethods(probe, 'darwin');
    expect(result.summary).toContain('USB and SCSI inquiry both unavailable');
    expect(result.summary).toContain('libusb not loadable');
  });
});

// ── Details structure ─────────────────────────────────────────────────────────

describe('checkInquiryMethods details', () => {
  it('details contains scsi, usb, plan, and platform', async () => {
    const probe = makeProbe(makeAvailability(true, true));
    const result = await checkInquiryMethods(probe, 'darwin');

    expect(result.details).toBeDefined();
    const d = result.details as Record<string, unknown>;
    expect(d['scsi']).toMatchObject({ available: true });
    expect(d['usb']).toMatchObject({ available: true });
    expect(d['plan']).toBe('usb-then-scsi');
    expect(d['platform']).toBe('darwin');
  });

  it('details plan is usb-only when SCSI unavailable', async () => {
    const probe = makeProbe(makeAvailability(false, true));
    const result = await checkInquiryMethods(probe, 'linux');
    const d = result.details as Record<string, unknown>;
    expect(d['plan']).toBe('usb-only');
  });

  it('details plan is scsi-only when USB unavailable', async () => {
    const probe = makeProbe(makeAvailability(true, false));
    const result = await checkInquiryMethods(probe, 'darwin');
    const d = result.details as Record<string, unknown>;
    expect(d['plan']).toBe('scsi-only');
  });

  it('details plan is none when both unavailable', async () => {
    const probe = makeProbe(makeAvailability(false, false));
    const result = await checkInquiryMethods(probe);
    const d = result.details as Record<string, unknown>;
    expect(d['plan']).toBe('none');
  });

  it('usb details includes reason when unavailable', async () => {
    const probe = makeProbe(
      makeAvailability(true, false, undefined, 'libusb not loadable: missing so')
    );
    const result = await checkInquiryMethods(probe, 'linux');
    const d = result.details as Record<string, unknown>;
    expect(d['usb']).toMatchObject({ available: false, reason: 'libusb not loadable: missing so' });
  });
});
