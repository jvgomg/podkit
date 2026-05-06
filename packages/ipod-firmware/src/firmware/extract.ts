/**
 * Firmware capability extractor
 *
 * Extracts identity and structured capability data from a parsed
 * SysInfoExtended plist tree.  The plist is produced by `parsePlist()`
 * from the raw XML payload returned by a SCSI or USB firmware inquiry.
 *
 * ## Apple plist key names discovered across generations
 *
 * **Identity**
 * - `FireWireGUID` — string (hex, no 0x prefix, 16 uppercase chars).
 *   All captures store it as a pre-formatted `<string>`, not an `<integer>`.
 *   The `bigintToFireWireGuid` helper is provided for callers that receive
 *   the GUID as a raw 64-bit integer from another source (e.g. a SCSI VPD
 *   page decoded by the transport layer).
 * - `SerialNumber` — string.  Present in all captures.
 *
 * **FamilyID / DBVersion**
 * - `FamilyID` — small integer (always present).
 * - `DBVersion` — small integer (absent on older devices: mini 2G, iPod 5G).
 *
 * **Firmware version**
 * - `VisibleBuildID` — human-readable version string (e.g. "1.0.4").
 *   `BuildID` / `BuildVersion` are internal Apple identifiers — not exposed.
 *
 * **RAM**
 * - `RAM` — integer in **megabytes** (e.g. 32 = 32 MB).
 *   Absent on mini 2G.  Always present on nano 4G, nano 7G, iPod 5G.
 *   Stored as bytes in `FirmwareCapabilities.ramBytes` (multiply × 1 048 576).
 *
 * **Audio codecs** (`AudioCodecs` dict)
 * - Dict keyed by codec name: `AIFF`, `MP3`, `WAV`, `AAC`, `AppleLossless`,
 *   `Audible`.  Each sub-dict contains:
 *   - `MaximumSampleRate` (integer, Hz) — present on AIFF, MP3, WAV, AAC, ALAC.
 *   - `MaximumBitDepth` (integer, bits) — present on AIFF, WAV, ALAC; absent
 *     on MP3 (data-rate) and AAC.
 *   Absent entirely on nano 7G SCSI capture (SCSI returns minimal fields for
 *   that generation; USB capture has full codec data).
 *
 * **Video codecs** (`VideoCodecs` dict)
 * - Dict keyed by codec name: `H.264`, `MPEG4`, `H.264LC`.  Optional per codec:
 *   - `Profile` — string (e.g. "B").  May live inside a `Profiles` sub-dict
 *     (nano 4G) or directly as `Profile` (iPod 5G).
 *   - `Level` — integer.
 *   - `MaximumAverageBitRate` — integer (kbps).
 *   - `MaximumWidth` / `MaximumHeight` — integers (pixels).
 * - Present on: iPod 5G (H.264 + MPEG4 + H.264LC), nano 4G (same set),
 *   nano 7G USB (H.264 + MPEG4 + H.264LC).
 * - Absent on: mini 2G, nano 2G (older generation), nano 7G SCSI.
 *
 * **Artwork formats** (`ImageSpecifications` / `ImageSpecifications2`)
 * - Array of dicts (older captures use orphan `<key>` labels between entries —
 *   those are already stripped by the parser).  Each dict:
 *   - `FormatId` (integer) — iTunes artwork format identifier.
 *   - `RenderWidth` / `RenderHeight` (integers, pixels).
 *   - `PixelFormat` (string) — 8-char hex-encoded four-CC (e.g. "4C353635" = "L565").
 * - Nano 7G USB uses `ImageSpecifications2` (primary `ImageSpecifications` is empty).
 *   We fall back to `ImageSpecifications2` when `ImageSpecifications` is present
 *   but empty.
 *
 * **Album art formats** (`AlbumArt` / `AlbumArt2`)
 * - Same structure as `ImageSpecifications`.
 * - Nano 7G USB uses `AlbumArt2`; we fall back similarly.
 * - Absent on mini 2G (no album art support).
 *
 * @module
 */

import type { PlistValue, PlistDict } from '../plist/parser.js';
import type { ParsedFirmware, FirmwareCapabilities } from '@podkit/device-types';

// =============================================================================
// Public helpers
// =============================================================================

