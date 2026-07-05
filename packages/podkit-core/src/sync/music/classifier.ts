/**
 * Music track classifier
 *
 * Classifies source tracks against a device context, computing and caching
 * the routing decision (transcode vs copy vs optimized-copy). This extracts
 * the decision tree from the handler's `planAdd()` / `planUpdate()` into a
 * single, independently testable module.
 *
 * ## Decision Tree (ADR-010, ADR-023)
 *
 * 1. Device natively supports the codec -> copy or reduce via the lossy-reduction seam
 * 2. Compatible lossy (MP3, AAC) -> copy or reduce via the lossy-reduction seam
 * 3. Lossless + preset 'lossless' + source is ALAC -> direct copy
 * 4. Lossless -> transcode with resolved preset
 * 5. Incompatible lossy (OGG, Opus) -> transcode via the lossy-reduction seam
 *
 * The lossy bitrate decision (copy vs reduce, and the target bitrate) lives in
 * one pure seam — {@link resolveLossyReduction} — shared with the re-sync and
 * adoption paths, so a track is never decided two ways (ADR-023).
 *
 * @module
 */

import type { CollectionTrack } from '../../adapters/interface.js';
import type { AudioCodec } from '@podkit/device-types';
import type { SourceCategory, TranscodePresetRef } from '../engine/types.js';
import type { ResolvedMusicConfig } from './config.js';
import { resolveLossyReduction } from '../engine/lossy-reduction.js';
import type { ReductionAxis } from '../engine/lossy-reduction.js';
import { categorizeSource, isDeviceCompatible, fileTypeToAudioCodec } from './planner.js';
import type { TranscodeTargetCodec } from '../../transcode/codecs.js';
import { CODEC_METADATA } from '../../transcode/codecs.js';

// =============================================================================
// Types
// =============================================================================

/**
 * The routing action for a source track.
 *
 * - `direct-copy`: Copy the file as-is (fastest)
 * - `optimized-copy`: Copy via FFmpeg passthrough (strips/resizes artwork)
 * - `transcode`: Transcode to a target format/bitrate
 */
export type MusicAction =
  | { type: 'direct-copy' }
  | { type: 'optimized-copy' }
  | { type: 'transcode'; preset: TranscodePresetRef };

/**
 * Full classification of a source track against a device context.
 */
export interface TrackClassification {
  /** Source file category (lossless, compatible-lossy, incompatible-lossy) */
  readonly sourceCategory: SourceCategory;
  /** Whether the device natively supports this codec */
  readonly deviceNative: boolean;
  /** Whether the source is lossless */
  readonly isLossless: boolean;
  /** Whether this track will produce a lossy-to-lossy warning */
  readonly warnLossyToLossy: boolean;
  /** The routing action (copy, optimized-copy, or transcode) */
  readonly action: MusicAction;
}

/**
 * Device context for classification decisions.
 *
 * Constructed from a `ResolvedMusicConfig` via `classifierFromConfig()`.
 */
export interface ClassifierContext {
  /** Audio codecs the device supports natively */
  readonly supportedAudioCodecs?: AudioCodec[];
  /** Whether the device supports ALAC playback */
  readonly deviceSupportsAlac: boolean;
  /** Resolved quality label ('lossless' | 'high' | 'medium' | 'low') */
  readonly resolvedQuality: string;
  /**
   * Target bitrate (kbps) for the resolved quality — the lossy cap. A
   * compatible/device-native lossy source whose bitrate exceeds this cap is
   * transcoded down to it on first add, instead of copied as-is and re-encoded
   * down on the next sync. A lossless target resolves to the ALAC preset's
   * nominal (~900 kbps), well above any real lossy source, so lossy sources stay
   * under it and are copied untouched (`0` is only a defensive
   * unconfigured-cap fallback, not produced by any real preset).
   */
  readonly presetBitrate: number;
  /** Custom bitrate override in kbps */
  readonly customBitrate?: number;
  /** Where the device reads artwork from */
  readonly primaryArtworkSource?: 'database' | 'embedded' | 'sidecar';
  /** Transfer mode for file preparation */
  readonly transferMode: 'fast' | 'optimized' | 'portable';
  /**
   * Resolved lossy-reduction axis (`convert` reduces over-cap device-native
   * lossy; `preserve` copies it untouched). Resolved once in
   * `resolveMusicConfig` from `[bitrate].reduce` + the transfer mode.
   */
  readonly reductionAxis: ReductionAxis;
  /**
   * Source-proximity tolerance (fraction of the cap) for the add-path reduce
   * gate: a device-native source is reduced only when `source > cap × (1 + tol)`.
   */
  readonly reductionTolerance: number;
  /** Resolved codec for lossy transcoding */
  readonly resolvedLossyCodec?: TranscodeTargetCodec;
  /** Resolved lossless stack */
  readonly resolvedLosslessStack?: (TranscodeTargetCodec | 'source')[];
  /**
   * Device maximum lossy audio bitrate (kbps), when the device declares one.
   * `undefined` → unbounded. Passed to the lossy-reduction seam as `deviceMax`,
   * where it clamps only the preserve-necessity target (the one row that can
   * land above the source bitrate).
   */
  readonly deviceMaxBitrate?: number;
}

