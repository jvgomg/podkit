/**
 * Upgrade detection for self-healing sync
 *
 * Compares matched source and iPod tracks to detect meaningful improvements
 * in quality, format, metadata, or artwork. Used by the diff engine to route
 * tracks to `toUpdate` instead of `existing` when upgrades are available.
 *
 * @see ADR-009 for full design context
 * @module
 */

import type { CollectionTrack } from '../adapters/interface.js';
import type { IPodTrack } from './types.js';
import type { UpdateReason, UpgradeReason } from './types.js';

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
function isSourceLossless(source: CollectionTrack): boolean {
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
 * - `soundcheck-update`: source has soundcheck value, iPod value absent or differs
 * - `metadata-correction`: non-matching metadata fields differ
 *
 * **Reason ordering:** Reasons are pushed in priority order (most significant first):
 * format-upgrade > quality-upgrade > artwork-added > soundcheck-update > metadata-correction.
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
  if (source.hasArtwork === true && ipod.hasArtwork === false) {
    reasons.push('artwork-added');
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
 * - soundcheck-update: volume normalization value
 * - metadata-correction: genre, year, track number, etc.
 * - transform-apply / transform-remove / metadata-changed: metadata-only changes
 */
export function isFileReplacementUpgrade(reason: UpdateReason): boolean {
  return (
    reason === 'format-upgrade' ||
    reason === 'quality-upgrade' ||
    reason === 'artwork-added' ||
    reason === 'preset-upgrade' ||
    reason === 'preset-downgrade'
  );
}

// =============================================================================
// Preset Change Detection (shared between audio and video)
// =============================================================================

/**
 * Default tolerance for comparing iPod bitrate against preset target (kbps).
 *
 * Audio VBR encoding produces content-dependent bitrates. Empirically measured
 * ranges for aac_at on diverse music (electronic, rock, indie):
 *   low  (target 128): 111-161 kbps (spread ±25)
 *   medium (target 192): 154-225 kbps (spread ±35)
 *   high (target 256): 212-303 kbps (spread ±45)
 *   max  (target 320): 284-386 kbps (spread ±51)
 *
 * 50 kbps accommodates the widest observed audio VBR spread while still
 * reliably detecting jumps of 2+ preset levels (e.g., low↔high). Adjacent
 * presets (e.g., medium↔high) may overlap in audio VBR.
 *
 * Video CRF + bitrate cap is much more predictable (±4 kbps in testing),
 * so callers can pass a tighter tolerance if needed.
 */
export const DEFAULT_PRESET_CHANGE_TOLERANCE = 50;

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
 * @param ipodBitrate - Bitrate stored in the iPod database (kbps), or undefined/0
 * @param presetBitrate - Target bitrate for the active quality preset (kbps)
 * @param tolerance - Maximum acceptable difference (kbps). Defaults to {@link DEFAULT_PRESET_CHANGE_TOLERANCE}.
 * @param minBitrate - Ignore iPod bitrates below this (kbps). Defaults to {@link DEFAULT_MIN_PRESET_BITRATE}.
 * @returns `'preset-upgrade'` if iPod bitrate is significantly below target,
 *          `'preset-downgrade'` if significantly above, or `null` if within tolerance
 */
export function detectBitratePresetMismatch(
  ipodBitrate: number | undefined,
  presetBitrate: number,
  tolerance: number = DEFAULT_PRESET_CHANGE_TOLERANCE,
  minBitrate: number = DEFAULT_MIN_PRESET_BITRATE
): 'preset-upgrade' | 'preset-downgrade' | null {
  if (!ipodBitrate || ipodBitrate < minBitrate) {
    return null;
  }

  const diff = ipodBitrate - presetBitrate;

  if (diff < -tolerance) {
    return 'preset-upgrade';
  }

  if (diff > tolerance) {
    return 'preset-downgrade';
  }

  return null;
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
 * @param source - Track from the collection source
 * @param ipod - Matched track currently on the iPod
 * @param presetBitrate - Target bitrate (kbps) for the active quality preset
 * @returns `'preset-upgrade'` if iPod bitrate is below target, `'preset-downgrade'`
 *          if above target, or `null` if within tolerance
 */
export function detectPresetChange(
  source: CollectionTrack,
  ipod: IPodTrack,
  presetBitrate: number
): 'preset-upgrade' | 'preset-downgrade' | null {
  // Only applies to lossless sources (lossy are copied as-is)
  if (!isSourceLossless(source)) {
    return null;
  }

  return detectBitratePresetMismatch(ipod.bitrate, presetBitrate);
}
