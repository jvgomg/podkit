/**
 * iPod Firmware Inquiry Methods diagnostic check
 *
 * System-scope check that reports whether the SCSI inquiry transport
 * is available on the current host. The USB transport is always
 * available in shipped binaries (the `usb` npm package's prebuild is
 * embedded), so it is not user-actionable — checking it would just be
 * noise.
 *
 * SCSI variance is real and user-actionable:
 *   - macOS: requires `iPodDriver.kext` to be installed
 *   - Linux: requires `/dev/sg*` nodes to exist and be readable
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
 * macOS pass:  "iPodDriver.kext present"
 * Linux pass:  "/dev/sg* present"
 * Linux warn:  "/dev/sg* present but not readable (gid plugdev or sudo required)"
 */
function buildSummary(
  a: InquiryMethodsAvailability,
  platform: NodeJS.Platform = process.platform
): string {
  if (a.scsi.available) {
    return platform === 'darwin' ? 'iPodDriver.kext present' : '/dev/sg* present';
  }

  const reason = a.scsi.reason ?? '';
  if (reason.includes('not readable')) {
    return '/dev/sg* present but not readable (gid plugdev or sudo required)';
  }
  if (reason.includes('no /dev/sg*')) {
    return 'no /dev/sg* nodes';
  }
  if (reason.includes('iPodDriver.kext not present')) {
    return 'iPodDriver.kext not present';
  }
  if (reason.includes('not implemented')) {
    return 'SCSI not supported on this platform';
  }
  return reason ? `SCSI unavailable: ${reason}` : 'SCSI unavailable';
}

/**
 * Derive check status from availability results.
 *
 * SCSI is the fallback path when USB inquiry stalls (older iPod
 * generations). When SCSI is available we pass; when it's not, we warn —
 * USB still works for most devices, so this is degraded, not broken.
 */
function deriveStatus(a: InquiryMethodsAvailability): 'pass' | 'warn' {
  return a.scsi.available ? 'pass' : 'warn';
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
