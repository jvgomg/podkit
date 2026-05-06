/**
 * Pure consistency check for on-disk SysInfoExtended vs live USB descriptor.
 *
 * Parses the XML, extracts the FireWireGUID, compares to a live GUID after
 * normalising both to uppercase 16-char hex. No I/O — caller supplies both
 * the on-disk XML and the live GUID.
 *
 * @module
 */

import { parsePlist } from '../plist/parser.js';
import { extractFromPlist } from '../firmware/extract.js';

export type SysInfoConsistencyStatus =
  | 'match' // GUIDs match — file is current.
  | 'mismatch' // GUIDs differ — file is stale.
  | 'malformed' // XML failed to parse OR no FireWireGUID found.
  | 'no-live-guid'; // Caller couldn't supply live GUID — skip the check.

export interface SysInfoConsistencyResult {
  status: SysInfoConsistencyStatus;
  /** Normalised on-disk GUID, when extractable. */
  onDiskGuid?: string;
  /** Normalised live GUID, when supplied. */
  liveGuid?: string;
}

/**
 * Normalise a FireWireGUID to canonical podkit format: uppercase, 16-char
 * zero-padded hex, no `0x` prefix. Idempotent.
 */
export function normaliseFireWireGuid(raw: string): string {
  return raw.toUpperCase().replace(/^0X/, '').padStart(16, '0');
}

/**
 * Compare on-disk SysInfoExtended XML against a live USB FireWire GUID.
 *
 * @param xml      - the SysInfoExtended XML payload from disk.
 * @param liveGuid - the live USB descriptor's serial number (which IS the
 *                   FireWireGUID for classic iPods). Pass `null` or `undefined`
 *                   to indicate "live GUID could not be obtained".
 */
export function compareSysInfoConsistency(
  xml: string,
  liveGuid: string | null | undefined
): SysInfoConsistencyResult {
  let onDiskGuid: string | undefined;
  try {
    const plist = parsePlist(xml);
    const extracted = extractFromPlist(plist, xml);
    onDiskGuid = extracted?.firewireGuid;
  } catch {
    return { status: 'malformed' };
  }
  if (!onDiskGuid) return { status: 'malformed' };

  const normOnDisk = normaliseFireWireGuid(onDiskGuid);

  if (!liveGuid) return { status: 'no-live-guid', onDiskGuid: normOnDisk };

  const normLive = normaliseFireWireGuid(liveGuid);
  return {
    status: normOnDisk === normLive ? 'match' : 'mismatch',
    onDiskGuid: normOnDisk,
    liveGuid: normLive,
  };
}
