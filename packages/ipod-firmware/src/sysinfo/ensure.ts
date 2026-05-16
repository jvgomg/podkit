/**
 * SysInfoExtended orchestrator.
 *
 * Coordinates reading SysInfoExtended from iPod firmware via USB and writing
 * it to the device filesystem.
 *
 * SysInfoExtended is an Apple plist XML file stored at
 * `iPod_Control/Device/SysInfoExtended` on the iPod filesystem. It contains
 * device identity fields (FireWireGUID, SerialNumber, FamilyID, etc.) that
 * are needed for proper database initialization and checksum generation.
 *
 * @module
 */

import type { UsbFingerprint } from '@podkit/device-types';
import {
  inquireFirmwareDetailed,
  type InquireOptions,
  type InquiryAttempt,
} from '../inquiry/orchestrator.js';
import { readSysInfoExtended, validateXml } from './read.js';
import { writeSysInfoExtended } from './write.js';
import type { SysInfoExtendedResult, SysInfoIdentity } from './read.js';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Function signature for reading SysInfoExtended from USB (for dependency
 * injection in tests). Receives the full {@link UsbFingerprint} so test
 * doubles can assert on every identifier — vendorId, productId, serialNumber,
 * bus, devnum — that the production path threads through to the inquiry
 * orchestrator.
 *
 * Contract: the callback is **synchronous**. A `Promise` return value is not
 * awaited and will be coerced to truthy regardless of resolution. Callers
 * that need async reads should use {@link EnsureSysInfoExtendedOptions.inquireOptions}
 * to inject async transports into the orchestrator instead.
 */
export type ReadFromUsbFn = (fp: UsbFingerprint) => string | null;

/**
 * Optional knobs for {@link ensureSysInfoExtended}. Lets tests override the
 * inquiry orchestrator's transports without bypassing the orchestrator
 * entirely. The result carries an {@link SysInfoIdentity} bag — pass it to
 * `resolveIpodModel()` from `@podkit/devices-ipod` to get an `IpodModel`.
 */
