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

function makeAvailability(scsiAvailable: boolean, scsiReason?: string): InquiryMethodsAvailability {
  return {
    scsi: { available: scsiAvailable, ...(scsiReason ? { reason: scsiReason } : {}) },
    // USB transport is bundled in shipped binaries — not user-actionable, so
    // the check ignores it. Set to true for realism.
    usb: { available: true },
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
  it('pass when SCSI is available', async () => {
    const probe = makeProbe(makeAvailability(true));
    const result = await checkInquiryMethods(probe, 'darwin');

    expect(result.status).toBe('pass');
    expect(result.repairable).toBe(false);
  });

  it('warn when SCSI is unavailable (USB fallback still works for most devices)', async () => {
    const probe = makeProbe(makeAvailability(false, 'iPodDriver.kext not present'));
    const result = await checkInquiryMethods(probe, 'darwin');

    expect(result.status).toBe('warn');
    expect(result.repairable).toBe(false);
  });

  // ── Summary text by platform ─────────────────────────────────────────────

  it('macOS pass: summary mentions iPodDriver.kext', async () => {
    const probe = makeProbe(makeAvailability(true));
    const result = await checkInquiryMethods(probe, 'darwin');

    expect(result.summary).toBe('iPodDriver.kext present');
  });

  it('macOS warn: summary mentions kext missing', async () => {
    const probe = makeProbe(
      makeAvailability(false, 'iPodDriver.kext not present — SCSI inquiry unavailable')
    );
    const result = await checkInquiryMethods(probe, 'darwin');

    expect(result.summary).toBe('iPodDriver.kext not present');
  });

  it('Linux pass: summary mentions /dev/sg*', async () => {
    const probe = makeProbe(makeAvailability(true));
    const result = await checkInquiryMethods(probe, 'linux');

    expect(result.summary).toBe('/dev/sg* present');
  });

  it('Linux warn: summary mentions permission requirement when sg* not readable', async () => {
    const probe = makeProbe(
      makeAvailability(
        false,
        '/dev/sg* present but not readable by current uid (gid plugdev or sudo required)'
      )
    );
    const result = await checkInquiryMethods(probe, 'linux');

    expect(result.summary).toContain('/dev/sg* present but not readable');
    expect(result.summary).toContain('plugdev');
  });

  it('Linux warn: no sg nodes', async () => {
    const probe = makeProbe(
      makeAvailability(
        false,
        'no /dev/sg* nodes present — SCSI inquiry unavailable (no SCSI generic devices on this system)'
      )
    );
    const result = await checkInquiryMethods(probe, 'linux');

    expect(result.status).toBe('warn');
    expect(result.summary).toBe('no /dev/sg* nodes');
  });

  // ── Details structure ────────────────────────────────────────────────────

  it('details contains scsi and platform', async () => {
    const probe = makeProbe(makeAvailability(true));
    const result = await checkInquiryMethods(probe, 'darwin');

    expect(result.details).toBeDefined();
    const d = result.details as Record<string, unknown>;
    expect(d['scsi']).toMatchObject({ available: true });
    expect(d['platform']).toBe('darwin');
  });
});