// =============================================================================
// Classifier
// =============================================================================

/**
 * Classifies source tracks against a device context.
 *
 * Computes and caches the routing decision for each track by file path.
 * Thread-safe for single-threaded use (no concurrent mutation).
 */
export class MusicTrackClassifier {
  private readonly cache = new Map<string, TrackClassification>();

  constructor(private readonly ctx: ClassifierContext) {}

  /**
   * Classify a source track, returning a cached result if available.
   */
  classify(track: CollectionTrack): TrackClassification {
    const cached = this.cache.get(track.filePath);
    if (cached) return cached;

    const classification = this.computeClassification(track);
    this.cache.set(track.filePath, classification);
    return classification;
  }

  private computeClassification(track: CollectionTrack): TrackClassification {
    const deviceNative = isDeviceCompatible(track, this.ctx.supportedAudioCodecs);
    const sourceCategory = categorizeSource(track, this.ctx.supportedAudioCodecs);
    const isLossless = sourceCategory === 'lossless';
    const warnLossyToLossy = sourceCategory === 'incompatible-lossy';

    // 1. Device natively supports the codec -> copy
    //    Exception: lossless sources with a non-lossless quality preset should
    //    be transcoded (e.g., FLAC on a FLAC-capable device with quality=high
    //    should produce AAC, not copy FLAC).
    if (deviceNative && !(isLossless && this.resolvePresetName() !== 'lossless')) {
      return {
        sourceCategory,
        deviceNative,
        isLossless,
        warnLossyToLossy,
        action: this.resolveCopyOrCapAction(track, isLossless),
      };
    }

    // 2. Compatible lossy (MP3, AAC) -> copy
    if (sourceCategory === 'compatible-lossy') {
      return {
        sourceCategory,
        deviceNative,
        isLossless,
        warnLossyToLossy,
        action: this.resolveCopyOrCapAction(track, isLossless),
      };
    }

    // 3-5. Lossless or incompatible lossy -- needs transcoding
    const presetName = this.resolvePresetName();

    // 3. Lossless + preset 'lossless' -> walk the lossless stack
    if (presetName === 'lossless' && isLossless) {
      const losslessAction = this.resolveLosslessAction(track);
      if (losslessAction) {
        return {
          sourceCategory,
          deviceNative,
          isLossless,
          warnLossyToLossy,
          action: losslessAction,
        };
      }
      // No lossless codec matched -> fall through to lossy at 'high'
      const fallbackPreset: TranscodePresetRef = {
        name: 'high',
        ...(this.ctx.resolvedLossyCodec && { targetCodec: this.ctx.resolvedLossyCodec }),
        ...(this.ctx.customBitrate !== undefined && { bitrateOverride: this.ctx.customBitrate }),
      };
      return {
        sourceCategory,
        deviceNative,
        isLossless,
        warnLossyToLossy: false,
        action: { type: 'transcode', preset: fallbackPreset },
      };
    }

    // 4. Lossless source at a lossy preset → transcode at the resolved preset
    //    (the lossless→lossy boundary; the cap is the preset's nominal bitrate).
    if (isLossless) {
      return {
        sourceCategory,
        deviceNative,
        isLossless,
        warnLossyToLossy,
        action: { type: 'transcode', preset: this.buildLossyPreset(this.ctx.customBitrate) },
      };
    }

    // 5. Incompatible lossy (necessity) → the device cannot play the codec, so a
    //    transcode is unavoidable. Routed through the same lossy-reduction seam
    //    as the copy path so the full ADR-023 table is exercised in one place.
    return {
      sourceCategory,
      deviceNative,
      isLossless,
      warnLossyToLossy,
      action: this.resolveLossyAction(track, false),
    };
  }