export interface EnsureSysInfoExtendedOptions {
  /**
   * Synchronous override for the USB-read step. When supplied, the inquiry
   * orchestrator is **bypassed** — useful for unit tests that exercise the
   * file-write / validation seams without touching the orchestrator.
   * Integration tests covering the orchestrator's transport selection should
   * leave this unset and pass {@link inquireOptions} instead.
   */
  readFromUsb?: ReadFromUsbFn;
  /**
   * Forwarded to {@link inquireFirmwareDetailed}. Lets integration tests
   * inject mock transports + an availability snapshot so the orchestrator's
   * plan selection (`usb-then-scsi`, `scsi-only`, etc.) and per-attempt
   * outcomes get exercised end-to-end without hardware. Has no effect when
   * {@link readFromUsb} is also supplied.
   */
  inquireOptions?: InquireOptions;
  /**
   * When true, always re-read SysInfoExtended from USB firmware and overwrite
   * the on-disk file even if a parseable copy already exists. Default `false`
   * preserves the original short-circuit behaviour: an existing on-disk file
   * is returned without touching USB.
   *
   * Used by the `sysinfo-consistency` repair to refresh a stale on-disk file
   * that disagrees with the live device (e.g. cloned/synced from another
   * iPod). Without this knob, the existing-file short-circuit means the
   * repair would report success without rewriting anything.
   */
  force?: boolean;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Run the inquiry orchestrator against a USB fingerprint and return both the
 * raw XML and the per-transport attempt outcomes. The XML is `null` whenever
 * the orchestrator could not produce parseable bytes; the attempts let the
 * caller assemble an error message that names the actual transports tried.
 *
 * `opts` is forwarded verbatim to {@link inquireFirmwareDetailed} so tests
 * can inject mock transports + an availability snapshot.
 */
async function inquireViaOrchestrator(
  fp: UsbFingerprint,
  opts?: InquireOptions
): Promise<{ rawXml: string | null; attempts: InquiryAttempt[] }> {
  const detailed = await inquireFirmwareDetailed(fp, opts);
  return { rawXml: detailed.firmware?.rawXml ?? null, attempts: detailed.attempts };
}

/**
 * Build a user-facing error message describing exactly which transports were
 * attempted. The orchestrator returns `null` for several distinct reasons —
 * "no transport available", "USB threw", "SCSI threw", "both threw",
 * "transport returned unparseable bytes", and combinations of the above —
 * and the historical error string misleadingly always blamed USB even when
 * SCSI was the only path tried.
 *
 * The returned message names which transports threw and which returned
 * unparseable data, so the user can tell whether the device responded at all.
 *
 * Note on the mixed-outcome branch: the only mixed shape that arises in
 * practice is `[usb: transport-error, scsi: parse-error]`. Per orchestrator
 * rule 3 (see `inquiry/orchestrator.ts`), a USB success with bytes that fail
 * to parse short-circuits SCSI fallback, so the symmetric
 * `[usb: parse-error, scsi: transport-error]` shape is unreachable from the
 * `usb-then-scsi` plan. Single-transport plans (`usb-only`, `scsi-only`)
 * cannot produce mixed shapes by definition.
 */
function buildTransportErrorMessage(attempts: InquiryAttempt[]): string {
  if (attempts.length === 0) {
    return 'Could not read device identity: no firmware inquiry transport is available on this system';
  }

  const transportErrored = unique(
    attempts.filter((a) => a.outcome === 'transport-error').map((a) => a.transport.toUpperCase())
  );
  const parseFailed = unique(
    attempts.filter((a) => a.outcome === 'parse-error').map((a) => a.transport.toUpperCase())
  );

  if (transportErrored.length === 0 && parseFailed.length > 0) {
    return `Could not read device identity: ${joinAnd(parseFailed)} returned data but it could not be parsed`;
  }
  if (parseFailed.length === 0) {
    return `Could not read device identity from ${joinAnd(transportErrored)}`;
  }
  return `Could not read device identity: ${joinAnd(transportErrored)} failed and ${joinAnd(parseFailed)} returned data that could not be parsed`;
}

function unique(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

function joinAnd(xs: string[]): string {
  return xs.join(' and ');
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Ensure SysInfoExtended is present on an iPod's filesystem.
 *
 * If already present, reads and parses it. If missing, reads from USB
 * firmware via the `@podkit/ipod-firmware` inquiry orchestrator and writes
 * to disk. Returns extracted device identity info.
 *
 * The orchestrator never throws — on any transport or parse failure it
 * returns `null` and a list of per-transport attempts that this function
 * folds into a precise user-facing error message naming exactly which
 * transports threw vs returned unparseable bytes.
 *
 * @param mountPoint - iPod mount point (e.g., "/Volumes/iPod")
 * @param fp - Full USB fingerprint (vendorId, productId, serialNumber, bus,
 *   devnum). All five fields should be populated when the caller has them
 *   from USB enumeration — Linux SCSI matches on bus/devnum and macOS SCSI
 *   matches on vendorId/productId/serialNumber, so a partial fingerprint can
 *   block one platform's transport.
 * @param options - Optional knobs (model resolver, USB-read override, inquiry
 *   transport overrides). See {@link EnsureSysInfoExtendedOptions}.
 */
export async function ensureSysInfoExtended(
  mountPoint: string,
  fp: UsbFingerprint,
  options?: EnsureSysInfoExtendedOptions
): Promise<SysInfoExtendedResult> {
  const { readFromUsb, inquireOptions, force } = options ?? {};

  // Step 1: Check if file already exists. When `force` is set, skip the
  // short-circuit so the consistency repair can refresh a stale on-disk file
  // by re-reading from USB and overwriting in step 4.
  if (!force) {
    const existing = readSysInfoExtended(mountPoint);
    if (existing) {
      return existing;
    }
  }

  // Step 2: Read SysInfoExtended XML.
  //
  // When `readFromUsb` is supplied, use it directly — this preserves the
  // synchronous test injection point (tests pass a mock that returns/throws
  // synthetic XML and assert on the surfaced error path).
  //
  // When `readFromUsb` is omitted, delegate to the `@podkit/ipod-firmware`
  // orchestrator, which probes USB and SCSI transports and falls back
  // transparently. `inquireOptions` (when supplied) lets integration tests
  // mock the transports without bypassing the orchestrator's plan selection.
  let xml: string | null;
  let attempts: InquiryAttempt[] = [];
  try {
    if (readFromUsb) {
      xml = readFromUsb(fp);
    } else {
      const orchestrated = await inquireViaOrchestrator(fp, inquireOptions);
      xml = orchestrated.rawXml;
      attempts = orchestrated.attempts;
    }
  } catch (err) {
    return {
      present: false,
      source: 'unavailable',
      identity: {},
      error: err instanceof Error ? err.message : 'Could not read device identity from USB',
    };
  }
  if (!xml) {
    return {
      present: false,
      source: 'unavailable',
      identity: {},
      error: readFromUsb
        ? 'Could not read device identity from USB'
        : buildTransportErrorMessage(attempts),
    };
  }

  // Step 3: Validate XML
  const validation = validateXml(xml);
  if (!validation.valid) {
    return {
      present: false,
      source: 'unavailable',
      identity: {},
      error: validation.error,
    };
  }

  // Step 4: Write to disk
  writeSysInfoExtended(mountPoint, xml);

  // Step 5: Read the just-written file via readSysInfoExtended so the returned
  // identity bag reflects the classic SysInfo neighbour too — older devices
  // (mini 2G, nano 2G) carry their variant ModelNumStr only in classic SysInfo.
  // Without this, the post-write success message names a less-specific model
  // than a subsequent run that hits the "existing" branch.
  const reread = readSysInfoExtended(mountPoint);
  const identity: SysInfoIdentity = reread?.identity ?? {};

  return {
    present: true,
    source: 'usb-read',
    identity,
    ...(identity.firewireGuid !== undefined ? { firewireGuid: identity.firewireGuid } : {}),
    ...(identity.serialNumber !== undefined ? { serialNumber: identity.serialNumber } : {}),
  };
}

export type { SysInfoExtendedResult, SysInfoIdentity } from './read.js';
