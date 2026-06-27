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

import type { CollectionTrack } from '../../adapters/interface.js';
import type { EncodingMode } from '../../transcode/types.js';
import type { SyncTagData } from '../../metadata/sync-tags.js';
import { syncTagMatchesConfig } from '../../metadata/sync-tags.js';
import { normalizationToDb } from '../../metadata/normalization.js';
import type { DeviceTrack } from './types.js';
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
function isIpodTrackLossless(ipod: DeviceTrack): boolean | undefined {
  if (!ipod.filetype) return undefined;
  const lower = ipod.filetype.toLowerCase();
  return LOSSLESS_FILETYPE_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Determine the format family of an iPod track from its filetype string.
 */
export function getIpodFormatFamily(ipod: DeviceTrack): FormatFamily {
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

// =============================================================================
// Unified quality classifier
// =============================================================================

/**
 * Reasons the unified quality classifier can produce.
 *
 * Today (slice S0) only the four behaviour-preserving reasons are reachable:
 * - `lossless-boundary` (was `format-upgrade`): a lossless source replacing a
 *   lossy device copy.
 * - `source-improved` (was `quality-upgrade`): a lossy source whose bitrate
 *   climbed well above the device copy (same-family, 64 kbps / 1.5× threshold).
 * - `cap-up` (was `preset-upgrade`): the device's recorded encoding sits below
 *   the configured target — re-encode up.
 * - `cap-down` (was `preset-downgrade`): the device's recorded encoding sits
 *   above the configured target — re-encode down.
 *
 * The remaining reasons are scaffold for later slices and are NOT produced by
 * S0:
 * - `format-mismatch` / `encoding-mismatch`: precondition classes (CBR/VBR flip,
 *   codec correctness) — wired in S1/S2.
 * - `source-down-suppressed`: a worse source the user opted NOT to follow down —
 *   wired in S2 (`reEncodes: false`).
 */
export type QualityChangeReason =
  | 'format-mismatch'
  | 'encoding-mismatch'
  | 'lossless-boundary'
  | 'cap-down'
  | 'cap-up'
  | 'source-improved'
  | 'source-down-suppressed';

/**
 * Direction tag for a quality change. `format-only` marks a precondition-class
 * re-encode (codec/encoding correctness) that isn't a bitrate move.
 */
export type QualityChangeDirection = 'up' | 'down' | 'format-only';

/**
 * The single shape the quality classifier returns. Descriptive bitrate /
 * encoding fields feed the `quality-change` event and `qualityChanges[]` JSON.
 */
export interface QualityChange {
  reason: QualityChangeReason;
  direction: QualityChangeDirection;
  /** Whether this change replaces the audio file. False only for `source-down-suppressed`. */
  reEncodes: boolean;
  /** The configured target bitrate (kbps) for the device's quality preset. */
  targetBitrate: number;
  /** Device-side truth: the bitrate the sync tag recorded podkit encoded (kbps). */
  encodedBitrate?: number;
  /** Source bitrate (kbps) reported by the collection adapter. */
  sourceBitrate?: number;
  fromEncoding?: EncodingMode;
  toEncoding?: EncodingMode;
  fromLossless?: boolean;
  toLossless?: boolean;
}

/**
 * Target quality the device is configured to hold a track at.
 */
export interface QualityTarget {
  /** Resolved preset name: 'lossless' | 'high' | 'medium' | 'low'. */
  preset: string;
  /** Target bitrate (kbps) for the preset (0 for lossless). */
  presetBitrate: number;
  /** Encoding mode the device targets. */
  encoding: EncodingMode;
  /**
   * Custom bitrate override (kbps), when the user configured one. Folded into
   * `presetBitrate` for S0's lossless paths, so nothing reads it yet; the lossy
   * cap path (S1) consumes it directly. Kept so it isn't pruned before then.
   */
  customBitrate?: number;
  /** Whether the resolved preset is ALAC (max on an ALAC-capable device). */
  isAlacPreset: boolean;
  /** Resolved lossy output codec (e.g. 'aac', 'opus'). */
  resolvedLossyCodec?: string;
  /**
   * Custom bitrate tolerance ratio (0.0-1.0) for the untagged DB-bitrate
   * fallback. Overrides the encoding-mode default. (S0-only; the fallback is
   * removed in a later slice.)
   */
  bitrateTolerance?: number;
}

/**
 * Bound 1 of the classifier: source-vs-device (the former `detectUpgrades`
 * quality portion). Upgrade-only; preserves today's gating exactly.
 *
 * - lossless source replacing a lossy device copy -> `lossless-boundary`
 * - same-family lossy source whose bitrate climbed significantly above the
 *   device copy (64 kbps OR 1.5×) -> `source-improved`
 * - everything else on this bound -> null
 *
 * Exported so the music handler's match-loop detection (`detectUpdates`) can run
 * just this bound without also running the device-vs-target (preset) bound,
 * which is owned by the post-process pass.
 */
export function classifySourceBound(
  source: CollectionTrack,
  device: DeviceTrack,
  targetBitrate: number
): QualityChange | null {
  const sourceLossless = isSourceLossless(source);
  const deviceLossless = isIpodTrackLossless(device);

  if (deviceLossless !== undefined && sourceLossless && !deviceLossless) {
    return {
      reason: 'lossless-boundary',
      direction: 'up',
      reEncodes: true,
      targetBitrate,
      sourceBitrate: source.bitrate,
      fromLossless: false,
      toLossless: true,
    };
  }

  if (deviceLossless === false && !sourceLossless) {
    const sourceFamily = getSourceFormatFamily(source);
    const deviceFamily = getIpodFormatFamily(device);
    if (
      sourceFamily === deviceFamily &&
      sourceFamily !== 'unknown' &&
      source.bitrate &&
      device.bitrate
    ) {
      const absoluteIncrease = source.bitrate - device.bitrate;
      const relativeIncrease = source.bitrate / device.bitrate;
      if (
        absoluteIncrease >= MIN_BITRATE_INCREASE_KBPS ||
        relativeIncrease >= MIN_BITRATE_MULTIPLIER
      ) {
        return {
          reason: 'source-improved',
          direction: 'up',
          reEncodes: true,
          targetBitrate,
          encodedBitrate: device.bitrate,
          sourceBitrate: source.bitrate,
        };
      }
    }
  }

  return null;
}

/**
 * The single pure quality classifier.
 *
 * Consolidates the quality axis of music sync detection that previously lived
 * in `detectUpgrades` (source-vs-device, up-only), `detectPresetChange`
 * (device-vs-target, lossless-only) and `determineSyncTagDirection`
 * (exact-when-tagged) into one function with one vocabulary.
 *
 * ## Three-bound model
 *
 * The classifier compares the device's recorded `encoded` quality against the
 * `target` and against the `source` as **separate bounds** — never collapsed to
 * `min(source, target)`. Collapsing would make a source drop indistinguishable
 * from a cap drop, which later slices must treat oppositely (cap-down
 * re-encodes; source-down suppresses).
 *
 * The authoritative `encoded` value is the device's sync tag. When the sync tag
 * is absent the classifier falls back to the device DB bitrate + tolerance
 * (`detectBitratePresetMismatch`) — preserved here for behaviour-parity (S0);
 * removing the fallback is a later slice.
 *
 * ## S0 scope (behaviour-preserving)
 *
 * Only the four reasons produced today are reachable:
 * `lossless-boundary`, `source-improved`, `cap-up`, `cap-down`. The lossy
 * cap-enforcement, CBR/VBR (`encoding-mismatch`) and source-down
 * (`source-down-suppressed`) branches are present but dormant — they return
 * `null` for lossy bitrate moves, preserving today's "lossy copied as-is"
 * behaviour. Later slices (S1/S2/S3) enable them.
 *
 * @returns The quality change, or `null` when the track is in sync.
 */
export function classifyQualityChange(input: {
  source: CollectionTrack;
  device: DeviceTrack;
  target: QualityTarget;
  /** What the next sync would write into the device's sync tag for this track. */
  expectedSyncTag?: SyncTagData;
}): QualityChange | null {
  // Bound 1: source-vs-device (upgrade-only). A much-improved source is
  // followed up whether or not the user touched their cap.
  const sourceBound = classifySourceBound(input.source, input.device, input.target.presetBitrate);
  if (sourceBound) return sourceBound;

  // Bound 2: device-vs-target (the former detectPresetChange).
  return classifyDeviceBound(input);
}

/**
 * Bound 2 of the classifier: device-vs-target (the former `detectPresetChange`
 * + `determineSyncTagDirection`). Compares the device's recorded encoding
 * against the configured target, independently of the source bound.
 *
 * Exported so the music handler's post-process pass can run just this bound
 * without re-running the source bound (which `detectUpdates` already ran in the
 * match loop, with its own transcoding-active suppression).
 *
 * S0 preserves the lossless-only restriction: lossy sources are copied as-is,
 * so the cap does not (yet) enter their decision — the lossy branch is
 * intentionally dormant and returns null.
 */
export function classifyDeviceBound(input: {
  source: CollectionTrack;
  device: DeviceTrack;
  target: QualityTarget;
  expectedSyncTag?: SyncTagData;
}): QualityChange | null {
  const { source, device, target, expectedSyncTag } = input;

  const sourceLossless = isSourceLossless(source);
  const deviceLossless = isIpodTrackLossless(device);

  if (!sourceLossless) {
    // TODO(S1/S3): lossy cap enforcement — compare `encoded` vs `target` and
    // `encoded` vs `source` as separate bounds here. Dormant in S0 to preserve
    // "lossy copied as-is".
    return null;
  }

  // Sync-tag-exact comparison takes priority over every bitrate/format fallback.
  // When the device carries a sync tag AND we know what the next sync would
  // write, the comparison is authoritative — the ALAC/tolerance fallbacks below
  // are only consulted when this exact comparison can't be made. (This ordering
  // matters: a per-track preset that fell back from ALAC to high+aac writes a
  // `quality=high` tag, which must compare equal to its own expected tag rather
  // than tripping the config-wide ALAC branch.)
  const syncTag = device.syncTag;
  if (syncTag && expectedSyncTag) {
    // TODO(S2): encoding-mismatch (CBR/VBR) is a precondition class that fires
    // even when bitrate matches — wire it here ahead of the bitrate compare.
    if (syncTagMatchesConfig(syncTag, expectedSyncTag)) {
      return null;
    }
    const direction = syncTagDirection(syncTag, expectedSyncTag);
    return {
      reason: direction === 'up' ? 'cap-up' : 'cap-down',
      direction,
      reEncodes: true,
      targetBitrate: target.presetBitrate,
      encodedBitrate: syncTag.bitrate,
    };
  }

  // No exact tag comparison available. ALAC format-based detection: max preset
  // on an ALAC-capable device — compare by format, not bitrate.
  if (target.isAlacPreset) {
    if (deviceLossless === true) {
      return null; // device track already ALAC — in sync
    }
    return {
      reason: 'cap-up',
      direction: 'up',
      reEncodes: true,
      targetBitrate: target.presetBitrate,
      toLossless: true,
    };
  }

  // Untagged track — fall back to device DB bitrate + tolerance (S0-preserved;
  // removed in a later slice). Keeps untagged lossless tracks comparable.
  const tolerance =
    target.bitrateTolerance ??
    (target.encoding === 'cbr' ? DEFAULT_CBR_TOLERANCE : DEFAULT_VBR_TOLERANCE);
  const mismatch = detectBitratePresetMismatch(device.bitrate, target.presetBitrate, tolerance);
  if (!mismatch) return null;
  const direction = mismatch === 'preset-upgrade' ? 'up' : 'down';
  return {
    reason: direction === 'up' ? 'cap-up' : 'cap-down',
    direction,
    reEncodes: true,
    targetBitrate: target.presetBitrate,
    encodedBitrate: device.bitrate,
  };
}

/**
 * Quality tier ordering for sync-tag direction comparison.
 * Higher number = higher quality.
 */
const QUALITY_TIER_ORDER: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  max: 3,
  lossless: 3,
};

/**
 * Decide whether a sync-tag preset change is an upgrade or downgrade.
 *
 * Compares the device's recorded tag against the expected (target) tag by
 * quality tier, then by bitrate, falling back to 'up' for an encoding-mode flip
 * at the same tier. Behaviour-identical to the former
 * `determineSyncTagDirection` in the music handler.
 */
function syncTagDirection(
  oldTag: { quality: string; encoding?: string; bitrate?: number },
  newTag: { quality: string; encoding?: string; bitrate?: number }
): 'up' | 'down' {
  const oldTier = QUALITY_TIER_ORDER[oldTag.quality] ?? -1;
  const newTier = QUALITY_TIER_ORDER[newTag.quality] ?? -1;

  if (newTier > oldTier) return 'up';
  if (newTier < oldTier) return 'down';

  if (oldTag.bitrate !== undefined && newTag.bitrate !== undefined) {
    return newTag.bitrate > oldTag.bitrate ? 'up' : 'down';
  }

  // Encoding-mode change at the same tier is a re-transcode (treat as up).
  return 'up';
}

/**
 * Detect all NON-QUALITY update reasons for a matched source/device track pair.
 *
 * The quality axis (lossless-boundary / source-improved / cap-up / cap-down) is
 * owned by {@link classifyQualityChange}, not this function. `detectUpgrades`
 * covers the supplementary axes only.
 *
 * Returns an array of upgrade reasons. An empty array means the tracks
 * are equivalent — no upgrade needed.
 *
 * Upgrade categories:
 * - `artwork-added`: source has artwork (`hasArtwork === true`) and iPod track does not
 * - `artwork-removed`: source has no artwork (`hasArtwork === false`) but iPod does
 * - `artwork-updated`: source artwork hash differs from the iPod sync tag hash
 * - `normalization-update`: source has normalization data, device value absent or differs
 * - `metadata-correction`: non-matching metadata fields differ
 *
 * **Reason ordering:** Reasons are pushed in priority order (most significant first):
 * artwork-added > artwork-removed > artwork-updated > normalization-update > metadata-correction.
 * The first reason (`reasons[0]`) is used as the primary/headline reason by the caller,
 * while all detected reasons are returned in the array for full context.
 *
 * @param source - Track from the collection source
 * @param ipod - Matched track currently on the iPod
 * @returns Array of detected upgrade reasons in priority order (empty if no upgrades)
 */
export function detectUpgrades(source: CollectionTrack, ipod: DeviceTrack): UpgradeReason[] {
  // Reasons are pushed in priority order — most significant first.
  // The caller uses reasons[0] as the primary reason for display/categorization.
  const reasons: UpgradeReason[] = [];

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
      const syncTag = ipod.syncTag;
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
    const syncTag = ipod.syncTag;
    if (syncTag?.artworkHash && syncTag.artworkHash !== source.artworkHash) {
      reasons.push('artwork-updated');
    }
  }

  // Normalization update: source has normalization, device value is absent or differs
  if (source.normalization !== undefined) {
    const sourceDb = normalizationToDb(source.normalization);
    const deviceDb = ipod.normalization ? normalizationToDb(ipod.normalization) : undefined;
    if (sourceDb !== undefined) {
      if (deviceDb === undefined || Math.abs(sourceDb - deviceDb) > 0.1) {
        reasons.push('normalization-update');
      }
    }
  }

  // Metadata correction: check non-matching metadata fields
  for (const field of METADATA_CORRECTION_FIELDS) {
    const sourceValue = source[field as keyof CollectionTrack];
    const ipodValue = ipod[field as keyof DeviceTrack];

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
    const sv = sourceValue.toLowerCase().trim();
    const iv = ipodValue.toLowerCase().trim();

    // Genre: embedded tags may contain multiple delimited values
    // (e.g. "Pop;Rock;Indie", "Metal,Death Metal", "Indie/Rock") while the
    // collection source only provides the primary genre ("Pop").  Consider
    // them matching when the source value equals the first value in the
    // device's multi-genre string.
    if (field === 'genre' && sv !== iv) {
      const firstDeviceGenre = iv.split(/[;,/]/)[0]!.trim();
      return sv !== firstDeviceGenre;
    }

    return sv !== iv;
  }

  // For other types, strict equality
  return sourceValue !== ipodValue;
}

