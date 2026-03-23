/**
 * Upgrade detection for self-healing sync
 *
 * Compares matched source and iPod tracks to detect meaningful improvements
 * in quality, format, metadata, or artwork. Used by the diff engine to route
 * tracks to `toUpdate` instead of `existing` when upgrades are available.
 *
 * @see ADR-009 for full design context
 * @see ADR-010 for preset change detection redesign
 * @module
 */

import type { CollectionTrack } from '../adapters/interface.js';
import type { EncodingMode } from '../transcode/types.js';
import type { IPodTrack } from './types.js';
import type { UpdateReason, UpgradeReason } from './types.js';
import { parseSyncTag } from './sync-tags.js';

/**
 * Metadata fields to check for correction upgrades.
 *
 * These are the same fields used in conflict detection (CONFLICT_FIELDS in differ.ts).
 * We reuse the same set for consistency: if a field can be a "conflict", then
 * a source correction to that field is an upgrade.
 */
const METADATA_CORRECTION_FIELDS = [
  'genre',
  'year',
  'trackNumber',
  'discNumber',
  'albumArtist',
  'compilation',
] as const;

/**
 * iPod filetype strings that indicate lossless formats.
 *
 * The iPod database stores a human-readable `filetype` field (e.g., "MPEG audio file").
 * We use this to determine whether the iPod copy is lossless or lossy.
 */
const LOSSLESS_FILETYPE_PATTERNS = ['apple lossless', 'alac', 'lossless', 'aiff', 'wav', 'flac'];

/**
 * iPod filetype strings mapped to format families for cross-format comparison.
 *
 * Lossy-to-lossy upgrades are only valid within the same format family
 * (e.g., 128 kbps MP3 -> 320 kbps MP3), not across families
 * (e.g., MP3 -> AAC, since transcoding between lossy formats loses quality).
 */
type FormatFamily = 'mp3' | 'aac' | 'ogg' | 'opus' | 'lossless' | 'unknown';

/**
 * Minimum absolute bitrate increase (in kbps) to qualify as a quality upgrade.
 * Applied alongside the relative threshold (1.5x).
 */
const MIN_BITRATE_INCREASE_KBPS = 64;

/**
 * Minimum relative bitrate multiplier to qualify as a quality upgrade.
 * Source bitrate must be at least this multiple of iPod bitrate.
 */
const MIN_BITRATE_MULTIPLIER = 1.5;

/**
 * Determine the format family of a source track from its CollectionTrack metadata.
 */
function getSourceFormatFamily(source: CollectionTrack): FormatFamily {
  if (source.lossless) {
    return 'lossless';
  }

  switch (source.fileType) {
    case 'mp3':
      return 'mp3';
    case 'm4a':
    case 'aac':
    case 'alac':
      // M4A can be AAC or ALAC; use codec if available
      if (source.codec === 'alac') return 'lossless';
      return 'aac';
    case 'ogg':
      return 'ogg';
    case 'opus':
      return 'opus';
    case 'flac':
    case 'wav':
    case 'aiff':
      return 'lossless';
    default:
      return 'unknown';
  }
}

/**
 * Determine whether an iPod track is lossless based on its filetype string.
 *
 * Returns `undefined` if the filetype is not set (unknown format).
 */
