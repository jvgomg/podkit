/**
 * Video compatibility checker
 *
 * Determines if a video file is iPod-compatible (passthrough),
 * needs transcoding, or is unsupported.
 */

import type {
  VideoSourceAnalysis,
  VideoDeviceProfile,
  VideoCompatibility,
  VideoCompatibilityStatus,
} from './types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of passthrough check
 *
 * Provides a simple boolean for passthrough decision along with reasons
 * explaining why passthrough is not possible (if applicable).
 */
export interface PassthroughResult {
  /** Whether the video can be copied directly without transcoding */
  canPassthrough: boolean;
  /** Reasons why passthrough is not possible (empty if canPassthrough is true) */
  reasons: string[];
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Containers that can be passed through directly
 */
const COMPATIBLE_CONTAINERS = new Set(['mp4', 'm4v']);

/**
 * Video codecs that iPods support (only H.264)
 */
const COMPATIBLE_VIDEO_CODECS = new Set(['h264', 'avc', 'avc1']);

/**
 * Video codecs that can be transcoded to H.264
 */
const TRANSCODABLE_VIDEO_CODECS = new Set([
  'hevc',
  'h265',
  'vp9',
  'vp8',
  'mpeg4',
  'mpeg2video',
  'mpeg1video',
  'wmv3',
  'wmv2',
  'wmv1',
  'vc1',
  'theora',
  'prores',
  'dnxhd',
  'mjpeg',
  'av1',
]);

/**
 * Audio codecs that iPods support in video files
 */
const COMPATIBLE_AUDIO_CODECS = new Set(['aac', 'mp4a']);

/**
 * Audio codecs that can be transcoded to AAC
 */
const TRANSCODABLE_AUDIO_CODECS = new Set([
  'mp3',
  'ac3',
  'eac3',
  'dts',
  'flac',
  'vorbis',
  'opus',
  'pcm',
  'pcm_s16le',
  'pcm_s24le',
  'pcm_s32le',
  'pcm_f32le',
  'wmav2',
  'wmav1',
  'truehd',
  'alac',
]);

/**
 * Low quality thresholds for warnings
 */
const LOW_BITRATE_THRESHOLD_KBPS = 500;
const LOW_RESOLUTION_WIDTH = 320;
const LOW_RESOLUTION_HEIGHT = 240;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a video codec is compatible with the device (passthrough)
 */
export function isCompatibleVideoCodec(
  codec: string,
  profile: string | null,
  device: VideoDeviceProfile
): boolean {
  const normalizedCodec = codec.toLowerCase();

  // Must be H.264
  if (!COMPATIBLE_VIDEO_CODECS.has(normalizedCodec)) {
    return false;
  }

  // Check profile compatibility: Baseline plays on every iPod, Main only on
  // Main devices, and any other profile (High, High 10, Extended, ...) is
  // transcoded
  if (profile) {
    const normalizedProfile = profile.toLowerCase();

    if (normalizedProfile === 'baseline' || normalizedProfile === 'constrained baseline') {
      return true;
    }

    if (normalizedProfile === 'main') {
      return device.videoProfile === 'main';
    }

    return false;
  }

  // If no profile info, assume compatible (will be verified during playback)
  return true;
}

/** H.264 level ('3', '3.0', '3.1') as a comparable number, or undefined. */
function parseH264Level(level: string | null | undefined): number | undefined {
  if (!level) return undefined;
  const value = Number.parseFloat(level);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Check if an audio codec is compatible (passthrough)
 */
export function isCompatibleAudioCodec(codec: string): boolean {
  const normalizedCodec = codec.toLowerCase();
  return COMPATIBLE_AUDIO_CODECS.has(normalizedCodec);
}

/**
 * Check if a container is compatible (passthrough)
 */
export function isCompatibleContainer(container: string): boolean {
  const normalizedContainer = container.toLowerCase();
  return COMPATIBLE_CONTAINERS.has(normalizedContainer);
}

/**
 * Check if a video codec can be transcoded
 */
function isTranscodableVideoCodec(codec: string): boolean {
  const normalizedCodec = codec.toLowerCase();
  return (
    COMPATIBLE_VIDEO_CODECS.has(normalizedCodec) || TRANSCODABLE_VIDEO_CODECS.has(normalizedCodec)
  );
}

/**
 * Check if an audio codec can be transcoded
 */
function isTranscodableAudioCodec(codec: string): boolean {
  const normalizedCodec = codec.toLowerCase();
  return (
    COMPATIBLE_AUDIO_CODECS.has(normalizedCodec) || TRANSCODABLE_AUDIO_CODECS.has(normalizedCodec)
  );
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Check video compatibility with a device
 *
 * Determines whether a video file can be:
 * - Passed through directly (already compatible)
 * - Transcoded to be compatible
 * - Not supported at all
 *
 * @param analysis - Analysis result from probing the video file
 * @param device - Target device profile
 * @returns Compatibility result with status, reasons, and warnings
 */
export function checkVideoCompatibility(
  analysis: VideoSourceAnalysis,
  device: VideoDeviceProfile
): VideoCompatibility {
  const reasons: string[] = [];
  const warnings: string[] = [];

  // ==========================================================================
  // Check for unsupported cases first
  // ==========================================================================

  // No video stream
  if (!analysis.hasVideoStream) {
    return {
      status: 'unsupported',
      reasons: ['No video stream'],
      warnings: [],
    };
  }

  // Unknown/exotic video codec that can't be transcoded
  if (!isTranscodableVideoCodec(analysis.videoCodec)) {
    return {
      status: 'unsupported',
      reasons: [`Unsupported video codec: ${analysis.videoCodec}`],
      warnings: [],
    };
  }

  // Unknown/exotic audio codec that can't be transcoded (if audio is present)
  if (analysis.hasAudioStream && !isTranscodableAudioCodec(analysis.audioCodec)) {
    return {
      status: 'unsupported',
      reasons: [`Unsupported audio codec: ${analysis.audioCodec}`],
      warnings: [],
    };
  }

  // ==========================================================================
  // Check for low quality warnings
  // ==========================================================================

  if (analysis.videoBitrate > 0 && analysis.videoBitrate < LOW_BITRATE_THRESHOLD_KBPS) {
    warnings.push(`Low quality source: ${analysis.videoBitrate}kbps`);
  }

  if (analysis.width < LOW_RESOLUTION_WIDTH || analysis.height < LOW_RESOLUTION_HEIGHT) {
    warnings.push(`Low resolution source: ${analysis.width}x${analysis.height}`);
  }

  // ==========================================================================
  // Check passthrough criteria
  // ==========================================================================

  // Container check
  if (!isCompatibleContainer(analysis.container)) {
    reasons.push(`Incompatible container: ${analysis.container}`);
  }

  // Video codec check
  if (!COMPATIBLE_VIDEO_CODECS.has(analysis.videoCodec.toLowerCase())) {
    reasons.push(`Incompatible video codec: ${analysis.videoCodec}`);
  } else {
    // H.264 but check profile compatibility
    if (
      analysis.videoProfile &&
      !isCompatibleVideoCodec(analysis.videoCodec, analysis.videoProfile, device)
    ) {
      reasons.push(`Incompatible video profile: ${analysis.videoProfile}`);
    }

    // A level above the device's cannot be decoded; an unknown one cannot be
    // shown to be within it, so it is transcoded rather than copied.
    const level = parseH264Level(analysis.videoLevel);
    const deviceLevel = parseH264Level(device.videoLevel)!;
    if (level === undefined) {
      reasons.push('Unknown H.264 level');
    } else if (level > deviceLevel) {
      reasons.push(
        `H.264 level exceeds device maximum: ${analysis.videoLevel} > ${device.videoLevel}`
      );
    }
  }

  // Resolution check
  if (analysis.width > device.maxWidth || analysis.height > device.maxHeight) {
    reasons.push(
      `Resolution exceeds device maximum: ${analysis.width}x${analysis.height} > ${device.maxWidth}x${device.maxHeight}`
    );
  }

  // Video bitrate check
  if (analysis.videoBitrate > device.maxVideoBitrate) {
    reasons.push(
      `Video bitrate exceeds maximum: ${analysis.videoBitrate}kbps > ${device.maxVideoBitrate}kbps`
    );
  }

  // Frame rate check
  if (analysis.frameRate > device.maxFrameRate) {
    reasons.push(
      `Frame rate exceeds maximum: ${analysis.frameRate}fps > ${device.maxFrameRate}fps`
    );
  }

  // Audio codec check (if audio is present)
  if (analysis.hasAudioStream && !isCompatibleAudioCodec(analysis.audioCodec)) {
    reasons.push(`Incompatible audio codec: ${analysis.audioCodec}`);
  }

  // ==========================================================================
  // Determine final status
  // ==========================================================================

  let status: VideoCompatibilityStatus;

  if (reasons.length === 0) {
    status = 'passthrough';
  } else {
    status = 'transcode';
  }

  return {
    status,
    reasons,
    warnings,
  };
}

// =============================================================================
// Passthrough Helper
// =============================================================================

/**
 * Check if a video can be passed through directly without transcoding
 *
 * This is a convenience wrapper around checkVideoCompatibility() that provides
 * a simpler API focused on the passthrough decision.
 *
 * @param analysis - Analysis result from probing the video file
 * @param device - Target device profile
 * @returns PassthroughResult with canPassthrough boolean and reasons
 *
 * @example
 * ```typescript
 * const analysis = await probeVideo('/path/to/video.mp4');
 * const device = getDeviceProfile('ipod-classic');
 * const result = canPassthrough(analysis, device);
 *
 * if (result.canPassthrough) {
 *   // Copy directly
 * } else {
 *   console.log('Needs transcoding:', result.reasons.join(', '));
 * }
 * ```
 */
export function canPassthrough(
  analysis: VideoSourceAnalysis,
  device: VideoDeviceProfile
): PassthroughResult {
  const compatibility = checkVideoCompatibility(analysis, device);
  return {
    canPassthrough: compatibility.status === 'passthrough',
    reasons: compatibility.reasons,
  };
}
