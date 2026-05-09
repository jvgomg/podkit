/**
 * SysInfoExtended file reader.
 *
 * Reads the SysInfoExtended plist file (and, opportunistically, the classic
 * SysInfo file next to it) from an iPod mount point and returns a flat
 * "identity bag" — every identifier we could glean from the disk:
 *
 * - FireWireGUID (string)
 * - SerialNumber (string)
 * - ModelNumStr from SysInfo or SysInfoExtended (string, prefix-stripped)
 * - FamilyID from SysInfoExtended (integer)
 *
 * Model resolution is intentionally NOT performed here. Callers compose the
 * returned identity bag with `resolveIpodModel()` from `@podkit/devices-ipod`
 * (which depends on this package — the reverse import would be circular).
 * The cascade lives in one place; every caller gets the same answer.
 *
 * @module
 */

import * as fs from 'node:fs';
import { join } from 'node:path';
import { parsePlist } from '../plist/parser.js';
import { extractFromPlist } from '../firmware/extract.js';
import { SYSINFO_EXTENDED_PATH, SYSINFO_PATH } from './paths.js';

// ── Identity bag ─────────────────────────────────────────────────────────────

/**
 * Flat identity bag suitable for `resolveIpodModel()`.
 *
 * Every field is independently optional — populated whenever it can be
 * extracted from disk. Caller passes the whole bag to `resolveIpodModel` and
 * lets the cascade pick the richest match.
 */
export interface SysInfoIdentity {
  /** FireWire GUID (16-char uppercase hex, padded). */
  firewireGuid?: string;
  /** Apple serial number string. */
  serialNumber?: string;
  /**
   * SysInfo `ModelNumStr` (e.g. `P9804`). Read from the classic SysInfo file
   * when present, otherwise from SysInfoExtended's `ModelNumStr`/`ModelNumber`
   * key (rare). The resolver strips the M/P/F prefix internally.
   */
  modelNumStr?: string;
  /** Apple FamilyID integer from SysInfoExtended (e.g. 3 for mini 2G). */
  familyId?: number;
}

// ── Result type ──────────────────────────────────────────────────────────────

/** Result of reading / ensuring SysInfoExtended */
export interface SysInfoExtendedResult {
  /** Whether SysInfoExtended is now present on the device */
  present: boolean;
  /** How the result was obtained */
  source: 'existing' | 'usb-read' | 'unavailable';
  /**
   * Flat identity bag — pass to `resolveIpodModel()` to derive an `IpodModel`.
   * Empty when the file was unparseable or the read failed.
   */
  identity: SysInfoIdentity;
  /** FireWire GUID (convenience accessor — same as `identity.firewireGuid`). */
  firewireGuid?: string;
  /** Full Apple serial number (convenience accessor — same as `identity.serialNumber`). */
  serialNumber?: string;
  /** Error message when source is 'unavailable' */
  error?: string;
}

// ── Plist-based extraction ───────────────────────────────────────────────────

/**
 * Minimal identity extracted from a SysInfoExtended plist.
 * Does not require FamilyID — suitable for older/minimal plists that lack it.
 */
interface ExtractedIdentity {
  firewireGuid: string;
  serialNumber: string;
}

/**
 * Extract just the identity fields (FireWireGUID + SerialNumber) from a parsed
 * plist value tree. Does not require FamilyID, making it suitable for minimal
 * plists (e.g. FIXTURE_XML_ALT_CASING in tests) that lack capability data.
 *
 * Handles alternate `FirewireGuid` casing used by some iPod generations.
 */
function extractIdentityFromPlistValue(xml: string): ExtractedIdentity | undefined {
  let plist;
  try {
    plist = parsePlist(xml);
  } catch {
    return undefined;
  }

  if (plist.type !== 'dict') return undefined;
  const root = plist.value;

  // Try canonical casing first, then alternate casing
  const guidNode = root['FireWireGUID'] ?? root['FirewireGuid'];
  if (!guidNode || guidNode.type !== 'string') return undefined;
  const firewireGuid = guidNode.value.trim().toUpperCase().padStart(16, '0');

  const serialNode = root['SerialNumber'];
  if (!serialNode || serialNode.type !== 'string') return undefined;
  const serialNumber = serialNode.value.trim();

  if (!firewireGuid || !serialNumber) return undefined;

  return { firewireGuid, serialNumber };
}

