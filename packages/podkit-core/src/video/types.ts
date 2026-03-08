/**
 * Video transcoding types and device profiles
 *
 * FFmpeg-based transcoding for converting video files
 * to iPod-compatible formats (H.264/M4V).
 *
 * ## Quality Presets
 *
 * Video presets control bitrate, not resolution. Resolution is always
 * matched to device capabilities. Source quality is respected.
 *
 * | Preset | Description | Use Case |
 * |--------|-------------|----------|
 * | `max` | Highest quality | Best viewing, ample storage |
 * | `high` | Excellent quality | General use (default) |
 * | `medium` | Good quality | Limited storage |
 * | `low` | Space-efficient | Maximum capacity |
 *
 * ## Device Profiles
 *
 * Different iPod models have different video capabilities:
 *
 * | Device | Max Resolution | Profile |
 * |--------|---------------|---------|
 * | iPod Classic | 640x480 | Main 3.1 |
 * | iPod Video 5G | 320x240 | Baseline 3.0 |
 * | iPod Nano 3G-5G | 320x240 | Baseline 3.0 |
 */

// =============================================================================
// Quality Presets
// =============================================================================

/**
 * Video quality preset names
 *
 * Unlike audio which has VBR/CBR variants, video uses CRF-based
 * encoding with bitrate caps for consistent quality.
 */
export type VideoQualityPreset = 'max' | 'high' | 'medium' | 'low';

/**
 * All valid video quality preset names
 */
export const VIDEO_QUALITY_PRESETS: readonly VideoQualityPreset[] = [
  'max',
  'high',
  'medium',
  'low',
] as const;

/**
 * Check if a string is a valid video quality preset
 */
export function isValidVideoQualityPreset(value: string): value is VideoQualityPreset {
  return VIDEO_QUALITY_PRESETS.includes(value as VideoQualityPreset);
}

// =============================================================================
// Device Profiles
// =============================================================================

/**
 * Video codec supported by iPods
 */
export type VideoCodec = 'h264';

/**
 * H.264 profile level
 */
export type VideoProfile = 'baseline' | 'main';

/**
 * Audio codec for video files
 */
export type VideoAudioCodec = 'aac';

/**
 * Device profile defining video capabilities for a specific iPod model
 */
export interface VideoDeviceProfile {
  /** Internal identifier (e.g., 'ipod-classic') */
  name: string;

  /** User-friendly display name (e.g., 'iPod Classic') */
  displayName: string;

  /** Maximum video width in pixels */
  maxWidth: number;

  /** Maximum video height in pixels */
  maxHeight: number;

  /** Maximum video bitrate in kbps */
  maxVideoBitrate: number;

  /** Maximum audio bitrate in kbps */
  maxAudioBitrate: number;

  /** Video codec (always H.264 for iPods) */
  videoCodec: VideoCodec;

  /** H.264 profile (baseline or main) */
  videoProfile: VideoProfile;

  /** H.264 level (e.g., '3.0', '3.1') */
  videoLevel: string;

  /** Audio codec (always AAC for iPods) */
  audioCodec: VideoAudioCodec;

  /** Maximum frame rate */
  maxFrameRate: number;

  /** Whether this device supports video playback */
  supportsVideo: boolean;
}

/**
 * Built-in device profiles for supported iPod models
 *
 * Profile specifications from Apple technical documentation:
 * - iPod Classic: 640x480, Main profile, level 3.1
 * - iPod Video 5G: 320x240, Baseline profile, level 3.0
 * - iPod Nano 3G-5G: 320x240, Baseline profile, level 3.0
 */
export const DEVICE_PROFILES: Record<string, VideoDeviceProfile> = {
  'ipod-classic': {
    name: 'ipod-classic',
    displayName: 'iPod Classic',
    maxWidth: 640,
    maxHeight: 480,
    maxVideoBitrate: 2500,
    maxAudioBitrate: 160,
    videoCodec: 'h264',
    videoProfile: 'main',
    videoLevel: '3.1',
    audioCodec: 'aac',
    maxFrameRate: 30,
    supportsVideo: true,
  },

  'ipod-video-5g': {
    name: 'ipod-video-5g',
    displayName: 'iPod Video (5th Gen)',
    maxWidth: 320,
    maxHeight: 240,
    maxVideoBitrate: 768,
    maxAudioBitrate: 128,
    videoCodec: 'h264',
    videoProfile: 'baseline',
    videoLevel: '3.0',
    audioCodec: 'aac',
    maxFrameRate: 30,
    supportsVideo: true,
  },

  'ipod-nano-3g': {
    name: 'ipod-nano-3g',
    displayName: 'iPod Nano (3rd-5th Gen)',
    maxWidth: 320,
    maxHeight: 240,
    maxVideoBitrate: 768,
    maxAudioBitrate: 128,
    videoCodec: 'h264',
    videoProfile: 'baseline',
    videoLevel: '3.0',
    audioCodec: 'aac',
    maxFrameRate: 30,
    supportsVideo: true,
  },
} as const;