/**
 * Format a raw 64-bit FireWire GUID bigint as a 16-character uppercase hex
 * string with no `0x` prefix (e.g. `000A270024A23E9E`).
 *
 * Use this when the GUID arrives as a raw integer from a SCSI VPD page or
 * other binary source.  In SysInfoExtended plists the GUID is already stored
 * as a pre-formatted `<string>` — `extractFromPlist` reads it directly.
 */
export function bigintToFireWireGuid(v: bigint): string {
  return v.toString(16).toUpperCase().padStart(16, '0');
}

// =============================================================================
// Type guards / safe accessors
// =============================================================================

/**
 * Narrow a PlistValue to a PlistDict, or return null.
 * Used throughout to safely descend into nested dicts without switch/instanceof.
 */
function getDict(v: PlistValue | undefined): PlistDict | null {
  if (v === undefined) return null;
  return v.type === 'dict' ? v : null;
}

/** Narrow to string value, or return null. */
function getString(v: PlistValue | undefined): string | null {
  if (v === undefined) return null;
  return v.type === 'string' ? v.value : null;
}

/** Narrow to bigint (integer) value, or return null. */
function getInteger(v: PlistValue | undefined): bigint | null {
  if (v === undefined) return null;
  return v.type === 'integer' ? v.value : null;
}

/** Narrow to array of PlistValues, or return null. */
function getArray(v: PlistValue | undefined): PlistValue[] | null {
  if (v === undefined) return null;
  return v.type === 'array' ? v.value : null;
}

/** Safe Number() from a bigint PlistValue — only for values known to fit in JS safe integer range. */
function getNumber(v: PlistValue | undefined): number | null {
  const n = getInteger(v);
  return n !== null ? Number(n) : null;
}

// =============================================================================
// Extraction helpers
// =============================================================================

/**
 * Extract audio codec list from an `AudioCodecs` dict.
 *
 * Each key in the dict is a codec name; the value is a sub-dict with optional
 * `MaximumSampleRate` and `MaximumBitDepth` fields.  `Audible` is intentionally
 * included — it is a legitimate playback format on these devices.
 *
 * Returns undefined when the key is absent (not an empty array).
 */
function extractAudioCodecs(
  root: Record<string, PlistValue>
): FirmwareCapabilities['audioCodecs'] | undefined {
  const codecsDict = getDict(root['AudioCodecs']);
  if (!codecsDict) return undefined;

  const result: FirmwareCapabilities['audioCodecs'] = [];

  for (const [name, val] of Object.entries(codecsDict.value)) {
    const sub = getDict(val);
    const entry: { codec: string; sampleRates?: number[]; bitDepths?: number[] } = {
      codec: name,
    };

    if (sub) {
      const sr = getNumber(sub.value['MaximumSampleRate']);
      if (sr !== null) entry.sampleRates = [sr];

      const bd = getNumber(sub.value['MaximumBitDepth']);
      if (bd !== null) entry.bitDepths = [bd];
    }

    result.push(entry);
  }

  return result.length > 0 ? result : undefined;
}

/**
 * Extract video codec list from a `VideoCodecs` dict.
 *
 * Each key is a codec name (e.g. `H.264`, `MPEG4`, `H.264LC`).  The sub-dict
 * layout varies by generation:
 * - `Profile` may be a direct string key, or nested inside a `Profiles` dict
 *   (nano 4G uses `Profiles.<name>.Level`; iPod 5G has a flat `Profile` string).
 * - `Level` is an integer when present directly.
 * - `MaximumAverageBitRate` is in kbps.
 * - Resolution is expressed as `MaximumWidth` × `MaximumHeight`.
 *
 * Returns undefined when the key is absent.
 */
