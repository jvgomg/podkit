/**
 * Video track classifier
 *
 * Classifies source videos against a device context, determining whether
 * each video can be passed through (copied directly) or needs transcoding.
 * This extracts the compatibility decision from the handler's `planAdd()`
 * into a single, independently testable module.
 *
 * ## Decision Tree
 *
 * 1. If no device profile → always transcode (no way to check compatibility)
 * 2. Check passthrough compatibility (container, codec, resolution, bitrate, framerate)
 * 3. If compatible → `{ type: 'passthrough' }` (copy directly)
 * 4. If not → `{ type: 'transcode', settings: VideoTranscodeSettings }` (with device constraints)
 *
 * @module
 */

import type { CollectionVideo } from '../../video/directory-adapter.js';
import type { VideoTranscodeSettings } from '../../video/types.js';
import { checkVideoCompatibility } from '../../video/compatibility.js';
import { calculateEffectiveSettings } from '../../video/quality.js';
import type { ResolvedVideoConfig } from './config.js';
import type { VideoSourceAnalysis } from '../../video/types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * The routing action for a source video.
 *
 * - `passthrough`: Copy the file as-is (container and streams are compatible)
 * - `transcode`: Transcode to device-compatible format with computed settings
 */
export type VideoAction =
  | { type: 'passthrough' }
  | { type: 'transcode'; settings: VideoTranscodeSettings };

/**
 * Full classification of a source video against a device context.
 */
export interface VideoClassification {
  /** Whether the video is already device-compatible */
  readonly compatible: boolean;
  /** The routing action (passthrough or transcode) */
  readonly action: VideoAction;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a synthetic VideoSourceAnalysis from CollectionVideo.
 *
 * CollectionVideo contains the probe results embedded, so we can construct
 * a VideoSourceAnalysis for compatibility checking.
 */
function toSourceAnalysis(video: CollectionVideo): VideoSourceAnalysis {
  return {
    filePath: video.filePath,
    container: video.container,
    videoCodec: video.videoCodec,
    videoProfile: null, // Not available in CollectionVideo
    videoLevel: null,
    width: video.width,
    height: video.height,
    videoBitrate: 0, // Not available in CollectionVideo
    frameRate: 0, // Not available in CollectionVideo
    audioCodec: video.audioCodec,
    audioBitrate: 0,
    audioChannels: 2, // Assume stereo
    audioSampleRate: 48000, // Assume standard sample rate
    duration: video.duration,
    hasVideoStream: true,
    hasAudioStream: true,
  };
}

// =============================================================================
// Classifier
// =============================================================================

/**
 * Classifies source videos against a device context.
 *
 * Computes and caches the routing decision for each video by file path.
 */
export class VideoTrackClassifier {
  private readonly cache = new Map<string, VideoClassification>();

  constructor(private readonly config: ResolvedVideoConfig) {}

  /**
   * Classify a source video, returning a cached result if available.
   */
  classify(source: CollectionVideo): VideoClassification {
    const cached = this.cache.get(source.filePath);
    if (cached) return cached;

    const classification = this.computeClassification(source);
    this.cache.set(source.filePath, classification);
    return classification;
  }

  private computeClassification(source: CollectionVideo): VideoClassification {
    const { deviceProfile, videoQuality, hardwareAcceleration } = this.config;

    // No device profile → always transcode with default settings
    if (!deviceProfile) {
      return {
        compatible: false,
        action: {
          type: 'transcode',
          settings: this.buildDefaultTranscodeSettings(hardwareAcceleration),
        },
      };
    }

    // Check compatibility against device profile
    const analysis = toSourceAnalysis(source);
    const compatibility = checkVideoCompatibility(analysis, deviceProfile);

    if (compatibility.status === 'passthrough') {
      return {
        compatible: true,
        action: { type: 'passthrough' },
      };
    }

    // Needs transcoding — compute effective settings from quality preset + device profile
    const settings = calculateEffectiveSettings(analysis, videoQuality, deviceProfile);

    return {
      compatible: false,
      action: {
        type: 'transcode',
        settings: {
          ...settings,
          useHardwareAcceleration: hardwareAcceleration,
        },
      },
    };
  }

  /**
   * Build default transcode settings when no device profile is available.
   *
   * Uses reasonable defaults for iPod Classic-class devices.
   */
  private buildDefaultTranscodeSettings(useHardwareAcceleration: boolean): VideoTranscodeSettings {
    return {
      targetVideoBitrate: 1500,
      targetAudioBitrate: 128,
      targetWidth: 640,
      targetHeight: 480,
      videoProfile: 'baseline',
      videoLevel: '3.0',
      crf: 23,
      frameRate: 30,
      useHardwareAcceleration: useHardwareAcceleration,
    };
  }
}