  /**
   * Walk the resolved lossless stack to find a suitable lossless action.
   *
   * For `'source'`: if the source track's lossless codec is a valid transcoding
   * target AND the device supports it, use direct copy. Skip WAV/AIFF (not
   * transcoding targets, too large to copy).
   *
   * For specific codecs (FLAC, ALAC): if the device supports it and the encoder
   * is available (implied by presence in the resolved stack), transcode to that codec.
   *
   * Returns undefined if no lossless codec matches (caller should fall through to lossy).
   */
  private resolveLosslessAction(track: CollectionTrack): MusicAction | undefined {
    const stack = this.ctx.resolvedLosslessStack;

    if (!stack) {
      // Legacy path: no resolved stack. Use old ALAC-only behavior.
      if (track.codec?.toLowerCase() === 'alac') {
        return { type: 'direct-copy' };
      }
      // Legacy: transcode to lossless (ALAC)
      return {
        type: 'transcode',
        preset: { name: 'lossless' as TranscodePresetRef['name'] },
      };
    }

    if (stack.length === 0) {
      // Resolved stack is empty — no lossless codec available, fall through to lossy
      return undefined;
    }

    const supportedCodecs = this.ctx.supportedAudioCodecs;

    for (const entry of stack) {
      if (entry === 'source') {
        // Check if the source's lossless codec is a valid transcoding target
        // and the device supports it. Skip WAV/AIFF (not in CODEC_METADATA).
        const sourceCodec = fileTypeToAudioCodec(track.fileType, track.codec);
        if (
          sourceCodec &&
          sourceCodec in CODEC_METADATA &&
          supportedCodecs?.includes(sourceCodec)
        ) {
          return this.resolveCopyAction();
        }
        // Source codec not suitable for direct copy — try next in stack
        continue;
      }

      // Specific codec entry — already validated by the resolver as device-supported
      // and encoder-available. Transcode to this codec.
      const preset: TranscodePresetRef = {
        name: 'lossless' as TranscodePresetRef['name'],
        targetCodec: entry,
      };
      return { type: 'transcode', preset };
    }

    // No lossless codec matched
    return undefined;
  }

  /**
   * Build a lossy `TranscodePresetRef` at the resolved quality + codec.
   *
   * Shared by the lossy-transcode path (4–5) and the on-add cap so the two keep
   * the same shape — a drift between them (e.g. a different codec or a dropped
   * `bitrateOverride`) would silently break cap idempotency. `bitrateOverride` is
   * spread only when defined, mirroring the device-bound cap-down preset built in
   * `MusicHandler.resolveUpgradeAction`.
   */
  private buildLossyPreset(bitrateOverride?: number): TranscodePresetRef {
    return {
      name: this.resolvePresetName() as TranscodePresetRef['name'],
      ...(this.ctx.resolvedLossyCodec && { targetCodec: this.ctx.resolvedLossyCodec }),
      ...(bitrateOverride !== undefined && { bitrateOverride }),
    };
  }

  /**
   * Resolve the action for a lossy source that is otherwise a copy candidate
   * (device-native or compatible-lossy). Lossless sources are copied directly —
   * they never enter the lossy-reduction seam.
   */
  private resolveCopyOrCapAction(track: CollectionTrack, isLossless: boolean): MusicAction {
    if (isLossless) return this.resolveCopyAction();
    return this.resolveLossyAction(track, true);
  }