// ── Validation (plist-based) ─────────────────────────────────────────────────

/**
 * Validate that SysInfoExtended XML contains the required identity keys.
 * Used by `ensureSysInfoExtended` before writing the file to disk.
 */
export function validateXml(xml: string): { valid: boolean; error?: string } {
  const identity = extractIdentityFromPlistValue(xml);

  if (!identity) {
    return {
      valid: false,
      error: 'Device returned incomplete identity data',
    };
  }

  return { valid: true };
}

// ── Classic SysInfo helper ───────────────────────────────────────────────────

/**
 * Read the classic SysInfo file next to SysInfoExtended and pull its
 * `ModelNumStr`. Returns undefined on any read/parse failure — the caller
 * always treats this as best-effort and never propagates errors.
 *
 * Why we read it: SysInfoExtended often lacks ModelNumStr (mini 2G, nano 2G,
 * older devices store identity but not the model variant). The classic file
 * carries the variant identifier for free — same disk, same trip.
 */
function readSysInfoModelNumStr(mountPoint: string): string | undefined {
  try {
    const content = fs.readFileSync(join(mountPoint, SYSINFO_PATH), 'utf-8');
    const match = content.match(/ModelNumStr:\s*(\S+)/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a result with the given identity, populating the convenience accessors
 * that mirror the bag's `firewireGuid` / `serialNumber` fields.
 */
function buildResult(
  present: boolean,
  source: SysInfoExtendedResult['source'],
  identity: SysInfoIdentity
): SysInfoExtendedResult {
  return {
    present,
    source,
    identity,
    ...(identity.firewireGuid !== undefined ? { firewireGuid: identity.firewireGuid } : {}),
    ...(identity.serialNumber !== undefined ? { serialNumber: identity.serialNumber } : {}),
  };
}

/**
 * Read and parse an existing SysInfoExtended file from an iPod, plus the
 * classic SysInfo file next to it (for `ModelNumStr` when SysInfoExtended
 * doesn't carry one). Returns null when SysInfoExtended is missing or empty.
 *
 * The returned `identity` bag is suitable for passing straight to
 * `resolveIpodModel()` from `@podkit/devices-ipod`.
 *
 * @param mountPoint - iPod mount point (e.g., "/Volumes/iPod")
 */
export function readSysInfoExtended(mountPoint: string): SysInfoExtendedResult | null {
  const filePath = join(mountPoint, SYSINFO_EXTENDED_PATH);

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  if (!content.trim()) {
    return null;
  }

  const identity: SysInfoIdentity = {};

  let plist;
  try {
    plist = parsePlist(content);
  } catch {
    // Malformed XML — file is present but unparseable. We may still have a
    // SysInfo neighbour that gives us a model number.
    const sysInfoModel = readSysInfoModelNumStr(mountPoint);
    if (sysInfoModel) identity.modelNumStr = sysInfoModel;
    return buildResult(true, 'existing', identity);
  }

  const parsed = extractFromPlist(plist, content);

  if (parsed) {
    identity.firewireGuid = parsed.firewireGuid;
    identity.serialNumber = parsed.serialNumber;
    if (parsed.modelNumber) identity.modelNumStr = parsed.modelNumber;
    if (parsed.capabilities?.familyId !== undefined) {
      identity.familyId = parsed.capabilities.familyId;
    }
  } else {
    // Full extraction failed (e.g. FamilyID missing on older/minimal plists).
    // Fall back to identity-only extraction which only needs GUID + SerialNumber.
    const minimal = extractIdentityFromPlistValue(content);
    if (minimal) {
      identity.firewireGuid = minimal.firewireGuid;
      identity.serialNumber = minimal.serialNumber;
    }
  }

  // Always check classic SysInfo for ModelNumStr — variant identifier (capacity,
  // colour) for older devices whose SysInfoExtended carries identity but no model.
  if (!identity.modelNumStr) {
    const sysInfoModel = readSysInfoModelNumStr(mountPoint);
    if (sysInfoModel) identity.modelNumStr = sysInfoModel;
  }

  return buildResult(true, 'existing', identity);
}
