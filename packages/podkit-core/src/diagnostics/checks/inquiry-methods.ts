/**
 * iPod Firmware Inquiry Methods diagnostic check
 *
 * System-scope check that reports which firmware inquiry transports are
 * available on the current host. Both USB and SCSI are surfaced because
 * either can fail independently:
 *
 *   - USB (preferred): the `usb` npm package's prebuild is embedded in
 *     shipped binaries but can fail to dlopen if libudev.so.1 is absent on
 *     the host Linux system, or if the prebuild was silently omitted at
 *     build time. When USB is down, firmware inquiry degrades silently.
 *
 *   - SCSI (fallback): requires iPodDriver.kext on macOS or readable
 *     `/dev/sg*` nodes on Linux. Absence is user-actionable on Linux
 *     (add to plugdev group).
 */

import {
  probeInquiryMethods,
  chooseTransports,
  type InquiryMethodsAvailability,
  type ProbeOptions,
} from '@podkit/ipod-firmware';
import type { DiagnosticCheck, CheckResult, DiagnosticContext } from '../types.js';

// ── Pure check logic (exported for testing with injected probe fn) ────────────

/** Signature of the probe function, matching probeInquiryMethods. */
export type ProbeFn = (opts?: ProbeOptions) => Promise<InquiryMethodsAvailability>;

/**
 * Build a human-readable summary line.
 *
 * Priority order:
 * 1. USB down (preferred transport) — surface USB failure first, since that
 *    is the more impactful loss for modern iPods.
 * 2. SCSI-only cases — mirror the previous macOS/Linux platform messages.
 * 3. Both transports available — brief confirmation.
 */
function buildSummary(
  a: InquiryMethodsAvailability,
  platform: NodeJS.Platform = process.platform
): string {
  // Both down
  if (!a.usb.available && !a.scsi.available) {
    const usbReason = a.usb.reason ?? 'USB inquiry unavailable';
    return `USB and SCSI inquiry both unavailable — ${usbReason}`;
  }

  // USB down, SCSI up — USB is the preferred transport, so surface it
  if (!a.usb.available) {
    const usbReason = a.usb.reason ?? 'USB inquiry unavailable';
    return `USB transport unavailable (SCSI fallback active): ${usbReason}`;
  }

  // USB up — describe SCSI availability as secondary context
  if (a.scsi.available) {
    return platform === 'darwin'
      ? 'USB inquiry available; iPodDriver.kext present'
      : 'USB inquiry available; /dev/sg* present';
  }

  // USB up, SCSI down — pass, but note SCSI status for completeness
  const scsiReason = a.scsi.reason ?? '';
  if (scsiReason.includes('not readable')) {
    return 'USB inquiry available; /dev/sg* not readable (gid plugdev or sudo required)';
  }
  if (scsiReason.includes('no /dev/sg*')) {
    return 'USB inquiry available; no /dev/sg* nodes (SCSI fallback inactive)';
  }
  if (scsiReason.includes('iPodDriver.kext not present')) {
    return 'USB inquiry available; iPodDriver.kext not present (SCSI fallback inactive)';
  }
  if (scsiReason.includes('not implemented')) {
    return 'USB inquiry available; SCSI not supported on this platform';
  }
  return scsiReason
    ? `USB inquiry available; SCSI unavailable: ${scsiReason}`
    : 'USB inquiry available; SCSI unavailable';
}

/**
 * Derive check status from availability results.
 *
 * USB is the *preferred* transport (it yields richer data on nano 5G and
 * later). The status logic reflects that preference:
 *
 *   - `pass`  — USB is available. SCSI may or may not be present; its absence
 *               is not alarming when USB works. A host without `/dev/sg*` but
 *               with a working USB stack (common on Linux) must not show `warn`.
 *   - `warn`  — USB is unavailable but SCSI is available. Firmware inquiry
 *               still works via the SCSI fallback, but the preferred path is
 *               degraded — e.g. libudev.so.1 absent, prebuild not embedded.
 *   - `warn`  — Both transports are unavailable. No firmware inquiry is
 *               possible; this is still `warn` rather than `fail` because the
 *               core sync path does not hard-depend on firmware inquiry (it
 *               falls back to filesystem-only identity). Using `fail` would
 *               incorrectly block non-inquiry operations in the doctor summary.
 */
function deriveStatus(a: InquiryMethodsAvailability): 'pass' | 'warn' {
  if (a.usb.available) return 'pass';
  return 'warn';
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
  const plan = chooseTransports(a);

  return {
    status,
    summary: buildSummary(a, platform),
    repairable: false,
    details: {
      scsi: {
        available: a.scsi.available,
        ...(a.scsi.reason !== undefined ? { reason: a.scsi.reason } : {}),
      },
      usb: {
        available: a.usb.available,
        ...(a.usb.reason !== undefined ? { reason: a.usb.reason } : {}),
      },
      plan,
      platform,
    },
  };
}

// ── Exported check object ─────────────────────────────────────────────────────

export const inquiryMethodsCheck: DiagnosticCheck = {
  id: 'inquiry-methods',
  name: 'iPod Firmware Inquiry Methods',
  scope: 'system',
  // iPod-only: this check probes the SCSI/USB transports used exclusively
  // by iPod firmware inquiry. Surfacing it under "System" on a mass-storage
  // device (e.g. Echo Mini) would mislead users into thinking iPodDriver.kext
  // matters for their device. (TASK-317.08)
  applicableTo: ['ipod'],

  async check(_ctx: DiagnosticContext): Promise<CheckResult> {
    return checkInquiryMethods();
  },
};