function extractVideoCodecs(root: Record<string, PlistValue>): FirmwareCapabilities['videoCodecs'] {
  const codecsDict = getDict(root['VideoCodecs']);
  if (!codecsDict) return undefined;

  const result: NonNullable<FirmwareCapabilities['videoCodecs']> = [];

  for (const [name, val] of Object.entries(codecsDict.value)) {
    const sub = getDict(val);
    if (!sub) continue;

    const entry: NonNullable<FirmwareCapabilities['videoCodecs']>[number] = { codec: name };

    // Profile: direct string key (iPod 5G / nano 7G) or first key of Profiles dict (nano 4G)
    const profileStr = getString(sub.value['Profile']);
    if (profileStr !== null) {
      entry.profile = profileStr;
    } else {
      const profilesDict = getDict(sub.value['Profiles']);
      if (profilesDict) {
        const firstProfileKey = Object.keys(profilesDict.value)[0];
        if (firstProfileKey) entry.profile = firstProfileKey;
      }
    }

    // Level: integer. When inside Profiles dict, use the first profile's Level.
    const levelDirect = getNumber(sub.value['Level']);
    if (levelDirect !== null) {
      entry.level = String(levelDirect);
    } else {
      const profilesDict = getDict(sub.value['Profiles']);
      if (profilesDict) {
        const firstProfileKey = Object.keys(profilesDict.value)[0];
        if (firstProfileKey) {
          const firstProfile = getDict(profilesDict.value[firstProfileKey]);
          const l = firstProfile ? getNumber(firstProfile.value['Level']) : null;
          if (l !== null) entry.level = String(l);
        }
      }
    }

    // MaxBitrate from MaximumAverageBitRate (kbps)
    const bitrate = getNumber(sub.value['MaximumAverageBitRate']);
    if (bitrate !== null) entry.maxBitrate = bitrate;

    // MaxResolution as "WxH"
    const maxW = getNumber(sub.value['MaximumWidth']);
    const maxH = getNumber(sub.value['MaximumHeight']);
    if (maxW !== null && maxH !== null) {
      entry.maxResolution = `${maxW}x${maxH}`;
    }

    result.push(entry);
  }

  return result.length > 0 ? result : undefined;
}

/**
 * Decode the Apple `PixelFormat` string from SysInfoExtended.
 *
 * Apple stores pixel format as an 8-char hex string encoding a four-CC
 * (e.g. "4C353635" → bytes 0x4C 0x35 0x36 0x35 → ASCII "L565").
 * Returns the decoded ASCII string when all four bytes are printable,
 * otherwise returns the raw hex string unchanged.
 */
function decodePixelFormat(raw: string): string {
  if (raw.length !== 8) return raw;
  const chars: string[] = [];
  for (let i = 0; i < 8; i += 2) {
    const byte = parseInt(raw.slice(i, i + 2), 16);
    if (isNaN(byte) || byte < 0x20 || byte > 0x7e) return raw;
    chars.push(String.fromCharCode(byte));
  }
  return chars.join('');
}

/**
 * Extract an artwork/image-spec array from a named plist key.
 *
 * Handles two layouts seen across generations:
 * 1. Plain array of dicts (nano 4G, nano 2G) — each element is a `<dict>`
 *    with `FormatId`, `RenderWidth`, `RenderHeight`, `PixelFormat`.
 * 2. Labelled array with orphan `<key>` labels (iPod 5G) — the parser already
 *    strips those, so we just read the dict elements.
 *
 * Returns undefined when the key is absent or the array contains no valid entries.
 */
