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
 * Whether the device's copy of a track is lossless, read **tag-first**.
 *
 * The sync tag is authoritative: a `quality=lossless` tag means lossless; an
 * explicit lossy transcode tag (`high`/`medium`/`low`) means lossy even when the
 * filetype string happens to read as lossless (a contrived but real edge — a
 * track whose recorded encode disagrees with its container label). For a direct
 * `copy` tag (the file is whatever the source was) or an untagged track, the
 * filetype is the only signal, so it is the fallback.
 *
 * Returns `undefined` when neither the tag nor the filetype can decide.
 */
function isDeviceCopyLossless(device: DeviceTrack): boolean | undefined {
  const tagQuality = device.syncTag?.quality;
  if (tagQuality === 'lossless') return true;
  if (tagQuality !== undefined && tagQuality !== 'copy') return false;
  return isIpodTrackLossless(device);
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
 * Four reasons are currently reachable:
 * - `lossless-boundary` (was `format-upgrade`): a lossless source replacing a
 *   lossy device copy.
 * - `source-improved` (was `quality-upgrade`): a lossy source whose bitrate
 *   climbed well above the device copy (same-family, 64 kbps / 1.5× threshold).
 * - `cap-up` (was `preset-upgrade`): the device's recorded encoding sits below
 *   the configured target — re-encode up.
 * - `cap-down` (was `preset-downgrade`): the device's recorded encoding sits
 *   above the configured target — re-encode down.
 *
 * - `source-down-suppressed`: the source has degraded below the device copy, so
 *   re-encoding down would destroy quality. The good device copy is kept
 *   (`reEncodes: false`) and reported — unless the `match-all` policy opts in to
 *   following the source down, which flips it to `reEncodes: true`.
 * - `encoding-mismatch`: the device's recorded CBR/VBR mode differs from the
 *   target — a precondition class that re-encodes for correctness regardless of
 *   bitrate policy. Produced on both the lossless sync-tag-exact path and the
 *   lossy cap path (the latter only for tracks podkit transcoded, which carry a
 *   recorded encoding mode; a faithful copy clears it and is left alone).
 *
 * One reason remains defined but not yet produced:
 * - `format-mismatch`: codec-correctness precondition, reserved for future work.
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
 * Per-device bitrate-change policy.
 *
 * - `match-cap` (default): re-encode in both directions to hold the cap, but
 *   keep a better device copy when the source has degraded below it.
 * - `match-all`: follow the source in every direction, including down.
 * - `up-only` / `down-only`: restrict bitrate re-encoding to one direction.
 * - `off`: no bitrate-driven re-encoding at all (preconditions still fire).
 */
export const BITRATE_SYNC_MODES = [
  'off',
  'match-cap',
  'match-all',
  'up-only',
  'down-only',
] as const;

export type BitrateSyncMode = (typeof BITRATE_SYNC_MODES)[number];

/**
 * The pure policy gate: maps `(direction, reason, mode)` to whether the change
 * should re-encode (`'fire'`) or be reported without acting (`'suppress-log'`).
 *
 * Precondition classes — `encoding-mismatch`, `lossless-boundary`,
 * `format-mismatch` — bypass the gate and always fire: they are correctness
 * (codec / encoding / lossless boundary), not bitrate preference, so a
 * `bitrate.sync = off` user still gets format-correct files. (The `skipUpgrades`
 * master veto, which suppresses even preconditions, is applied upstream of this
 * gate, not here.)
 *
 * The bitrate reasons map by direction: `cap-up` / `source-improved` are up
 * moves, `cap-down` is a down move, and `source-down-suppressed` is the
 * degraded-source row that only the opt-in `match-all` follows.
 */
export function applyBitrateSyncPolicy(
  direction: QualityChangeDirection,
  reason: QualityChangeReason,
  mode: BitrateSyncMode
): 'fire' | 'suppress-log' {
  // Preconditions are correctness, not bitrate policy — always re-encode.
  if (
    reason === 'encoding-mismatch' ||
    reason === 'lossless-boundary' ||
    reason === 'format-mismatch'
  ) {
    return 'fire';
  }

  // A degraded source is followed down only when the user opts in.
  if (reason === 'source-down-suppressed') {
    return mode === 'match-all' ? 'fire' : 'suppress-log';
  }

  // Remaining reasons are bitrate moves gated per direction. `cap-up` and
  // `source-improved` are up; `cap-down` is down.
  const isUp = direction === 'up';
  switch (mode) {
    case 'match-cap':
    case 'match-all':
      return 'fire';
    case 'up-only':
      return isUp ? 'fire' : 'suppress-log';
    case 'down-only':
      return isUp ? 'suppress-log' : 'fire';
    case 'off':
      return 'suppress-log';
  }
}

/**
 * Apply the policy gate to a freshly-computed change, setting `reEncodes` from
 * the gate decision. The change is still returned when suppressed so it can be
 * reported (and counted) — only `reEncodes` flips.
 *
 * A change that crosses INTO lossless (`toLossless`) always fires regardless of
 * mode: lossy→lossless is a quality-boundary correctness decision, not a bitrate
 * preference, so it behaves like a precondition even when the reason carries a
 * directional label (the ALAC device-bound upgrade is reported as `cap-up`).
 */
function gateChange(change: QualityChange, mode: BitrateSyncMode): QualityChange {
  change.reEncodes =
    change.toLossless === true ||
    applyBitrateSyncPolicy(change.direction, change.reason, mode) === 'fire';
  return change;
}

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
   * `presetBitrate` for lossless paths; the lossy cap path consumes it directly.
   */
  customBitrate?: number;
  /** Whether the resolved preset is ALAC (max on an ALAC-capable device). */
  isAlacPreset: boolean;
  /** Resolved lossy output codec (e.g. 'aac', 'opus'). */
  resolvedLossyCodec?: string;
  /**
   * Source-bound upward tolerance ratio (0.0-1.0). Damps a trivial upward
   * wobble in the ffprobe-reported source bitrate so it does not churn a cap-up.
   * Applies ONLY to the lossy source-bound comparison; default 0 = exact.
   */
  toleranceUp?: number;
  /**
   * Source-bound downward tolerance ratio (0.0-1.0). Damps a trivial downward
   * wobble in the ffprobe-reported source bitrate so it does not churn a
   * cap-down. Applies ONLY to the lossy source-bound comparison; default 0.
   */
  toleranceDown?: number;
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
  targetBitrate: number,
  mode: BitrateSyncMode = 'match-cap'
): QualityChange | null {
  const change = computeSourceBound(source, device, targetBitrate);
  return change ? gateChange(change, mode) : null;
}

