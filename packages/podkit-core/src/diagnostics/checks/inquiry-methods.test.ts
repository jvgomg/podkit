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
    expect(inquiryMethodsCheck.applicableTo).toEqual(['ipod', 'mass-storage']);
    expect(inquiryMethodsCheck.repair).toBeUndefined();
  });
});

// ── Status derivation ─────────────────────────────────────────────────────────

describe('checkInquiryMethods', () => {
  it('pass when both SCSI and USB are available', async () => {
    const probe = makeProbe(makeAvailability(true, true));
    const result = await checkInquiryMethods(probe, 'darwin');

    expect(result.status).toBe('pass');
    expect(result.repairable).toBe(false);
  });

  it('warn when only SCSI is available', async () => {
    const probe = makeProbe(makeAvailability(true, false, undefined, 'libusb not loadable'));
    const result = await checkInquiryMethods(probe, 'darwin');

    expect(result.status).toBe('warn');
    expect(result.repairable).toBe(false);
  });

  it('warn when only USB is available', async () => {
    const probe = makeProbe(
      makeAvailability(false, true, 'iPodDriver.kext not present — SCSI inquiry unavailable')
    );
    const result = await checkInquiryMethods(probe, 'darwin');

    expect(result.status).toBe('warn');
    expect(result.repairable).toBe(false);
  });

  it('fail when neither is available', async () => {
    const probe = makeProbe(
      makeAvailability(
        false,
        false,
        'iPodDriver.kext not present — SCSI inquiry unavailable',
        'libusb not loadable'
      )
    );
    const result = await checkInquiryMethods(probe, 'darwin');

    expect(result.status).toBe('fail');
    expect(result.repairable).toBe(false);
  });

  // ── Summary text by platform ─────────────────────────────────────────────

  it('macOS pass: summary mentions iPodDriver.kext', async () => {
    const probe = makeProbe(makeAvailability(true, true));
    const result = await checkInquiryMethods(probe, 'darwin');

    expect(result.summary).toContain('iPodDriver.kext present');
    expect(result.summary).toContain('libusb available');
  });

  it('macOS warn: summary mentions kext missing', async () => {
    const probe = makeProbe(
      makeAvailability(false, true, 'iPodDriver.kext not present — SCSI inquiry unavailable')
    );
    const result = await checkInquiryMethods(probe, 'darwin');

    expect(result.summary).toContain('iPodDriver.kext not present');
    expect(result.summary).toContain('libusb available');
  });

  it('Linux pass: summary mentions /dev/sg*', async () => {
    const probe = makeProbe(makeAvailability(true, true));
    const result = await checkInquiryMethods(probe, 'linux');

    expect(result.summary).toContain('/dev/sg* present');
    expect(result.summary).toContain('libusb available');
  });

  it('Linux warn: summary mentions permission requirement when sg* not readable', async () => {
    const probe = makeProbe(
      makeAvailability(
        false,
        true,
        '/dev/sg* present but not readable by current uid (gid plugdev or sudo required)'
      )
    );
    const result = await checkInquiryMethods(probe, 'linux');

    expect(result.summary).toContain('/dev/sg* present but not readable');
    expect(result.summary).toContain('plugdev');
  });

  it('Linux fail: no sg nodes', async () => {
    const probe = makeProbe(
      makeAvailability(
        false,
        false,
        'no /dev/sg* nodes present — SCSI inquiry unavailable (no SCSI generic devices on this system)',
        'libusb not loadable'
      )
    );
    const result = await checkInquiryMethods(probe, 'linux');

    expect(result.status).toBe('fail');
    expect(result.summary).toContain('no /dev/sg*');
    expect(result.summary).toContain('libusb unavailable');
  });

  // ── Details structure ────────────────────────────────────────────────────

  it('details contains scsi, usb, and platform', async () => {
    const probe = makeProbe(makeAvailability(true, true));
    const result = await checkInquiryMethods(probe, 'darwin');

    expect(result.details).toBeDefined();
    const d = result.details as Record<string, unknown>;
    expect(d['scsi']).toMatchObject({ available: true });
    expect(d['usb']).toMatchObject({ available: true });
    expect(d['platform']).toBe('darwin');
  });
});
