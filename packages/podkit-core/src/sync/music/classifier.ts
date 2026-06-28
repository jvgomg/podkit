/**
 * Music track classifier
 *
 * Classifies source tracks against a device context, computing and caching
 * the routing decision (transcode vs copy vs optimized-copy). This extracts
 * the decision tree from the handler's `planAdd()` / `planUpdate()` into a
 * single, independently testable module.
 *
 * ## Decision Tree (ADR-010)
 *
 * 1. Device natively supports the codec -> copy (direct or optimized)
 * 2. Compatible lossy (MP3, AAC) -> copy (direct or optimized)
 * 3. Lossless + preset 'lossless' + source is ALAC -> direct copy
 * 4. Lossless -> transcode with resolved preset
 * 5. Incompatible lossy (OGG, Opus) -> transcode with bitrate capped at source
 *
 * @module
 */

import type { CollectionTrack } from '../../adapters/interface.js';
import type { AudioCodec } from '@podkit/device-types';
import type { SourceCategory, TranscodePresetRef } from '../engine/types.js';
import type { ResolvedMusicConfig } from './config.js';
import type { BitrateSyncMode } from '../engine/upgrades.js';
import { applyBitrateSyncPolicy } from '../engine/upgrades.js';
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
  /**
   * Per-device bitrate-change policy. The on-add cap is a downward bitrate move,
   * so it is gated by the same policy as a device-bound cap-down: it fires under
   * `match-cap`/`match-all`/`down-only` and is held (copied as-is) under
   * `off`/`up-only`, keeping "freeze bitrates" / "never re-encode down" honest on
   * the add path too. Defaults to `match-cap`.
   */
  readonly bitrateSync: BitrateSyncMode;
  /** Custom bitrate override in kbps */
  readonly customBitrate?: number;
  /** Where the device reads artwork from */
  readonly primaryArtworkSource?: 'database' | 'embedded' | 'sidecar';
  /** Transfer mode for file preparation */
  readonly transferMode: 'fast' | 'optimized' | 'portable';
  /** Resolved codec for lossy transcoding */
  readonly resolvedLossyCodec?: TranscodeTargetCodec;
  /** Resolved lossless stack */
  readonly resolvedLosslessStack?: (TranscodeTargetCodec | 'source')[];
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

    // 4-5. Transcode with resolved preset (lossy transcoding)
    const preset = this.buildLossyPreset(this.ctx.customBitrate);

    return {
      sourceCategory,
      deviceNative,
      isLossless,
      warnLossyToLossy,
      action: { type: 'transcode', preset },
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
   * Resolve the action for a source that would otherwise be copied as-is.
   *
   * A lossy source whose bitrate exceeds the device's lossy cap is transcoded
   * DOWN to the cap on first add, mirroring the device-bound cap-down upgrade
   * path, so a brand-new over-cap library lands at the cap in a single sync
   * rather than converging over two. Everything else is copied verbatim.
   */
  private resolveCopyOrCapAction(track: CollectionTrack, isLossless: boolean): MusicAction {
    return this.resolveLossyCapTranscode(track, isLossless) ?? this.resolveCopyAction();
  }

  /**
   * Build the on-add cap-down transcode for a lossy source above the cap, or
   * `undefined` to leave it copied as-is.
   *
   * Guards (each keeps a source on the copy path):
   * - lossless sources are never capped — re-encoding them is the lossless
   *   stack's job, not a bitrate cap;
   * - no cap configured (`presetBitrate === 0`) — a defensive fallback; no real
   *   preset produces 0 (a lossless target resolves to ~900, and lossy sources
   *   fall under it via the at/below-cap guard below);
   * - unknown source bitrate (`0`/undefined — the adapters' "not populated"
   *   sentinel) — never transcode blindly;
   * - source at/below the cap — copying is lossless-for-the-bytes, re-encoding
   *   would only degrade it for no benefit (this is also what keeps a lossy
   *   source under a lossless ~900 cap copied untouched);
   * - the bitrate-sync policy would not fire a downward move (`off`/`up-only`) —
   *   the cap is a quality preference under that policy, not a hard device
   *   constraint, so the source is copied as-is just as a device-bound cap-down
   *   would be suppressed.
   *
   * When it does fire, the action matches what {@link classifyLossyDeviceBound}'s
   * cap-down would later produce for the same source — the resolved lossy preset
   * and codec with `bitrateOverride = min(source.bitrate, cap)` — so the written
   * sync tag records the cap and the next sync is a no-op (idempotent).
   */
  private resolveLossyCapTranscode(
    track: CollectionTrack,
    isLossless: boolean
  ): MusicAction | undefined {
    if (isLossless) return undefined;

    const cap = this.ctx.presetBitrate;
    if (!cap) return undefined;

    const sourceBitrate = track.bitrate;
    if (!sourceBitrate || sourceBitrate <= cap) return undefined;

    // A downward bitrate move — gate it on the same policy as a device-bound
    // cap-down so `off`/`up-only` keep the over-cap source copied as-is.
    if (applyBitrateSyncPolicy('down', 'cap-down', this.ctx.bitrateSync) !== 'fire') {
      return undefined;
    }

    return { type: 'transcode', preset: this.buildLossyPreset(Math.min(sourceBitrate, cap)) };
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
    bitrateSync: config.bitrateSync,
    customBitrate: config.raw.customBitrate,
    primaryArtworkSource: config.primaryArtworkSource,
    transferMode: config.transferMode,
    resolvedLossyCodec: config.resolvedLossyCodec,
    resolvedLosslessStack: config.resolvedLosslessStack,
  };
}
