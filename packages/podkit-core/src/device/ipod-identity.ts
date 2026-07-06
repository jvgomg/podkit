/**
 * iPod identity assessment.
 *
 * Single entry point used by the CLI's `device add` flow (and any other
 * caller that needs a unified view of "what is this iPod and can we read its
 * identity from firmware") to compute everything needed to render device
 * identity, prompt the user, and decide whether to write SysInfoExtended —
 * before opening the iTunesDB.
 *
 * Pure I/O for *reading* — never writes. The CLI calls this first, displays
 * the result, prompts the user, and on confirmation calls
 * `ensureSysInfoExtended` directly to perform the write.
 *
 * Cascade order (most specific to least):
 *   1. SysInfoExtended on disk (firewireGuid + serial + modelNumStr)
 *   2. classic SysInfo `ModelNumStr` on disk
 *   3. USB product ID (always present when the device is plugged in)
 *
 * The result includes `model` (cascade-resolved IpodModel), `capabilities`
 * (table-derived), and `firmwareInquiry` describing whether SysInfoExtended
 * is present, missing, or unwritable (no USB fingerprint).
 *
 * @module
 */

import {
  resolveIpodModel,
  getChecksumTypeByModelNumber,
  type IpodChecksumType,
  type IpodModel,
} from '@podkit/devices-ipod';
import {
  readSysInfoExtended,
  readSysInfoModelNumber,
  ensureSysInfoExtended,
  type SysInfoExtendedResult,
} from '@podkit/ipod-firmware';
import type { DeviceCapabilities } from '@podkit/device-types';

