/**
 * Parser for iPod SysInfo text files.
 *
 * SysInfo is a plain-text key-value file located at
 * `iPod_Control/Device/SysInfo` on an iPod. It contains device
 * identification data such as the model number and FireWire GUID.
 *
 * Example file contents:
 * ```
 * ModelNumStr: MA147
 * FirewireGuid: 0x0000A00000000001
 * BoardHwName: iPod
 * ```
 */

import type { SysInfoData } from './types.js';

export type { SysInfoData };

/**
 * Parse the text content of an iPod SysInfo file.
 *
 * Parsing rules:
 * - Lines are `Key: Value` format (colon separator, whitespace trimmed).
 * - Empty lines and lines without a colon are silently skipped.
 * - Key matching for the well-known fields (modelNumber, firewireGuid) is
 *   case-insensitive.
 * - All parsed pairs are stored in `raw` with their original-cased key.
 *
 * @param content - Raw text content of the SysInfo file.
 * @returns Parsed SysInfo data.
 */
export function parseSysInfo(content: string): SysInfoData {
  const raw = new Map<string, string>();

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1).trim();

    if (key) {
      raw.set(key, value);
    }
  }

  // Case-insensitive lookup helper
  function findValue(targetKey: string): string | null {
    const lower = targetKey.toLowerCase();
    for (const [k, v] of raw) {
      if (k.toLowerCase() === lower) return v || null;
    }
    return null;
  }

  const modelRaw = findValue('ModelNumStr');
  const modelNumber = modelRaw && modelRaw.length > 0 ? modelRaw : null;

  const guidRaw = findValue('FirewireGuid');
  const firewireGuid = guidRaw && guidRaw.length > 0 ? guidRaw : null;

  return { modelNumber, firewireGuid, raw };
}