/**
 * Get a device profile by name
 */
export function getDeviceProfile(name: string): VideoDeviceProfile | undefined {
  return DEVICE_PROFILES[name];
}

/**
 * Get the default device profile (iPod Classic)
 */
export function getDefaultDeviceProfile(): VideoDeviceProfile {
  // ipod-classic is guaranteed to exist in DEVICE_PROFILES
  return DEVICE_PROFILES['ipod-classic']!;
}

/**
 * Get device profile by iPod generation string from libgpod
 *
 * Maps the generation identifier from ipod.getInfo().device.generation
 * to the appropriate video device profile.
 *
 * @param generation - Generation string from libgpod (e.g., 'video_1', 'classic_1')
 * @returns The matching device profile, or default profile if not matched
 */
export function getDeviceProfileByGeneration(generation: string): VideoDeviceProfile {
  // Map libgpod generation identifiers to our device profiles
  // See: https://www.libgpod.org/api/model_id.html
  const generationMap: Record<string, string> = {
    // iPod Video 5th gen (video_1)
    'video_1': 'ipod-video-5g',
    'video_2': 'ipod-video-5g', // Enhanced variant

    // iPod Classic 6th/7th gen (classic_1, classic_2, classic_3)
    'classic_1': 'ipod-classic',
    'classic_2': 'ipod-classic',
    'classic_3': 'ipod-classic',

    // iPod Nano with video support
    'nano_3': 'ipod-nano-3g',
    'nano_4': 'ipod-nano-3g',
    'nano_5': 'ipod-nano-3g',
  };

  const profileName = generationMap[generation];
  if (profileName) {
    return DEVICE_PROFILES[profileName]!;
  }

  // Default to ipod-classic for unknown generations
  return DEVICE_PROFILES['ipod-classic']!;
}

/**
 * Get all device profile names
 */
export function getDeviceProfileNames(): string[] {
  return Object.keys(DEVICE_PROFILES);
}

// =============================================================================
// Source Analysis
// =============================================================================

/**
 * Analysis result from probing a video source file
 *
 * Contains all relevant technical information needed to determine
 * compatibility and transcoding requirements.
 */
export interface VideoSourceAnalysis {
  /** Path to the source file */
  filePath: string;

  /** Container format (e.g., 'mkv', 'mp4', 'avi') */
  container: string;

  // Video stream information
  /** Video codec name (e.g., 'h264', 'hevc', 'vp9') */
  videoCodec: string;

  /** H.264 profile if applicable (e.g., 'baseline', 'main', 'high') */
  videoProfile: string | null;

  /** H.264 level if applicable (e.g., '3.0', '4.0') */
  videoLevel: string | null;

  /** Video width in pixels */
  width: number;

  /** Video height in pixels */
  height: number;

  /** Video bitrate in kbps */
  videoBitrate: number;

  /** Frame rate in fps */
  frameRate: number;

  // Audio stream information
  /** Audio codec name (e.g., 'aac', 'mp3', 'ac3') */
  audioCodec: string;

  /** Audio bitrate in kbps */
  audioBitrate: number;

  /** Number of audio channels */
  audioChannels: number;

  /** Audio sample rate in Hz */
  audioSampleRate: number;

  // Duration and stream presence
  /** Total duration in seconds */
  duration: number;

  /** Whether the file has a video stream */
  hasVideoStream: boolean;

  /** Whether the file has an audio stream */
  hasAudioStream: boolean;
}

// =============================================================================
// Transcode Settings
// =============================================================================

/**
 * Settings for a video transcode operation
 *
 * These are the concrete encoding parameters derived from
 * the quality preset and device profile.
 */
