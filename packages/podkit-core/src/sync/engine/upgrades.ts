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
import { QUALITY_PRESETS } from '../../transcode/types.js';
import type { TranscodeTargetCodec } from '../../transcode/codecs.js';
import type { SyncTagData } from '../../metadata/sync-tags.js';
import { syncTagMatchesConfig } from '../../metadata/sync-tags.js';
import { normalizationToDb } from '../../metadata/normalization.js';
import type { DeviceTrack } from './types.js';
import type { UpdateReason, UpgradeReason } from './types.js';
import { resolveLossyReduction, type ReductionAxis } from './lossy-reduction.js';

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
 * Reachable reasons:
 * - `lossless-boundary` (was `format-upgrade`): a lossless source replacing a
 *   lossy device copy (up), or a lossless device copy whose target is now a lossy
 *   preset (down). A correctness precondition — it always re-encodes.
 * - `cap-up`: a LOSSLESS-source device copy whose recorded encoding sits below
 *   the configured target — re-encode up from the (lossless) source. This is NOT
 *   a lossy cap-up: re-encoding a lossy source up cannot recover discarded
 *   information, so it never happens (ADR-023). Only the lossless device-bound
 *   (a higher preset, or the ALAC upgrade) produces this.
 * - `cap-down` (was `preset-downgrade`): a recorded encoding above the configured
 *   target — re-encode down to the cap. The down-only lossy reduction (ADR-023)
 *   and the lossless device-bound preset-down both surface here.
 * - `encoding-mismatch`: the device's recorded CBR/VBR mode differs from the
 *   target — a precondition class that re-encodes for correctness. Produced ONLY
 *   on the LOSSLESS-source sync-tag-exact path; a CBR/VBR flip never re-encodes a
 *   lossy source (that is a lossy→lossy degradation that can grow the file —
 *   ADR-023 §6).
 *
 * Report-only reasons (`reEncodes: false`) — surfaced but never acted on, so the
 * better device copy is always kept:
 * - `source-down-suppressed`: the source was re-ripped/replaced with a copy whose
 *   bitrate sits meaningfully BELOW the device's recorded (sync-tag) bitrate.
 *   Re-encoding down to the worse source would destroy quality, so podkit keeps
 *   the device copy and reports the situation. Produced by {@link classifySourceBound}.
 * - `below-cap`: a previously-REDUCED track (its sync tag carries a lossy preset
 *   quality, not `copy`) now sits strictly below the cap because the cap was
 *   raised. Down-only reduction never re-lifts it automatically (ADR-023 §7); it
 *   is reported so the user can `--force-transcode` to lift it. Produced by
 *   {@link classifyLossyDeviceBound}.
 *
 * Not produced by the classifier bounds here, but produced elsewhere:
 * - `format-mismatch`: a pure forced codec change with no bitrate move — the
 *   adoption pass (`--force-sync-tags-transcode`) emits it when the seam's target
 *   equals the source bitrate (an at-or-below-cap incompatible-codec source), so
 *   the re-encode is not mislabelled as a quality up/down. (Ordinary codec changes
 *   on tagged tracks are detected by the handler's codec-change pass.)
 */
export type QualityChangeReason =
  | 'format-mismatch'
  | 'encoding-mismatch'
  | 'lossless-boundary'
  | 'cap-down'
  | 'cap-up'
  | 'source-down-suppressed'
  | 'below-cap';

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
  /**
   * Whether this change replaces the audio file. False for the report-only
   * reasons (`source-down-suppressed`, `below-cap`) — those keep the device copy.
   */
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
   * The resolved lossy-reduction axis (`convert` reduces an over-cap device-native
   * lossy track down to the cap; `preserve` keeps it untouched). Resolved from
   * `[bitrate].reduce` and the transfer mode by the handler (see
   * {@link resolveReductionAxis}). Consulted only by the lossy device-bound
   * reduction; the lossless paths ignore it. Defaults to `convert` when absent.
   */
  axis?: ReductionAxis;
  /**
   * Device maximum lossy audio bitrate (kbps), when the device declares one
   * (`capabilities.maxAudioBitrate`). `undefined` → unbounded. Passed straight
   * through to the lossy-reduction seam, where it is a hard ceiling on every
   * transcode target (`min(cap, deviceMax)`) and forces a device-native source
   * above it to transcode even under `preserve`.
   */
  deviceMax?: number;
  /**
   * The configured source-proximity tolerance (`[bitrate].tolerance`). Applied on
   * re-sync ONLY to a `copy`-quality tag — a device-native track deliberately
   * copied (possibly within the tolerance band above the cap). Re-evaluating it
   * with the SAME tolerance the add path used keeps add and re-sync in agreement,
   * so a within-tolerance copy stays copied (idempotent) while a genuinely-lowered
   * cap still reduces it. A CONVERTED preset tag (recorded == the old cap) is
   * always compared EXACTLY (tolerance 0), so a lowered cap applies fully. Absent
   * → 0. See {@link classifyLossyDeviceBound}.
   */
  reductionTolerance?: number;
}