import { resolveUsbDeviceFromPath, hasCompleteUsbFingerprint } from './usb-path-resolution.js';
import type { CompleteUsbDevice } from './usb-path-resolution.js';
import { identifyCapabilities } from './resolve-capabilities.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Whether SysInfoExtended is present, can be obtained from firmware, or is out
 * of reach for this device on this host. Drives the device-add prompt copy.
 *
 * - `present`     — SIE on disk and parseable. No write needed.
 * - `missing`     — SIE absent or empty/unparseable, USB fingerprint complete
 *   enough to call `ensureSysInfoExtended`. Caller can offer to write.
 * - `unwritable`  — SIE absent and USB fingerprint not resolvable (path mode
 *   without an attached USB device, or the platform can't correlate). Caller
 *   should proceed with cascade-derived identity only.
 */
export type IpodFirmwareInquiryState = 'present' | 'missing' | 'unwritable';

export interface IpodIdentityAssessment {
  /** Cascade-resolved iPod model. `null` if no identifier (USB or disk) yields a match. */
  readonly model: IpodModel | null;
  /** Table-derived capabilities. `null` iff `model` is null. */
  readonly capabilities: DeviceCapabilities | null;
  /** Whether the device's database checksum type strictly requires SysInfoExtended (hash58/72/AB). */
  readonly needsChecksum: boolean;
  /** Resolved checksum type, when known. */
  readonly checksumType: IpodChecksumType | undefined;
  /** Inquiry state — drives the prompt. */
  readonly firmwareInquiry: IpodFirmwareInquiryState;
  /** Existing SysInfoExtended parse result, if present on disk. */
  readonly existing: SysInfoExtendedResult | null;
  /** USB fingerprint of the connected device, when complete enough to drive `ensureSysInfoExtended`. */
  readonly usbFingerprint: CompleteUsbDevice | null;
  /** ModelNumStr extracted from classic SysInfo on disk (e.g. `MA147`), when available. */
  readonly sysInfoModelNumber: string | undefined;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Assess an iPod's identity from disk + USB without writing anything.
 *
 * Reads SysInfoExtended (if any), classic SysInfo ModelNumStr (if any),
 * resolves USB fingerprint via path correlation, and cascades the lot
 * through `resolveIpodModel`. Returns model, capabilities, and inquiry
 * state suitable for displaying identity, prompting the user, and
 * deciding whether to invoke `ensureSysInfoExtended`.
 *
 * @param mountPoint - iPod mount point (e.g., "/Volumes/iPod")
 * @param opts.usbResolver - Optional override of the USB-from-path resolver,
 *   for tests. Defaults to the production `resolveUsbDeviceFromPath`.
 */
export async function assessIpodIdentity(
  mountPoint: string,
  opts?: {
    usbResolver?: (path: string) => Promise<CompleteUsbDevice | null>;
  }
): Promise<IpodIdentityAssessment> {
  const existing = readSysInfoExtended(mountPoint);
  const sysInfoModelNumber = readSysInfoModelNumber(mountPoint);

  // USB resolution — gives us productId for cascade and bus/devnum for the
  // firmware inquiry transports. Returns null if path → USB correlation fails.
  let usbFingerprint: CompleteUsbDevice | null = null;
  if (opts?.usbResolver) {
    usbFingerprint = await opts.usbResolver(mountPoint);
  } else {
    const resolved = await resolveUsbDeviceFromPath(mountPoint);
    if (hasCompleteUsbFingerprint(resolved)) usbFingerprint = resolved;
  }

  // Cascade — feed everything we got off disk + USB into resolveIpodModel.
  const model = resolveIpodModel({
    modelNumStr: existing?.identity.modelNumStr ?? sysInfoModelNumber,
    serialNumber: existing?.identity.serialNumber,
    familyId: existing?.identity.familyId ?? null,
    productId: usbFingerprint?.productId,
  });

  const capabilities = model ? identifyCapabilities(model) : null;

  // Determine checksum type from the resolved model — preferred — or from the
  // classic SysInfo ModelNumStr lookup table when no model resolved.
  let checksumType: IpodChecksumType | undefined = model?.checksumType ?? undefined;
  if (!checksumType && sysInfoModelNumber) {
    const lookup = getChecksumTypeByModelNumber(sysInfoModelNumber);
    if (lookup) checksumType = lookup;
  }
  const needsChecksum =
    checksumType === 'hash58' || checksumType === 'hash72' || checksumType === 'hashAB';

  // SIE inquiry state — present, writable-when-asked, or unwritable.
  let firmwareInquiry: IpodFirmwareInquiryState;
  if (existing?.present && existing.firewireGuid) {
    firmwareInquiry = 'present';
  } else if (usbFingerprint) {
    firmwareInquiry = 'missing';
  } else {
    firmwareInquiry = 'unwritable';
  }

  return {
    model,
    capabilities,
    needsChecksum,
    checksumType,
    firmwareInquiry,
    existing: existing ?? null,
    usbFingerprint,
    sysInfoModelNumber,
  };
}

// =============================================================================
// isIdentityFullyEmpty
// =============================================================================

/**
 * Description of which identity signals were resolved vs. missing, used by the
 * CLI to render a precise "partial cascade" warning when only some signals
 * were available.
 *
 * `userType` mirrors the user's explicit `--type` choice. An explicit type is
 * a deliberate user assertion about the device kind and counts as an identity
 * signal: enough to clear the empty-identity gate and proceed.
 */
export interface IdentitySignalSummary {
  /** Cascade resolved a known model (display name or generation). */
  hasModel: boolean;
  /** Classic SysInfo `ModelNumStr` was read off disk. */
  hasSysInfoModelNumber: boolean;
  /** USB fingerprint (productId + vendor info) was resolvable. */
  hasUsbFingerprint: boolean;
  /** SysInfoExtended is already present on disk. */
  hasSysInfoExtended: boolean;
  /** User passed `--type` (any value). */
  hasUserType: boolean;
}

/**
 * Summarise the identity signals available after the cascade has run. Used
 * by both the empty-identity block predicate and the partial-cascade warning
 * formatter — single source of truth so the two stay in sync.
 */
export function summariseIdentitySignals(
  assessment: IpodIdentityAssessment | null,
  userType?: string | undefined
): IdentitySignalSummary {
  return {
    hasModel: !!assessment?.model,
    hasSysInfoModelNumber: !!assessment?.sysInfoModelNumber,
    hasUsbFingerprint: !!assessment?.usbFingerprint,
    hasSysInfoExtended: assessment?.firmwareInquiry === 'present',
    hasUserType: !!userType,
  };
}

/**
 * Predicate: is the device identity *fully* empty?
 *
 * Returns `true` only when **all** of these hold:
 *   - firmware inquiry returned `'unwritable'` (no SysInfoExtended path)
 *   - no classic SysInfo `ModelNumStr` was read off disk
 *   - no USB fingerprint was resolvable
 *   - cascade did not yield a model
 *   - user did not pass `--type`
 *
 * Partial signals (e.g., USB gave a product name but firmware inquiry failed)
 * are NOT fully empty — the CLI should warn and proceed rather than block.
 *
 * This is the single source of truth for the device-add empty-identity block.
 */
export function isIdentityFullyEmpty(
  assessment: IpodIdentityAssessment | null,
  userType?: string | undefined
): boolean {
  if (userType) return false;
  if (!assessment) return true;
  if (assessment.firmwareInquiry !== 'unwritable') return false;
  const sig = summariseIdentitySignals(assessment, userType);
  // hasSysInfoExtended is not checked here because it's guarded by the
  // 'unwritable' check above — it can only be true when firmware inquiry
  // is 'present', which already returned false.
  return !sig.hasModel && !sig.hasSysInfoModelNumber && !sig.hasUsbFingerprint;
}

// =============================================================================
// ensureSysInfoExtendedAndReassess
// =============================================================================

/**
 * Result of {@link ensureSysInfoExtendedAndReassess}.
 *
 * - `assessment` — updated identity if SIE was just written; the input
 *   assessment unchanged otherwise.
 * - `firmwareWritten` — true iff SIE was just written to disk.
 * - `sysInfoWriteError` — non-empty when the SIE write was attempted but
 *   failed (callers typically warn the user and continue; `podkit doctor`
 *   can retry later).
 */
export interface EnsureSysInfoExtendedAndReassessResult {
  assessment: IpodIdentityAssessment;
  firmwareWritten: boolean;
  sysInfoWriteError?: string;
}

/**
 * Knobs for {@link ensureSysInfoExtendedAndReassess} — both production
 * implementations are the defaults; tests override.
 */
export interface EnsureSysInfoExtendedAndReassessOptions {
  /** Override for `assessIpodIdentity` (tests). */
  assessIdentity?: (mountPoint: string) => Promise<IpodIdentityAssessment>;
  /** Override for `ensureSysInfoExtended` (tests). */
  ensureSysInfoExtended?: typeof ensureSysInfoExtended;
}

/**
 * Write SysInfoExtended from USB firmware inquiry, then re-assess identity.
 *
 * Lifts the "write SIE → re-assess" pattern from `podkit device add`. The
 * CLI calls {@link assessIpodIdentity} first to render device identity and
 * decide whether to offer the firmware inquiry; on user confirmation it
 * calls this helper with the existing assessment.
 *
 * No-op if the input assessment has no `usbFingerprint` (path mode without
 * USB correlation) — returns the input assessment with
 * `firmwareWritten: false`.
 *
 * Write failures are returned in `sysInfoWriteError`, NOT thrown. The
 * caller decides whether to surface or continue.
 */
export async function ensureSysInfoExtendedAndReassess(
  mountPoint: string,
  assessment: IpodIdentityAssessment,
  opts: EnsureSysInfoExtendedAndReassessOptions = {}
): Promise<EnsureSysInfoExtendedAndReassessResult> {
  if (!assessment.usbFingerprint) {
    return { assessment, firmwareWritten: false };
  }

  const writeFn = opts.ensureSysInfoExtended ?? ensureSysInfoExtended;
  const assessFn = opts.assessIdentity ?? assessIpodIdentity;

  const writeResult = await writeFn(mountPoint, assessment.usbFingerprint);

  if (!writeResult.present) {
    return {
      assessment,
      firmwareWritten: false,
      sysInfoWriteError: writeResult.error ?? 'unknown error',
    };
  }

  const reassessed = await assessFn(mountPoint);
  return { assessment: reassessed, firmwareWritten: true };
}
