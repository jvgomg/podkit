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
import type { AudioCodec } from '../../device/capabilities.js';
import type { SourceCategory, TranscodePresetRef } from '../engine/types.js';
import type { ResolvedMusicConfig } from './config.js';
import { categorizeSource, isDeviceCompatible } from './planner.js';

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
  /** Custom bitrate override in kbps */
  readonly customBitrate?: number;
  /** Where the device reads artwork from */
  readonly primaryArtworkSource?: 'database' | 'embedded' | 'sidecar';
  /** Transfer mode for file preparation */
  readonly transferMode: 'fast' | 'optimized' | 'portable';
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
    const sourceCategory = categorizeSource(track);
    const isLossless = sourceCategory === 'lossless';
    const warnLossyToLossy = sourceCategory === 'incompatible-lossy';

    // 1. Device natively supports the codec -> copy
    if (deviceNative) {
      return {
        sourceCategory,
        deviceNative,
        isLossless,
        warnLossyToLossy,
        action: this.resolveCopyAction(),
      };
    }

    // 2. Compatible lossy (MP3, AAC) -> copy
    if (sourceCategory === 'compatible-lossy') {
      return {
        sourceCategory,
        deviceNative,
        isLossless,
        warnLossyToLossy,
        action: this.resolveCopyAction(),
      };
    }

    // 3-5. Lossless or incompatible lossy -- needs transcoding
    const presetName = this.resolvePresetName();

    // 3. Lossless + preset 'lossless' + source is ALAC -> direct copy
    if (presetName === 'lossless' && track.codec?.toLowerCase() === 'alac') {
      return {
        sourceCategory,
        deviceNative,
        isLossless,
        warnLossyToLossy,
        action: { type: 'direct-copy' },
      };
    }

    // 4-5. Transcode with resolved preset
    const preset: TranscodePresetRef = {
      name: presetName as TranscodePresetRef['name'],
      ...(this.ctx.customBitrate !== undefined && {
        bitrateOverride: this.ctx.customBitrate,
      }),
    };

    return {
      sourceCategory,
      deviceNative,
      isLossless,
      warnLossyToLossy,
      action: { type: 'transcode', preset },
    };
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
    customBitrate: config.raw.customBitrate,
    primaryArtworkSource: config.primaryArtworkSource,
    transferMode: config.transferMode,
  };
}
