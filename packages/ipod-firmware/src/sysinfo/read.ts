/**
 * SysInfoExtended file reader.
 *
 * Reads the SysInfoExtended plist file from an iPod mount point and extracts
 * device identity fields (FireWireGUID, SerialNumber). Model resolution is
 * intentionally excluded here — `@podkit/ipod-firmware` cannot depend on
 * `@podkit/devices-ipod` (which itself depends on this package). Callers that
 * need model resolution should pass a `resolveModel` callback or perform the
 * lookup after receiving the result.
 *
 * @module
 */

import * as fs from 'node:fs';
import { join } from 'node:path';
import type { IpodModel } from '@podkit/device-types';
import { parsePlist } from '../plist/parser.js';
import { extractFromPlist } from '../firmware/extract.js';
import { SYSINFO_EXTENDED_PATH } from './paths.js';

// ── Result type ──────────────────────────────────────────────────────────────

/** Result of attempting to ensure SysInfoExtended is present */
export interface SysInfoExtendedResult {
  /** Whether SysInfoExtended is now present on the device */
  present: boolean;
  /** How the result was obtained */
  source: 'existing' | 'usb-read' | 'unavailable';
  /**
   * Identified iPod model from serial number lookup.
   * Populated only when a `resolveModel` callback is provided to the read/ensure
   * functions — `@podkit/ipod-firmware` does not depend on the model tables
   * directly to avoid a circular package dependency.
   */
  model?: IpodModel;
  /** FireWire GUID (device instance identifier, not model info) */
  firewireGuid?: string;
  /** Full Apple serial number */
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

/**
 * Extract device identity fields from SysInfoExtended XML.
 * Used by `ensureSysInfoExtended` after USB-read to build the result.
 */
export function extractIdentity(xml: string): ExtractedIdentity | undefined {
  return extractIdentityFromPlistValue(xml);
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Optional callback to resolve an IpodModel from a serial number */
export type ModelResolver = (serialNumber: string) => IpodModel | undefined;

/**
 * Read and parse an existing SysInfoExtended file from an iPod.
 * Returns null if file doesn't exist or is empty.
 *
 * Uses the structured plist parser to extract identity and capability fields.
 * Falls back to identity-only extraction when the plist lacks FamilyID (older
 * or minimal SysInfoExtended payloads).
 *
 * @param mountPoint - iPod mount point (e.g., "/Volumes/iPod")
 * @param resolveModel - Optional callback to resolve an IpodModel from the serial number.
 *   Callers with access to `@podkit/devices-ipod` should pass
 *   `(sn) => resolveIpodModel({ from: 'serial', serialNumber: sn })`.
 */
export function readSysInfoExtended(
  mountPoint: string,
  resolveModel?: ModelResolver
): SysInfoExtendedResult | null {
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

  // Attempt full structured extraction (requires FireWireGUID + SerialNumber + FamilyID).
  let firewireGuid: string | undefined;
  let serialNumber: string | undefined;

  let plist;
  try {
    plist = parsePlist(content);
  } catch {
    // Malformed XML — file is present but unparseable.
    return { present: true, source: 'existing' };
  }

  const parsed = extractFromPlist(plist, content);

  if (parsed) {
    // Full extraction succeeded — use the structured result.
    firewireGuid = parsed.firewireGuid;
    serialNumber = parsed.serialNumber;
  } else {
    // Full extraction failed (e.g. FamilyID missing on older/minimal plists).
    // Fall back to identity-only extraction which only needs GUID + SerialNumber.
    const identity = extractIdentityFromPlistValue(content);
    firewireGuid = identity?.firewireGuid;
    serialNumber = identity?.serialNumber;
  }

  const model = serialNumber && resolveModel ? resolveModel(serialNumber) : undefined;

  return {
    present: true,
    source: 'existing',
    model,
    firewireGuid,
    serialNumber,
  };
}