export interface VideoTranscodeSettings {
  /** Target video width in pixels */
  targetWidth: number;

  /** Target video height in pixels */
  targetHeight: number;

  /** Target video bitrate in kbps (used as maxrate) */
  targetVideoBitrate: number;

  /** Target audio bitrate in kbps */
  targetAudioBitrate: number;

  /** H.264 profile to use */
  videoProfile: VideoProfile;

  /** H.264 level to use */
  videoLevel: string;

  /** Constant Rate Factor for quality-based encoding (lower = better) */
  crf: number;

  /** Target frame rate in fps */
  frameRate: number;

  /** Whether to use hardware acceleration (e.g., VideoToolbox) */
  useHardwareAcceleration: boolean;
}

// =============================================================================
// Compatibility
// =============================================================================

/**
 * Compatibility status for a video file with a device
 */
export type VideoCompatibilityStatus = 'passthrough' | 'transcode' | 'unsupported';

/**
 * Compatibility analysis result
 *
 * Indicates whether a video can be:
 * - Passed through as-is (already compatible)
 * - Transcoded to be compatible
 * - Not supported at all
 */
export interface VideoCompatibility {
  /** Overall compatibility status */
  status: VideoCompatibilityStatus;

  /** Reasons why transcoding is needed or file is unsupported */
  reasons: string[];

  /** Non-blocking warnings (e.g., 'Low quality source') */
  warnings: string[];
}

// =============================================================================
// Preset Settings
// =============================================================================

/**
 * Encoding parameters for a specific quality preset
 */
export interface VideoPresetSettings {
  /** Target video bitrate in kbps */
  videoBitrate: number;

  /** Target audio bitrate in kbps */
  audioBitrate: number;

  /** CRF value (lower = higher quality, larger file) */
  crf: number;
}

/**
 * Preset settings mapped by device profile and quality preset
 *
 * Structure: VIDEO_PRESET_SETTINGS[deviceProfile][qualityPreset]
 *
 * CRF values:
 * - 18-20: Near-lossless, large files
 * - 21-23: Excellent quality
 * - 24-26: Good quality
 * - 27-28: Acceptable quality
 */
export const VIDEO_PRESET_SETTINGS: Record<string, Record<VideoQualityPreset, VideoPresetSettings>> = {
  // iPod Classic (640x480, Main profile)
  'ipod-classic': {
    max: { videoBitrate: 2500, audioBitrate: 160, crf: 18 },
    high: { videoBitrate: 2000, audioBitrate: 128, crf: 21 },
    medium: { videoBitrate: 1500, audioBitrate: 128, crf: 24 },
    low: { videoBitrate: 1000, audioBitrate: 96, crf: 27 },
  },

  // iPod Video 5th Gen (320x240, Baseline profile)
  'ipod-video-5g': {
    max: { videoBitrate: 768, audioBitrate: 128, crf: 20 },
    high: { videoBitrate: 600, audioBitrate: 128, crf: 23 },
    medium: { videoBitrate: 400, audioBitrate: 96, crf: 26 },
    low: { videoBitrate: 300, audioBitrate: 96, crf: 28 },
  },

  // iPod Nano 3rd-5th Gen (320x240, Baseline profile)
  'ipod-nano-3g': {
    max: { videoBitrate: 768, audioBitrate: 128, crf: 20 },
    high: { videoBitrate: 600, audioBitrate: 128, crf: 23 },
    medium: { videoBitrate: 400, audioBitrate: 96, crf: 26 },
    low: { videoBitrate: 300, audioBitrate: 96, crf: 28 },
  },
} as const;

/**
 * Get preset settings for a device profile and quality preset
 */
export function getPresetSettings(
  deviceProfile: string,
  preset: VideoQualityPreset
): VideoPresetSettings | undefined {
  return VIDEO_PRESET_SETTINGS[deviceProfile]?.[preset];
}

/**
 * Get preset settings, falling back to iPod Classic if device not found
 */
export function getPresetSettingsWithFallback(
  deviceProfile: string,
  preset: VideoQualityPreset
): VideoPresetSettings {
  // ipod-classic is guaranteed to exist in VIDEO_PRESET_SETTINGS
  return VIDEO_PRESET_SETTINGS[deviceProfile]?.[preset]
    ?? VIDEO_PRESET_SETTINGS['ipod-classic']![preset];
}