function extractImageArray(
  root: Record<string, PlistValue>,
  primaryKey: string,
  fallbackKey?: string
): { formatId: number; width: number; height: number; pixelFormat?: string }[] | undefined {
  let arr = getArray(root[primaryKey]);

  // Fall back to the v2 key when the primary array is present but empty
  // (nano 7G USB: ImageSpecifications is empty, ImageSpecifications2 has data)
  if (fallbackKey && (arr === null || arr.length === 0)) {
    arr = getArray(root[fallbackKey]);
  }

  if (!arr || arr.length === 0) return undefined;

  const result: { formatId: number; width: number; height: number; pixelFormat?: string }[] = [];

  for (const item of arr) {
    const d = getDict(item);
    if (!d) continue;

    const formatId = getNumber(d.value['FormatId']);
    const width = getNumber(d.value['RenderWidth']);
    const height = getNumber(d.value['RenderHeight']);

    if (formatId === null || width === null || height === null) continue;

    const entry: { formatId: number; width: number; height: number; pixelFormat?: string } = {
      formatId,
      width,
      height,
    };

    const pf = getString(d.value['PixelFormat']);
    if (pf !== null) entry.pixelFormat = decodePixelFormat(pf);

    result.push(entry);
  }

  return result.length > 0 ? result : undefined;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Extract identity and firmware capabilities from a parsed SysInfoExtended plist.
 *
 * Reads the root dict produced by `parsePlist()` and maps Apple's plist keys to
 * the structured `ParsedFirmware` / `FirmwareCapabilities` types.
 *
 * **Required fields** (returns null when either is missing):
 * - `FireWireGUID` — 16-char uppercase hex string (stored as `<string>` in plist).
 * - `SerialNumber` — device serial number string.
 * - `FamilyID` — iPod family identifier integer.
 *
 * **Optional fields** (omitted from output when absent):
 * - `VisibleBuildID` → `firmwareVersion`
 * - `RAM` (integer, MB) → `ramBytes` (bytes)
 * - `DBVersion` → `dbVersion`
 * - `AudioCodecs` dict → `audioCodecs`
 * - `VideoCodecs` dict → `videoCodecs`
 * - `ImageSpecifications` / `ImageSpecifications2` → `artworkFormats`
 * - `AlbumArt` / `AlbumArt2` → `albumArtFormats`
 *
 * @param plist - The root `PlistValue` returned by `parsePlist()`.
 * @param rawXml - The original XML payload; preserved verbatim on the returned object.
 * @returns `ParsedFirmware` on success, `null` when required identity fields are missing.
 *
 * @example
 * ```typescript
 * import { parsePlist, extractFromPlist } from '@podkit/ipod-firmware';
 *
 * const plist = parsePlist(xmlString);
 * const fw = extractFromPlist(plist, xmlString);
 * if (fw) {
 *   console.log(fw.firewireGuid);              // "000A270024A23E9E"
 *   console.log(fw.capabilities?.audioCodecs); // [{ codec: 'AAC', ... }, ...]
 * }
 * ```
 */
export function extractFromPlist(plist: PlistValue, rawXml: string): ParsedFirmware | null {
  // The root must be a dict
  const rootDict = getDict(plist);
  if (!rootDict) return null;
  const root = rootDict.value;

  // ── Required: FireWireGUID ─────────────────────────────────────────────────
  // Stored as a pre-formatted <string> in all known captures, not as <integer>.
  // Some iPod generations use alternate casing "FirewireGuid" — try both.
  const guidRaw = getString(root['FireWireGUID']) ?? getString(root['FirewireGuid']);
  if (!guidRaw) return null;
  const firewireGuid = guidRaw.trim().toUpperCase().padStart(16, '0');

  // ── Required: SerialNumber ─────────────────────────────────────────────────
  const serialRaw = getString(root['SerialNumber']);
  if (!serialRaw) return null;
  const serialNumber = serialRaw.trim();

  // ── Required: FamilyID ─────────────────────────────────────────────────────
  const familyIdNum = getNumber(root['FamilyID']);
  if (familyIdNum === null) return null;

  // ── Optional: ModelNumStr / ModelNumber ────────────────────────────────────
  // Apple stores the model number string under "ModelNumStr" in SysInfo (older
  // devices) and "ModelNumber" in SysInfoExtended plists. Try both key names
  // since the naming is inconsistent across generations.
  const modelNumberRaw =
    getString(root['ModelNumStr']) ?? getString(root['ModelNumber']) ?? undefined;
  const modelNumber = modelNumberRaw?.trim() || undefined;

  // ── Optional fields ────────────────────────────────────────────────────────
  const firmwareVersion = getString(root['VisibleBuildID']) ?? undefined;

  const ramMb = getNumber(root['RAM']);
  const ramBytes = ramMb !== null ? ramMb * 1024 * 1024 : undefined;

  const dbVersionNum = getNumber(root['DBVersion']);
  const dbVersion = dbVersionNum !== null ? dbVersionNum : undefined;

  const audioCodecs = extractAudioCodecs(root);
  const videoCodecs = extractVideoCodecs(root);

  const artworkFormats = extractImageArray(root, 'ImageSpecifications', 'ImageSpecifications2');
  const albumArtFormats = extractImageArray(root, 'AlbumArt', 'AlbumArt2');

  // ── Assemble capabilities ──────────────────────────────────────────────────
  const capabilities: FirmwareCapabilities = {
    audioCodecs: audioCodecs ?? [],
    familyId: familyIdNum,
    ...(videoCodecs !== undefined && { videoCodecs }),
    ...(artworkFormats !== undefined && { artworkFormats }),
    ...(albumArtFormats !== undefined && { albumArtFormats }),
    ...(dbVersion !== undefined && { dbVersion }),
    ...(firmwareVersion !== undefined && { firmwareVersion }),
    ...(ramBytes !== undefined && { ramBytes }),
  };

  return {
    firewireGuid,
    serialNumber,
    ...(modelNumber !== undefined && { modelNumber }),
    rawXml,
    capabilities,
  };
}