/**
 * Default source-proximity tolerance for the source-down comparison — the
 * fraction by which a re-ripped source must fall below the device's recorded
 * bitrate before it is treated as a degradation (rather than ffprobe wobble).
 * Mirrors the add-path `[bitrate].tolerance` default; the handler threads the
 * configured value in.
 */
export const DEFAULT_SOURCE_DOWN_TOLERANCE = 0.25;

/**
 * Bound 1 of the classifier: source-vs-device.
 *
 * - lossless source replacing a lossy device copy -> `lossless-boundary` (up,
 *   a correctness precondition)
 * - a LOSSY source whose bitrate has dropped meaningfully below the device's
 *   RECORDED (sync-tag) bitrate -> `source-down-suppressed` (report-only): the
 *   user replaced the source with a worse copy, so podkit keeps the better
 *   device copy and never re-encodes down to the degraded source.
 * - everything else on this bound -> null
 *
 * A lossy source whose bitrate climbed above the device copy is NOT a quality
 * change here (ADR-023): re-encoding a lossy source up cannot recover discarded
 * information. A genuinely re-ripped/changed source file (same or higher quality)
 * folds into ordinary content-change detection (self-healing), which re-adds it.
 *
 * Only sync-tagged tracks qualify for the source-down report: the recorded
 * bitrate is the sole quality truth, and an untagged track is opted out (no
 * authoritative recorded value to compare against).
 *
 * Exported so the music handler's match-loop detection (`detectUpdates`) can run
 * just this bound without also running the device-vs-target (preset) bound,
 * which is owned by the post-process pass.
 */
