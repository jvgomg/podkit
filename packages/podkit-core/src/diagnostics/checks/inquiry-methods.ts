/**
 * iPod Firmware Inquiry Methods diagnostic check
 *
 * System-scope check that reports which firmware inquiry transports
 * (SCSI and USB) are available on the current host. This is a read-only
 * probe — no repair action.
 */

import {
  probeInquiryMethods,
  type InquiryMethodsAvailability,
  type ProbeOptions,
} from '@podkit/ipod-firmware';
import type { DiagnosticCheck, CheckResult, DiagnosticContext } from '../types.js';

// ── Pure check logic (exported for testing with injected probe fn) ────────────

/** Signature of the probe function, matching probeInquiryMethods. */
export type ProbeFn = (opts?: ProbeOptions) => Promise<InquiryMethodsAvailability>;

/**
 * Build a human-readable summary line for the current platform.
 *
 * macOS: "iPodDriver.kext present, libusb available"
 * Linux: "/dev/sg* present, libusb available"
 * Linux warn: "/dev/sg* present but not readable (gid plugdev or sudo required)"
 */
function buildSummary(
  a: InquiryMethodsAvailability,
  platform: NodeJS.Platform = process.platform
): string {
  const parts: string[] = [];

  if (a.scsi.available) {
    if (platform === 'darwin') {
      parts.push('iPodDriver.kext present');
    } else {
      parts.push('/dev/sg* present');
    }
  } else if (a.scsi.reason) {
    // Surface the reason concisely
    if (a.scsi.reason.includes('not readable')) {
      parts.push('/dev/sg* present but not readable (gid plugdev or sudo required)');
    } else if (a.scsi.reason.includes('no /dev/sg*')) {
      parts.push('no /dev/sg* nodes');
    } else if (a.scsi.reason.includes('iPodDriver.kext not present')) {
      parts.push('iPodDriver.kext not present');
    } else if (a.scsi.reason.includes('not implemented')) {
      parts.push('SCSI not supported on this platform');
    } else {
      parts.push(`SCSI unavailable: ${a.scsi.reason}`);
    }
  } else {
    parts.push('SCSI unavailable');
  }

  if (a.usb.available) {
    parts.push('libusb available');
  } else {
    parts.push('libusb unavailable');
  }

  return parts.join(', ');
}

/**
 * Derive check status from availability results.
 * pass: both available; warn: exactly one available; fail: neither available.
 */
function deriveStatus(a: InquiryMethodsAvailability): 'pass' | 'warn' | 'fail' {
  const count = (a.scsi.available ? 1 : 0) + (a.usb.available ? 1 : 0);
  if (count === 2) return 'pass';
  if (count === 1) return 'warn';
  return 'fail';
}

/**
 * Pure check logic — accepts an injected probe function for unit testing.
 */
export async function checkInquiryMethods(
  probe: ProbeFn = probeInquiryMethods,
  platform: NodeJS.Platform = process.platform
): Promise<CheckResult> {
  const a = await probe();
  const status = deriveStatus(a);

  return {
    status,
    summary: buildSummary(a, platform),
    repairable: false,
    details: {
      scsi: { available: a.scsi.available, reason: a.scsi.reason },
      usb: { available: a.usb.available, reason: a.usb.reason },
      platform,
    },
  };
}

// ── Exported check object ─────────────────────────────────────────────────────

export const inquiryMethodsCheck: DiagnosticCheck = {
  id: 'inquiry-methods',
  name: 'iPod Firmware Inquiry Methods',
  scope: 'system',
  applicableTo: ['ipod', 'mass-storage'],

  async check(_ctx: DiagnosticContext): Promise<CheckResult> {
    return checkInquiryMethods();
  },
};