  /**
   * Resolve a lossy source's action through the shared lossy-reduction seam
   * ({@link resolveLossyReduction}) — the single owner of the ADR-023 down-only,
   * cap-bounded target-bitrate table.
   *
   * `deviceNative` is the copy-path flag: `true` for a source the device plays
   * as-is (preserve copies it; convert reduces it only when it exceeds the
   * tolerance band), `false` for an incompatible codec the device cannot play
   * (a necessity transcode). The seam decides copy-vs-transcode and the target
   * bitrate; this method maps that onto a {@link MusicAction} and handles the
   * inputs the seam excludes:
   * - no known source bitrate, or no configured cap (`presetBitrate === 0`, a
   *   defensive fallback no real preset produces): a copy candidate is copied
   *   verbatim (never transcode blindly), while a necessity transcode falls back
   *   to the resolved preset's own nominal bitrate.
   *
   * The reduction axis and tolerance are resolved once in `resolveMusicConfig`
   * (from `[bitrate].reduce` / `[bitrate].tolerance` + the transfer mode) and
   * read straight off the context here, so add and re-sync share one resolution.
   */
  private resolveLossyAction(track: CollectionTrack, deviceNative: boolean): MusicAction {
    const cap = this.ctx.presetBitrate;
    const sourceBitrate = track.bitrate;

    if (!sourceBitrate || !cap) {
      return deviceNative
        ? this.resolveCopyAction()
        : { type: 'transcode', preset: this.buildLossyPreset(this.ctx.customBitrate) };
    }

    const result = resolveLossyReduction({
      sourceCodec: fileTypeToAudioCodec(track.fileType, track.codec) ?? 'aac',
      sourceBitrate,
      deviceNative,
      // When no lossy codec is resolved, the preset omits targetCodec and the
      // transcoder defaults to AAC; the seam's efficiency match defaults to the
      // same 'aac' so the computed bitrate matches the codec actually produced.
      targetCodec: this.ctx.resolvedLossyCodec ?? 'aac',
      cap,
      axis: this.ctx.reductionAxis,
      ...(this.ctx.deviceMaxBitrate !== undefined && { deviceMax: this.ctx.deviceMaxBitrate }),
      tolerance: this.ctx.reductionTolerance,
    });

    if (result.action === 'copy') return this.resolveCopyAction();
    return { type: 'transcode', preset: this.buildLossyPreset(result.bitrate) };
  }

  /**
   * Resolve the copy action based on artwork source and transfer mode.
   *
   * - Embedded artwork devices always need optimized-copy (FFmpeg resize)
   * - Optimized transfer mode routes through FFmpeg to strip artwork
   * - Otherwise, direct copy is fastest
   */
  private resolveCopyAction(): MusicAction {
    if (this.ctx.primaryArtworkSource === 'embedded') {
      return { type: 'optimized-copy' };
    }
    if (this.ctx.transferMode === 'optimized') {
      return { type: 'optimized-copy' };
    }
    return { type: 'direct-copy' };
  }

  /**
   * Resolve the transcode preset name from the context.
   *
   * The resolvedQuality is already resolved from 'max' to 'lossless' or 'high'
   * by classifierFromConfig(), so we use it directly.
   */
  private resolvePresetName(): string {
    return this.ctx.resolvedQuality;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Build a `ClassifierContext` from a `ResolvedMusicConfig`.
 *
 * This is the bridge between the config resolution layer and the classifier.
 */
export function classifierFromConfig(config: ResolvedMusicConfig): ClassifierContext {
  return {
    supportedAudioCodecs: config.supportedAudioCodecs,
    deviceSupportsAlac: config.deviceSupportsAlac,
    resolvedQuality: config.resolvedQuality,
    presetBitrate: config.presetBitrate,
    customBitrate: config.raw.customBitrate,
    primaryArtworkSource: config.primaryArtworkSource,
    transferMode: config.transferMode,
    reductionAxis: config.reductionAxis,
    reductionTolerance: config.reductionTolerance,
    resolvedLossyCodec: config.resolvedLossyCodec,
    resolvedLosslessStack: config.resolvedLosslessStack,
    deviceMaxBitrate: config.deviceMaxBitrate,
  };
}