function computeSourceBound(
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
 * from a cap drop, which must be treated oppositely (cap-down re-encodes;
 * source-down suppresses).
 *
 * The authoritative `encoded` value is the device's sync tag and nothing else.
 * When the sync tag is absent the track is opted out (the classifier returns
 * `null`): there is no DB-bitrate fallback, because the iPod-DB bitrate is an
 * unreliable proxy (libgpod exposes no VBR signal). Adopting an untagged track
 * is an explicit, destructive opt-in via `--force-sync-tags-transcode`.
 *
 * ## Currently reachable reasons
 *
 * Six reasons are produced: `lossless-boundary`, `source-improved`, `cap-up`,
 * `cap-down`, `source-down-suppressed` (the only one that does NOT re-encode by
 * default — it reports a degraded source while keeping the better device copy,
 * unless `match-all` follows it down), and `encoding-mismatch` (the CBR/VBR
 * precondition, on both the lossless sync-tag path and the lossy cap path). Only
 * `format-mismatch` remains unreached.
 *
 * @returns The quality change, or `null` when the track is in sync.
 */
export function classifyQualityChange(input: {
  source: CollectionTrack;
  device: DeviceTrack;
  target: QualityTarget;
  /** What the next sync would write into the device's sync tag for this track. */
  expectedSyncTag?: SyncTagData;
  /** Per-device bitrate-change policy (default `match-cap`). */
  policy?: BitrateSyncMode;
}): QualityChange | null {
  const mode = input.policy ?? 'match-cap';

  // Bound 1: source-vs-device (upgrade-only). A much-improved source is
  // followed up whether or not the user touched their cap.
  const sourceBound = classifySourceBound(
    input.source,
    input.device,
    input.target.presetBitrate,
    mode
  );
  if (sourceBound) return sourceBound;

  // Bound 2: device-vs-target (the former detectPresetChange).
  return classifyDeviceBound({ ...input, policy: mode });
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
 * Lossless tracks use the sync-tag-exact / ALAC / DB-bitrate-tolerance ladder
 * below. Lossy tracks are routed to {@link classifyLossyDeviceBound}, which
 * applies the three-bound model against `min(source, cap)`: re-encode up toward
 * the effective ceiling, re-encode down to the cap when the source can supply it,
 * or suppress (report-only, no re-encode) when the source has degraded below the
 * cap.
 */
export function classifyDeviceBound(input: {
  source: CollectionTrack;
  device: DeviceTrack;
  target: QualityTarget;
  expectedSyncTag?: SyncTagData;
  /** Per-device bitrate-change policy (default `match-cap`). */
  policy?: BitrateSyncMode;
}): QualityChange | null {
  const change = computeDeviceBound(input);
  return change ? gateChange(change, input.policy ?? 'match-cap') : null;
}

function computeDeviceBound(input: {
  source: CollectionTrack;
  device: DeviceTrack;
  target: QualityTarget;
  expectedSyncTag?: SyncTagData;
}): QualityChange | null {
  const { source, device, target, expectedSyncTag } = input;

  const sourceLossless = isSourceLossless(source);
  const deviceLossless = isIpodTrackLossless(device);

  if (!sourceLossless) {
    return classifyLossyDeviceBound(source, device, target);
  }

  // Crossing the lossless/lossy boundary is a precondition (correctness), not a
  // bitrate move: a lossless device copy whose target is now a lossy preset must
  // re-encode DOWN to the cap even when bitrate moves are frozen (`off`). This is
  // the mirror of the source-bound lossy→lossless `up` crossing. The device
  // copy's losslessness is read tag-first (authoritative) so a lossy transcode
  // tagged on a lossless-looking container is not misread as a boundary crossing.
  const targetLossless = target.isAlacPreset || target.preset === 'lossless';
  if (!targetLossless && isDeviceCopyLossless(device) === true) {
    return {
      reason: 'lossless-boundary',
      direction: 'down',
      reEncodes: true,
      targetBitrate: target.presetBitrate,
      encodedBitrate: device.syncTag?.bitrate,
      fromLossless: true,
      toLossless: false,
    };
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
    if (syncTagMatchesConfig(syncTag, expectedSyncTag)) {
      return null;
    }
    // An encoding-mode (CBR/VBR) flip is a precondition class: it re-encodes for
    // correctness even when the bitrate cap is unchanged, and it takes the
    // headline reason over any concurrent tier move (a single re-encode satisfies
    // both). A pure flip (no tier/bitrate move) tags `format-only`; a flip that
    // coincides with a tier move keeps that move's direction for display.
    const encodingChanged = (syncTag.encoding ?? 'vbr') !== (expectedSyncTag.encoding ?? 'vbr');
    const move = qualityMoveDirection(syncTag, expectedSyncTag);
    if (encodingChanged) {
      return {
        reason: 'encoding-mismatch',
        direction: move ?? 'format-only',
        reEncodes: true,
        targetBitrate: target.presetBitrate,
        encodedBitrate: syncTag.bitrate,
        fromEncoding: (syncTag.encoding ?? 'vbr') as EncodingMode,
        toEncoding: (expectedSyncTag.encoding ?? 'vbr') as EncodingMode,
      };
    }
    // Not an encoding flip — `syncTagMatchesConfig` was false, so quality or
    // bitrate moved. `qualityMoveDirection` resolves tier-then-bitrate moves, but
    // returns null when the tier is equal and one side's tag bitrate is absent
    // (e.g. adding or removing a custom bitrate at the same tier). Resolve that
    // from effective bitrates, treating an absent tag bitrate as the preset
    // nominal (`target.presetBitrate`, which equals both tiers' nominal when the
    // tier is unchanged), so a lowered custom bitrate is labelled `cap-down` — not
    // mislabelled `cap-up` and then wrongly suppressed under `off`/`up-only`.
    const direction =
      move ??
      ((expectedSyncTag.bitrate ?? target.presetBitrate) < (syncTag.bitrate ?? target.presetBitrate)
        ? 'down'
        : 'up');
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

  // Untagged lossless track — opted out. The sync tag is the sole quality truth;
  // a track podkit did not write carries no authoritative recorded encoding, so
  // there is no comparison to make. The iPod-DB bitrate is an unreliable proxy
  // (libgpod exposes no VBR signal) and is deliberately NOT consulted — there is
  // no guessing. Adoption of such tracks is an explicit, destructive opt-in via
  // `--force-sync-tags-transcode`, never automatic.
  return null;
}

/**
 * Lossy device-vs-target bound — the three-bound model.
 *
 * Compares the device's recorded `encoded` bitrate against the **effective
 * target** `min(source.bitrate, cap)`, and classifies the gap:
 *
 * - `encoded < effectiveTarget` → `cap-up` (re-encode up from the source toward
 *   the effective ceiling). Raising the cap, or improving the source, lifts a
 *   lossy track up — but never past what the source can actually supply.
 * - `encoded > effectiveTarget`:
 *   - `source >= cap` → `cap-down` (re-encode down to the cap; the source can
 *     supply the cap).
 *   - `source < cap` → `source-down-suppressed` (`reEncodes: false`). The source
 *     has degraded below the cap, so the device copy is better than anything the
 *     current source can produce. Re-encoding down to the worse source would
 *     destroy quality, so the file is left alone and the situation is reported.
 *     This covers both `source < encoded <= cap` and the `encoded > cap` edge
 *     where the source has since dropped below the cap (e.g. recorded 320, source
 *     re-ripped to 100, cap 128) — re-encoding from the degraded source would be a
 *     lossy-to-lossy upsample of worse audio, never a real cap-down.
 * - `encoded === effectiveTarget` → null (in sync).
 *
 * Suppression is the DEFAULT for a degraded source. (A future opt-in policy may
 * choose to follow the source down instead.)
 *
 * **The effective target is `min(source.bitrate, cap)`.** Re-encoding up to the
 * full cap when the source only supplies less would inflate the file with no
 * quality gain, so the upward ceiling is bounded by the source. The re-encode
 * runs FROM THE SOURCE (not the on-device copy), so it genuinely recovers
 * quality up to that ceiling.
 *
 * **`encoded` is the sync-tag bitrate and nothing else.** The iPod/DB bitrate is
 * an unreliable proxy (especially for VBR) and is deliberately NOT consulted for
 * lossy — there is no guessing. A lossy device track with no recorded bitrate in
 * its sync tag (a copy added before sync-tag bitrate recording, or an
 * untagged/third-party track) cannot be compared, so it is opted out (returns
 * null). The same applies when the source bitrate is unknown: with no effective
 * target to compute, the track is left alone. An explicit adoption path for
 * untagged tracks is planned via `--force-sync-tags-transcode`.
 *
 * The cap is `target.presetBitrate`, which the config resolver already folds
 * `customBitrate` into (`getPresetBitrate(preset, customBitrate)`), so a custom
 * bitrate is honoured here for free.
 */
function classifyLossyDeviceBound(
  source: CollectionTrack,
  device: DeviceTrack,
  target: QualityTarget
): QualityChange | null {
  const encoded = device.syncTag?.bitrate;
  if (encoded === undefined) {
    // No authoritative recorded bitrate in the sync tag — opt out rather than
    // guess from the unreliable DB bitrate.
    return null;
  }

  const cap = target.presetBitrate;
  if (!cap) {
    // No lossy cap to enforce (e.g. a lossless target preset). Leave as-is.
    return null;
  }

  // The effective target bounds both directions by what the source can supply.
  // Without a known source bitrate there is nothing to compare against, so the
  // track is left alone (no DB-bitrate guessing). A bitrate of 0 is the adapters'
  // "not populated" sentinel and is treated the same as unknown.
  const sourceBitrate = source.bitrate;
  if (!sourceBitrate) {
    return null;
  }

  const effectiveTarget = Math.min(sourceBitrate, cap);

  // Source-bound tolerance: the effective target is derived from the ffprobe
  // source bitrate, which can wobble between syncs (especially for VBR). The
  // opt-in tolerances widen the in-sync band around the effective target so a
  // trivial source drift does not churn a re-encode. Default 0 = exact. This is
  // the ONLY tolerance the lossy path consults — the recorded `encoded` is
  // deterministic (podkit wrote it), so there is no tolerance on that side.
  const upThreshold = effectiveTarget * (1 - (target.toleranceUp ?? 0));
  const downThreshold = effectiveTarget * (1 + (target.toleranceDown ?? 0));

  // Encoding-mode (CBR/VBR) flip is a precondition class on the lossy path too:
  // it re-encodes for correctness regardless of bitrate policy. Only a track
  // podkit transcoded carries a recorded encoding mode — a direct copy clears it
  // (`buildCopySyncTag`), so a faithful copy is never re-encoded just because the
  // mode changed (that would be a lossy-to-lossy degradation). The single
  // re-encode also satisfies any concurrent cap move, so encoding-mismatch takes
  // the headline; the direction reflects that move (else `format-only`). The
  // re-encode targets `effectiveTarget`, so the rewritten tag matches the next
  // sync's comparison (idempotent).
  const recordedEncoding = device.syncTag?.encoding;
  if (recordedEncoding !== undefined && recordedEncoding !== target.encoding) {
    const direction: QualityChangeDirection =
      encoded < upThreshold ? 'up' : encoded > downThreshold ? 'down' : 'format-only';
    // When the device copy is already better than the degraded source can
    // produce, honouring the encoding flip would mean re-encoding down to the
    // worse source. That is a source-down situation: classify it as such so the
    // policy gate decides (match-all follows the source down — and that
    // re-encode still adopts the new encoding mode; the other policies keep the
    // better copy untouched). Only the down direction degrades; up/format-only
    // re-encode at or above the current quality, so the flip fires there.
    if (direction === 'down' && sourceBitrate < cap) {
      return {
        reason: 'source-down-suppressed',
        direction: 'down',
        reEncodes: false,
        targetBitrate: effectiveTarget,
        encodedBitrate: encoded,
        sourceBitrate,
      };
    }
    return {
      reason: 'encoding-mismatch',
      direction,
      reEncodes: true,
      targetBitrate: effectiveTarget,
      encodedBitrate: encoded,
      sourceBitrate,
      fromEncoding: recordedEncoding as EncodingMode,
      toEncoding: target.encoding,
    };
  }

  if (encoded < upThreshold) {
    return {
      reason: 'cap-up',
      direction: 'up',
      reEncodes: true,
      targetBitrate: effectiveTarget,
      encodedBitrate: encoded,
      sourceBitrate,
    };
  }

  if (encoded > downThreshold) {
    if (sourceBitrate >= cap) {
      // The source can supply the cap — re-encode down to it.
      return {
        reason: 'cap-down',
        direction: 'down',
        reEncodes: true,
        targetBitrate: cap,
        encodedBitrate: encoded,
        sourceBitrate,
      };
    }
    // The source has degraded below the cap, so the effective target is the
    // source. The device copy is already better than the source can produce —
    // report it but do not re-encode down to the worse source.
    return {
      reason: 'source-down-suppressed',
      direction: 'down',
      reEncodes: false,
      targetBitrate: effectiveTarget,
      encodedBitrate: encoded,
      sourceBitrate,
    };
  }

  // encoded === effectiveTarget — in sync.
  return null;
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
 * Decide the direction of a sync-tag quality move: by quality tier first, then by
 * bitrate. Returns `null` when neither the tier nor the bitrate moved (e.g. a
 * pure encoding-mode flip at the same tier), so callers can tag that as
 * `format-only` or apply their own fallback.
 */
function qualityMoveDirection(
  oldTag: { quality: string; bitrate?: number },
  newTag: { quality: string; bitrate?: number }
): 'up' | 'down' | null {
  const oldTier = QUALITY_TIER_ORDER[oldTag.quality] ?? -1;
  const newTier = QUALITY_TIER_ORDER[newTag.quality] ?? -1;

  if (newTier > oldTier) return 'up';
  if (newTier < oldTier) return 'down';

  if (
    oldTag.bitrate !== undefined &&
    newTag.bitrate !== undefined &&
    oldTag.bitrate !== newTag.bitrate
  ) {
    return newTag.bitrate > oldTag.bitrate ? 'up' : 'down';
  }

  return null;
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
// Preset Change Detection (VIDEO only)
// =============================================================================
//
// Audio quality detection no longer uses bitrate-vs-tolerance: the sync tag is
// the sole quality truth and untagged audio tracks are opted out (see
// `classifyDeviceBound`). The helper below remains for VIDEO preset change
// detection, which still compares the device bitrate against the target.

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
 * Default minimum iPod bitrate (kbps) below which preset change detection
 * is skipped. Very short audio files can produce extremely low reported
 * bitrates (e.g., 17 kbps for a 2-second file) that don't reflect encoding
 * quality.
 */
export const DEFAULT_MIN_PRESET_BITRATE = 64;

/**
 * Compare an iPod track's bitrate against a preset target to detect a mismatch.
 *
 * Used by VIDEO preset change detection. (Audio uses the sync-tag classifier in
 * `classifyDeviceBound` and has no DB-bitrate fallback.) Returns the direction
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