export function classifySourceBound(
  source: CollectionTrack,
  device: DeviceTrack,
  targetBitrate: number,
  tolerance: number = DEFAULT_SOURCE_DOWN_TOLERANCE
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

  // Source-down (bad re-rip): a lossy source now below the device's recorded
  // copy. The device's recorded bitrate is the sync tag (deterministic, podkit
  // wrote it); the source bitrate is the wobbly ffprobe value, so the tolerance
  // guards a trivial drift from triggering a needless report. Lossless device
  // copies record no bitrate, so the `recorded` guard naturally excludes them.
  const recorded = device.syncTag?.bitrate;
  if (
    !sourceLossless &&
    recorded !== undefined &&
    recorded > 0 &&
    source.bitrate !== undefined &&
    source.bitrate > 0 &&
    source.bitrate < recorded * (1 - tolerance)
  ) {
    return {
      reason: 'source-down-suppressed',
      direction: 'down',
      reEncodes: false,
      targetBitrate,
      encodedBitrate: recorded,
      sourceBitrate: source.bitrate,
    };
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
 * `lossless-boundary` (source bound up, device bound down), `cap-up` and
 * `cap-down` (the lossless device-bound preset moves, plus the down-only lossy
 * reduction for `cap-down`), and `encoding-mismatch` (the CBR/VBR precondition on
 * the lossless sync-tag path). `format-mismatch` and `source-down-suppressed`
 * are reserved (see the reason union).
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
  // Bound 1: source-vs-device (the lossless-boundary crossing).
  const sourceBound = classifySourceBound(input.source, input.device, input.target.presetBitrate);
  if (sourceBound) return sourceBound;

  // Bound 2: device-vs-target (the former detectPresetChange).
  return classifyDeviceBound(input);
}

/**
 * A lossless device copy whose target is now a lossy preset must re-encode DOWN
 * to the cap — a correctness precondition (the reduction axis does not apply).
 * Shared by the lossy-source guard and the lossless-source branch below.
 */
function losslessBoundaryDown(device: DeviceTrack, target: QualityTarget): QualityChange {
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

/**
 * Bound 2 of the classifier: device-vs-target (the former `detectPresetChange`
 * + `determineSyncTagDirection`). Compares the device's recorded encoding
 * against the configured target, independently of the source bound.
 *
 * Exported so the music handler's post-process pass can run just this bound
 * without re-running the source bound (which `detectUpdates` already ran in the
 * match loop, with its own transcoding-active suppression).
 *
 * Lossless tracks use the sync-tag-exact / ALAC ladder below. Lossy tracks are
 * routed to {@link classifyLossyDeviceBound}, which reuses the shared
 * lossy-reduction seam (down-only, cap-bounded, exact recorded-vs-cap) so a track
 * is never decided one way on add and a different way on re-sync.
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
    // A lossless device copy (ALAC) whose source is now LOSSY and whose target is
    // a lossy preset must still cross the lossless→lossy boundary DOWN: the
    // ceiling is a lossy cap, so the oversized lossless copy is re-encoded down
    // (from the now-lossy source) rather than left untouched. Without this guard
    // the lossy routing below reads the absent recorded bitrate of a lossless tag
    // and returns null, silently keeping the over-ceiling copy. The losslessness
    // is read tag-first (authoritative). This mirrors the lossless-source boundary
    // crossing below; it is a correctness precondition, so the reduction axis does
    // not apply.
    const losslessTarget = target.isAlacPreset || target.preset === 'lossless';
    if (!losslessTarget && isDeviceCopyLossless(device) === true) {
      return losslessBoundaryDown(device, target);
    }
    return classifyLossyDeviceBound(device, target);
  }

  // Crossing the lossless/lossy boundary is a precondition (correctness), not a
  // bitrate move: a lossless device copy whose target is now a lossy preset must
  // re-encode DOWN to the cap even when bitrate moves are frozen (`off`). This is
  // the mirror of the source-bound lossy→lossless `up` crossing. The device
  // copy's losslessness is read tag-first (authoritative) so a lossy transcode
  // tagged on a lossless-looking container is not misread as a boundary crossing.
  const targetLossless = target.isAlacPreset || target.preset === 'lossless';
  if (!targetLossless && isDeviceCopyLossless(device) === true) {
    return losslessBoundaryDown(device, target);
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
 * Lossy device-vs-target bound — the down-only reduction (ADR-023).
 *
 * Reuses the shared {@link resolveLossyReduction} seam, the single owner of the
 * down-only, cap-bounded target-bitrate table, so a lossy track is never decided
 * one way on add and a different way on re-sync.
 *
 * The seam inputs encode the device-side contract:
 * - **`sourceBitrate` is the device's RECORDED bitrate** (the sync tag — the sole
 *   quality truth, deterministic because podkit wrote it), NOT the source file's
 *   ffprobe bitrate. The iPod/DB bitrate is an unreliable proxy and is never
 *   consulted; a track with no recorded bitrate is opted out (returns null).
 * - **`deviceNative: true`** — the device already holds and plays this encoding.
 *   `preserve` keeps it untouched; `convert` reduces it only when it exceeds the
 *   cap.
 * - **Tolerance depends on the tag.** A CONVERTED preset tag (recorded == the old
 *   cap) is compared EXACTLY (tolerance 0): a cap you lowered applies fully on the
 *   next sync, and a converted track (recorded == cap) re-syncs to `copy` (a
 *   no-op). A `copy`-quality tag (a device-native track deliberately copied, whose
 *   recorded bitrate is the source bitrate and may sit in the tolerance band above
 *   the cap) is re-evaluated with the SAME source-side tolerance the add path used,
 *   so a within-tolerance copy stays copied — add and re-sync never disagree.
 *
 * `{ copy }` → in sync (null), OR a report-only `below-cap` when the copy is a
 * previously-REDUCED track now sitting below a raised cap (see
 * {@link isBelowRaisedCap}). `{ transcode, bitrate }` → a down-only `cap-down` the
 * handler turns into a `bitrateOverride` preset. A lossy CBR/VBR flip never
 * re-encodes here (ADR-023 §6): doing so is a lossy→lossy degradation that can
 * grow the file.
 *
 * The cap is `target.presetBitrate`, which the config resolver already folds
 * `customBitrate` into, so a custom bitrate is honoured for free. The axis comes
 * from `target.axis` (resolved from `[bitrate].reduce` + transfer mode by the
 * handler), defaulting to `convert` for a bare call.
 */
function classifyLossyDeviceBound(
  device: DeviceTrack,
  target: QualityTarget
): QualityChange | null {
  const encoded = device.syncTag?.bitrate;
  if (!encoded) {
    // No authoritative recorded bitrate in the sync tag — opt out rather than
    // guess from the unreliable DB bitrate. A zero (corrupt or third-party tag)
    // is treated the same: it is not a usable source bitrate for the seam.
    return null;
  }

  const cap = target.presetBitrate;
  if (!cap) {
    // No lossy cap to enforce (e.g. a lossless target preset). Leave as-is.
    return null;
  }

  // A `copy`-quality tag is a device-native track the add path deliberately
  // copied — its recorded bitrate is the source bitrate, which can legitimately
  // sit in the tolerance band just above the cap. Re-evaluate it with the SAME
  // source-side tolerance the add path used, so a within-tolerance copy stays
  // copied (add and re-sync agree) while a genuinely-lowered cap still reduces it.
  // A CONVERTED preset tag recorded == the old cap, so it is compared EXACTLY: a
  // cap you lowered applies fully on the next sync (ADR-023 §4).
  const tolerance = device.syncTag?.quality === 'copy' ? (target.reductionTolerance ?? 0) : 0;

  const result = resolveLossyReduction({
    // The codecs are consulted by the seam only on the necessity (incompatible
    // codec) path; here the device plays the recorded encoding natively, so they
    // are inert — pass the recorded codec for honesty, defaulting to AAC.
    sourceCodec: device.syncTag?.codec ?? 'aac',
    sourceBitrate: encoded,
    deviceNative: true,
    targetCodec: (target.resolvedLossyCodec ?? 'aac') as TranscodeTargetCodec,
    cap,
    axis: target.axis ?? 'convert',
    ...(target.deviceMax !== undefined && { deviceMax: target.deviceMax }),
    tolerance,
  });

  if (result.action === 'copy') {
    // Below a raised cap (report-only): a previously-REDUCED track now sits below
    // the cap because the cap was raised. Down-only reduction never re-lifts it
    // automatically (ADR-023 §7) — surface it so the user can `--force-transcode`
    // to lift it.
    if (isBelowRaisedCap(device.syncTag, target)) {
      return {
        reason: 'below-cap',
        direction: 'up',
        reEncodes: false,
        targetBitrate: cap,
        encodedBitrate: encoded,
      };
    }
    // Recorded at-or-above the target tier (in sync, only VBR wobble below the
    // nominal), or never reduced, or preserved — no work.
    return null;
  }

  return {
    reason: 'cap-down',
    direction: 'down',
    reEncodes: true,
    targetBitrate: result.bitrate,
    encodedBitrate: encoded,
  };
}

/**
 * Lossy preset qualities a transcode (reduction) records in its sync tag. A
 * device-native COPY records `quality=copy`; a lossless transcode records
 * `quality=lossless`. Only these mark a track that podkit reduced. Derived from
 * `QUALITY_PRESETS` (minus `max`, the top tier — nothing is "below a raised cap"
 * above it) so a new preset can't silently drop out of below-cap detection.
 */
const REDUCED_TAG_QUALITIES = new Set<string>(QUALITY_PRESETS.filter((preset) => preset !== 'max'));

/**
 * Whether a device track sits below a RAISED cap and qualifies for the
 * report-only below-cap signal.
 *
 * Two conditions, both required to keep the report low-noise:
 * - The track was previously REDUCED — its sync tag carries a lossy preset
 *   quality (low/medium/high), not a direct `copy` or a `lossless` encode. A
 *   device-native track simply copied below the cap was never reduced.
 * - Its recorded preset TIER is strictly below the target tier — a genuine cap
 *   raise, not mere VBR variance below the nominal at the SAME tier (e.g. a
 *   `low`/128 preset track measured at 112 against a `low`/128 cap is in sync,
 *   not below-cap).
 */
function isBelowRaisedCap(syncTag: SyncTagData | undefined, target: QualityTarget): boolean {
  if (syncTag === undefined || !REDUCED_TAG_QUALITIES.has(syncTag.quality)) return false;
  const recordedTier = QUALITY_TIER_ORDER[syncTag.quality] ?? -1;
  const targetTier = QUALITY_TIER_ORDER[target.preset] ?? -1;
  return recordedTier < targetTier;
}

/**
 * Quality tier ordering for sync-tag direction comparison (higher = higher
 * quality). Derived from `QUALITY_PRESETS` (ordered best-first) so a preset added
 * there can never silently drop out of below-cap detection or move-direction
 * resolution. `lossless` ties the top lossy preset (`max`).
 */
const QUALITY_TIER_ORDER: Record<string, number> = {
  ...Object.fromEntries(
    QUALITY_PRESETS.map((preset, i) => [preset, QUALITY_PRESETS.length - 1 - i])
  ),
  lossless: QUALITY_PRESETS.length - 1,
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
 * The quality axis (lossless-boundary / cap-up / cap-down) is owned by
 * {@link classifyQualityChange}, not this function. `detectUpgrades` covers the
 * supplementary axes only.
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
  // audio file has no embedded artwork). Re-downloading won't help; an executor
  // adapter fallback would address this.
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
 * - quality-change: a re-encoding quality move (cap-up/down, lossless-boundary).
 *   A `source-down-suppressed` quality change does NOT appear as a
 *   `quality-change` reason — it carries `reEncodes:false` and is routed off the
 *   file-replacement path by the handler, so any `quality-change` reason that
 *   reaches here is always a file replacement.
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