function isIpodTrackLossless(ipod: IPodTrack): boolean | undefined {
  if (!ipod.filetype) return undefined;
  const lower = ipod.filetype.toLowerCase();
  return LOSSLESS_FILETYPE_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Determine the format family of an iPod track from its filetype string.
 */
export function getIpodFormatFamily(ipod: IPodTrack): FormatFamily {
  if (isIpodTrackLossless(ipod)) {
    return 'lossless';
  }

  if (!ipod.filetype) return 'unknown';
  const lower = ipod.filetype.toLowerCase();

  if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3';
  if (lower.includes('aac') || lower.includes('m4a')) return 'aac';
  if (lower.includes('ogg') || lower.includes('vorbis')) return 'ogg';
  if (lower.includes('opus')) return 'opus';

  return 'unknown';
}

/**
 * Determine whether a source track is lossless.
 */
export function isSourceLossless(source: CollectionTrack): boolean {
  if (source.lossless !== undefined) {
    return source.lossless;
  }
  return getSourceFormatFamily(source) === 'lossless';
}

/**
 * Check if a source track represents a quality upgrade over an iPod track.
 *
 * Returns `true` only when the source is **definitively better**, not merely different.
 *
 * Quality upgrade rules:
 * - Lossless source replacing lossy iPod track -> upgrade
 * - Higher bitrate lossy replacing lower bitrate lossy (same format family,
 *   >= 1.5x OR >= 64 kbps increase) -> upgrade
 * - Lossy -> lossy different format -> NOT an upgrade (transcoding between
 *   lossy formats loses quality)
 * - Lower or equal quality -> NOT an upgrade
 *
 * @param source - Track from the collection source
 * @param ipod - Matched track currently on the iPod
 * @returns True if the source is a quality upgrade over the iPod track
 */
export function isQualityUpgrade(source: CollectionTrack, ipod: IPodTrack): boolean {
  const sourceLossless = isSourceLossless(source);
  const ipodLossless = isIpodTrackLossless(ipod);

  // If iPod format is unknown, we can't determine upgrade
  if (ipodLossless === undefined) {
    return false;
  }

  // Lossless replacing lossy is always an upgrade
  if (sourceLossless && !ipodLossless) {
    return true;
  }

  // Lossy replacing lossless is never an upgrade
  if (!sourceLossless && ipodLossless) {
    return false;
  }

  // Lossless replacing lossless — not an upgrade (already lossless)
  if (sourceLossless && ipodLossless) {
    return false;
  }

  // Both lossy — check if same format family and significant bitrate increase
  const sourceFamily = getSourceFormatFamily(source);
  const ipodFamily = getIpodFormatFamily(ipod);

  // Cross-format lossy is never an upgrade (would lose quality transcoding)
  if (sourceFamily !== ipodFamily) {
    return false;
  }

  // Unknown format families can't be compared
  if (sourceFamily === 'unknown' || ipodFamily === 'unknown') {
    return false;
  }

  // Same format family — check bitrate
  const sourceBitrate = source.bitrate;
  const ipodBitrate = ipod.bitrate;

  // Can't determine upgrade without bitrate info
  if (!sourceBitrate || !ipodBitrate) {
    return false;
  }

  // Must meet at least one threshold: 1.5x multiplier OR 64 kbps increase
  const absoluteIncrease = sourceBitrate - ipodBitrate;
  const relativeIncrease = sourceBitrate / ipodBitrate;

  return (
    absoluteIncrease >= MIN_BITRATE_INCREASE_KBPS || relativeIncrease >= MIN_BITRATE_MULTIPLIER
  );
}

/**
 * Detect all upgrade reasons for a matched source/iPod track pair.
 *
 * Returns an array of upgrade reasons. An empty array means the tracks
 * are equivalent — no upgrade needed.
 *
 * Upgrade categories:
 * - `format-upgrade`: source is lossless, iPod has lossy
 * - `quality-upgrade`: same format family, significantly higher bitrate
 * - `artwork-added`: source has artwork (`hasArtwork === true`) and iPod track does not
 * - `artwork-removed`: source has no artwork (`hasArtwork === false`) but iPod does
 * - `soundcheck-update`: source has soundcheck value, iPod value absent or differs
 * - `metadata-correction`: non-matching metadata fields differ
 *
 * **Reason ordering:** Reasons are pushed in priority order (most significant first):
 * format-upgrade > quality-upgrade > artwork-added > artwork-removed > artwork-updated > soundcheck-update > metadata-correction.
 * The first reason (`reasons[0]`) is used as the primary/headline reason in `UpdateTrack.reason`,
 * while the full list of changes is available in `UpdateTrack.changes`.
 *
 * @param source - Track from the collection source
 * @param ipod - Matched track currently on the iPod
 * @returns Array of detected upgrade reasons in priority order (empty if no upgrades)
 */
export function detectUpgrades(source: CollectionTrack, ipod: IPodTrack): UpgradeReason[] {
  // Reasons are pushed in priority order — most significant first.
  // The caller uses reasons[0] as the primary reason for display/categorization.
  const reasons: UpgradeReason[] = [];

  // Format upgrade: lossless source replacing lossy iPod track
  const sourceLossless = isSourceLossless(source);
  const ipodLossless = isIpodTrackLossless(ipod);

  if (ipodLossless !== undefined && sourceLossless && !ipodLossless) {
    reasons.push('format-upgrade');
  } else if (ipodLossless === false && !sourceLossless) {
    // Quality upgrade: same format family, significantly higher bitrate
    // (only checked when both are confirmed lossy and format-upgrade doesn't apply)
    const sourceFamily = getSourceFormatFamily(source);
    const ipodFamily = getIpodFormatFamily(ipod);

    if (
      sourceFamily === ipodFamily &&
      sourceFamily !== 'unknown' &&
      source.bitrate &&
      ipod.bitrate
    ) {
      const absoluteIncrease = source.bitrate - ipod.bitrate;
      const relativeIncrease = source.bitrate / ipod.bitrate;

      if (
        absoluteIncrease >= MIN_BITRATE_INCREASE_KBPS ||
        relativeIncrease >= MIN_BITRATE_MULTIPLIER
      ) {
        reasons.push('quality-upgrade');
      }
    }
  }

  // Artwork added: source has artwork and iPod track does not.
  // Only trigger when source.hasArtwork is explicitly true (not undefined),
  // so adapters that don't populate the field never produce false positives.
  //
  // Skip when the sync tag already has an artworkHash matching the source — this
  // means a previous sync already attempted artwork transfer but extractArtwork()
  // returned null (e.g., Subsonic server has album-level artwork but the specific
  // audio file has no embedded artwork). Re-downloading won't help; the executor
  // adapter fallback (TASK-142) will address this.
  if (source.hasArtwork === true && ipod.hasArtwork === false) {
    if (source.artworkHash) {
      const syncTag = parseSyncTag(ipod.comment);
      if (!syncTag?.artworkHash || syncTag.artworkHash !== source.artworkHash) {
        reasons.push('artwork-added');
      }
    } else {
      reasons.push('artwork-added');
    }
  }

  // Artwork removed: source no longer has artwork but iPod does.
  // This is a metadata-only operation — removes artwork from iPod track.
  if (source.hasArtwork === false && ipod.hasArtwork === true) {
    reasons.push('artwork-removed');
  }

  // Artwork updated: source artwork hash differs from the hash stored in the iPod's sync tag.
  // Only check when source.artworkHash is defined (adapter had --check-artwork enabled)
  // and the iPod track has artwork (not trying to compare when iPod has no artwork).
  if (source.artworkHash && ipod.hasArtwork !== false) {
    const syncTag = parseSyncTag(ipod.comment);
    if (syncTag?.artworkHash && syncTag.artworkHash !== source.artworkHash) {
      reasons.push('artwork-updated');
    }
  }

  // Sound Check update: source has soundcheck, iPod value is absent or differs
  if (source.soundcheck !== undefined && source.soundcheck !== null) {
    if (ipod.soundcheck === undefined || ipod.soundcheck === null) {
      reasons.push('soundcheck-update');
    } else if (source.soundcheck !== ipod.soundcheck) {
      reasons.push('soundcheck-update');
    }
  }

  // Metadata correction: check non-matching metadata fields
  for (const field of METADATA_CORRECTION_FIELDS) {
    const sourceValue = source[field as keyof CollectionTrack];
    const ipodValue = ipod[field as keyof IPodTrack];

    if (metadataValuesDiffer(field, sourceValue, ipodValue)) {
      reasons.push('metadata-correction');
      break; // One difference is enough to flag the category
    }
  }

  return reasons;
}

/**
 * Check if two metadata values differ, handling null/undefined/empty normalization.
 *
 * This is the single shared implementation used by both upgrade detection
 * and conflict detection in the diff engine.
 */
export function metadataValuesDiffer(
  field: string,
  sourceValue: unknown,
  ipodValue: unknown
): boolean {
  // Normalize compilation: undefined/null and false are equivalent
  if (field === 'compilation') {
    const sv = sourceValue ?? false;
    const iv = ipodValue ?? false;
    return sv !== iv;
  }

  // Both empty -> no difference
  if (isEmpty(sourceValue) && isEmpty(ipodValue)) {
    return false;
  }

  // One empty, one not -> difference
  if (isEmpty(sourceValue) || isEmpty(ipodValue)) {
    return true;
  }

  // For strings, case-insensitive comparison
  if (typeof sourceValue === 'string' && typeof ipodValue === 'string') {
    return sourceValue.toLowerCase().trim() !== ipodValue.toLowerCase().trim();
  }

  // For other types, strict equality
  return sourceValue !== ipodValue;
}

/**
 * Check if a value represents "no value" (null, undefined, or empty string)
 */
export function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/**
 * Check if an update reason requires file replacement (as opposed to metadata-only update).
 *
 * File replacement reasons involve transferring a new audio file to the iPod:
 * - format-upgrade: different format file
 * - quality-upgrade: higher bitrate file
 * - artwork-added: file with embedded artwork
 *
 * Metadata-only reasons update the iPod database without file transfer:
 * - artwork-updated: artwork bytes changed but track audio is the same (re-extract artwork only)
 * - soundcheck-update: volume normalization value
 * - metadata-correction: genre, year, track number, etc.
 * - transform-apply / transform-remove / metadata-changed: metadata-only changes
 *
 * Note: `artwork-updated` is NOT a file replacement upgrade. The audio file on the iPod
 * is unchanged — only the artwork needs re-extraction from the source and re-transfer.
 * The executor handles this as a metadata-like operation that also updates artwork bytes.
 */
export function isFileReplacementUpgrade(reason: UpdateReason): boolean {
  return (
    reason === 'format-upgrade' ||
    reason === 'quality-upgrade' ||
    reason === 'artwork-added' ||
    reason === 'preset-upgrade' ||
    reason === 'preset-downgrade' ||
    reason === 'force-transcode' ||
    reason === 'transfer-mode-changed'
  );
}

// =============================================================================
// Preset Change Detection (shared between audio and video)
// =============================================================================

/**
 * Default tolerance for VBR encoding as a ratio of the preset target bitrate.
 *
 * VBR encoding produces content-dependent bitrates with wide variance.
 * 30% accommodates the observed VBR spread while reliably detecting
 * jumps of 2+ preset levels. Adjacent VBR presets may overlap.
 *
 * @see ADR-010 for empirical data
 */
export const DEFAULT_VBR_TOLERANCE = 0.3;

/**
 * Default tolerance for CBR encoding as a ratio of the preset target bitrate.
 *
 * CBR bitrates are stable, so a tighter tolerance (10%) can reliably
 * detect adjacent tier changes.
 */
export const DEFAULT_CBR_TOLERANCE = 0.1;

/**
 * Default minimum iPod bitrate (kbps) below which preset change detection
 * is skipped. Very short audio files can produce extremely low reported
 * bitrates (e.g., 17 kbps for a 2-second file) that don't reflect encoding
 * quality.
 */
export const DEFAULT_MIN_PRESET_BITRATE = 64;

/**
 * Compare an iPod track's bitrate against a preset target to detect a mismatch.
 *
 * Used by both audio and video preset change detection. Returns the direction
 * of the mismatch, or null if the bitrate is within tolerance.
 *
 * The tolerance is a ratio (0.0-1.0) of the preset target bitrate, converted
 * to an absolute kbps value internally. For example, a tolerance of 0.3 with
 * a preset target of 256 kbps gives an absolute tolerance of 76.8 kbps.
 *
 * @param ipodBitrate - Bitrate stored in the iPod database (kbps), or undefined/0
 * @param presetBitrate - Target bitrate for the active quality preset (kbps)
 * @param tolerance - Maximum acceptable difference as a ratio (0.0-1.0).
 *                    Defaults to {@link DEFAULT_VBR_TOLERANCE} (0.3).
 * @param minBitrate - Ignore iPod bitrates below this (kbps). Defaults to {@link DEFAULT_MIN_PRESET_BITRATE}.
 * @returns `'preset-upgrade'` if iPod bitrate is significantly below target,
 *          `'preset-downgrade'` if significantly above, or `null` if within tolerance
 */
export function detectBitratePresetMismatch(
  ipodBitrate: number | undefined,
  presetBitrate: number,
  tolerance: number = DEFAULT_VBR_TOLERANCE,
  minBitrate: number = DEFAULT_MIN_PRESET_BITRATE
): 'preset-upgrade' | 'preset-downgrade' | null {
  if (!ipodBitrate || ipodBitrate < minBitrate) {
    return null;
  }

  const absoluteTolerance = presetBitrate * tolerance;
  const diff = ipodBitrate - presetBitrate;

  if (diff < -absoluteTolerance) {
    return 'preset-upgrade';
  }

  if (diff > absoluteTolerance) {
    return 'preset-downgrade';
  }

  return null;
}

/**
 * Options for preset change detection.
 */
export interface PresetChangeOptions {
  /** Encoding mode (vbr or cbr). Determines default tolerance. */
  encodingMode?: EncodingMode;
  /** Custom tolerance ratio (0.0-1.0) overriding the default for the encoding mode. */
  bitrateTolerance?: number;
  /**
   * When true, indicates this is an ALAC preset (max on an ALAC-capable device).
   * Uses format-based detection instead of bitrate comparison:
   * if the iPod track is ALAC, it's in sync; if it's AAC, it's a preset-upgrade.
   */
  isAlacPreset?: boolean;
}

/**
 * Detect if a matched audio track needs re-transcoding due to a quality preset change.
 *
 * This is separate from {@link detectUpgrades} which compares source vs iPod quality.
 * This function compares iPod bitrate against the *expected* bitrate for the current
 * quality preset, detecting when the user has changed their transcoding settings.
 *
 * Only applies to lossless source tracks — lossy sources are copied as-is regardless
 * of the quality preset, so preset changes don't affect them.
 *
 * For ALAC presets (max + ALAC-capable device), uses format-based detection:
 * if the iPod track is ALAC, it's in sync. If it's AAC, it needs re-transcoding
 * to ALAC (preset-upgrade).
 *
 * @param source - Track from the collection source
 * @param ipod - Matched track currently on the iPod
 * @param presetBitrate - Target bitrate (kbps) for the active quality preset
 * @param options - Optional parameters for encoding mode, tolerance, and ALAC detection
 * @returns `'preset-upgrade'` if iPod bitrate is below target, `'preset-downgrade'`
 *          if above target, or `null` if within tolerance
 */
export function detectPresetChange(
  source: CollectionTrack,
  ipod: IPodTrack,
  presetBitrate: number,
  options?: PresetChangeOptions
): 'preset-upgrade' | 'preset-downgrade' | null {
  // Only applies to lossless sources (lossy are copied as-is)
  if (!isSourceLossless(source)) {
    return null;
  }

  // ALAC format-based detection: max preset on ALAC-capable device
  if (options?.isAlacPreset) {
    const ipodLossless = isIpodTrackLossless(ipod);
    if (ipodLossless === true) {
      // iPod track is already ALAC — in sync
      return null;
    }
    // iPod track is AAC (or unknown) — needs re-transcoding to ALAC
    return 'preset-upgrade';
  }

  // Determine effective tolerance
  const tolerance =
    options?.bitrateTolerance ??
    ((options?.encodingMode ?? 'vbr') === 'cbr' ? DEFAULT_CBR_TOLERANCE : DEFAULT_VBR_TOLERANCE);

  return detectBitratePresetMismatch(ipod.bitrate, presetBitrate, tolerance);
}