/**
 * Check if a value represents "no value" (null, undefined, 0, or empty string).
 *
 * Zero is treated as empty because metadata readers (e.g., music-metadata)
 * return 0 for missing numeric fields like year — semantically equivalent
 * to "not set".
 */
export function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '' || value === 0;
}

/**
 * Check if an update reason requires file replacement (as opposed to metadata-only update).
 *
 * File replacement reasons involve transferring a new audio file to the iPod:
 * - quality-change: a re-encoding quality move (cap-up/down, lossless-boundary,
 *   source-improved). A `source-down-suppressed` quality change does NOT appear
 *   as a `quality-change` reason — it carries `reEncodes:false` and is routed
 *   off the file-replacement path by the handler, so any `quality-change` reason
 *   that reaches here is always a file replacement.
 * - artwork-added: file with embedded artwork
 * - preset-upgrade / preset-downgrade: VIDEO preset re-transcode (audio uses
 *   quality-change; video keeps these reasons)
 *
 * Metadata-only reasons update the iPod database without file transfer:
 * - artwork-updated: artwork bytes changed but track audio is the same (re-extract artwork only)
 * - normalization-update: volume normalization data
 * - metadata-correction: genre, year, track number, etc.
 * - transform-apply / transform-remove / metadata-changed: metadata-only changes
 *
 * Note: `artwork-updated` is NOT a file replacement upgrade. The audio file on the iPod
 * is unchanged — only the artwork needs re-extraction from the source and re-transfer.
 * The executor handles this as a metadata-like operation that also updates artwork bytes.
 */
export function isFileReplacementUpgrade(reason: UpdateReason): boolean {
  return (
    reason === 'quality-change' ||
    reason === 'artwork-added' ||
    reason === 'preset-upgrade' ||
    reason === 'preset-downgrade' ||
    reason === 'codec-changed' ||
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
