/**
 * Video sync configuration and resolution
 *
 * Defines `VideoSyncConfig` (the single config object for the video handler)
 * and `resolveVideoConfig()` which derives all internal state from it.
 *
 * This mirrors the music config pattern: callers construct a plain config
 * object, and the resolver computes derived values (preset bitrate,
 * transforms enabled, etc.) so that handlers and planners don't need to
 * repeat the derivation logic.
 *
 * @module
 */

import type { VideoQualityPreset, VideoDeviceProfile } from '../../video/types.js';
import { getPresetSettingsWithFallback } from '../../video/types.js';
import type { VideoTransformsConfig } from '../../transforms/types.js';
import { hasEnabledVideoTransforms } from '../../transforms/video-pipeline.js';
import type { DeviceCapabilities } from '../../device/capabilities.js';

// =============================================================================
// Public Config
// =============================================================================

/**
 * Configuration for video sync operations.
 *
 * This is the single config object passed to the video handler at
 * construction time. All fields are optional — sensible defaults
 * are applied by `resolveVideoConfig()`.
 */
export interface VideoSyncConfig {
  /** Quality preset for transcoding (defaults to 'high') */
  videoQuality?: VideoQualityPreset;

  /** Target device profile for resolution/codec constraints */
  deviceProfile?: VideoDeviceProfile;

  /** Device capabilities (used to determine video support) */
  capabilities?: DeviceCapabilities;

  /** Video transform configuration (e.g., show language renaming) */
  videoTransforms?: VideoTransformsConfig;

  /** Whether to use hardware-accelerated transcoding (default: true) */
  hardwareAcceleration?: boolean;

  /** Force metadata refresh on all existing videos */
  forceMetadata?: boolean;

  /** Skip upgrade detection for preset/bitrate changes */
  skipUpgrades?: boolean;
}

// =============================================================================
// Resolved Config
// =============================================================================

/**
 * Internal derived state from a `VideoSyncConfig`.
 *
 * All fields are readonly. Computed once by `resolveVideoConfig()` and
 * shared across the handler, differ, and planner for the lifetime of
 * a single sync run.
 */
export interface ResolvedVideoConfig {
  /** The original config (frozen) */
  readonly raw: Readonly<VideoSyncConfig>;

  /** Quality preset, defaulted to 'high' */
  readonly videoQuality: VideoQualityPreset;

  /** Device profile, or undefined when no profile is configured */
  readonly deviceProfile: VideoDeviceProfile | undefined;

  /**
   * Combined video + audio bitrate from the quality preset settings.
   *
   * Used for sync tag comparison and preset-change detection.
   * Undefined when no device profile is available (bitrate lookup
   * requires a device profile name).
   */
  readonly presetBitrate: number | undefined;

  /** Whether any video transforms are enabled */
  readonly videoTransformsEnabled: boolean;

  /** Whether hardware-accelerated transcoding is enabled */
  readonly hardwareAcceleration: boolean;

  /**
   * Whether the device supports video playback.
   *
   * Derived from `capabilities.supportsVideo`. Defaults to `true`
   * for backward compatibility when no capabilities are provided.
   */
  readonly supportsVideo: boolean;
}

// =============================================================================
// Defaults
// =============================================================================

/** Default video quality preset */
const DEFAULT_VIDEO_QUALITY: VideoQualityPreset = 'high';

/** Default hardware acceleration setting */
const DEFAULT_HARDWARE_ACCELERATION = true;

// =============================================================================
// Resolver
// =============================================================================

/**
 * Resolve a `VideoSyncConfig` into a `ResolvedVideoConfig`.
 *
 * This is a pure function that derives all internal state from the
 * provided config. The result is frozen and safe to share across
 * handler, differ, and planner.
 *
 * @param config - The video sync configuration to resolve
 * @returns Resolved config with all derived fields computed
 *
 * @example
 * ```typescript
 * const resolved = resolveVideoConfig({
 *   videoQuality: 'medium',
 *   hardwareAcceleration: false,
 * });
 *
 * console.log(resolved.videoQuality);        // 'medium'
 * console.log(resolved.hardwareAcceleration); // false
 * console.log(resolved.presetBitrate);        // undefined (no device profile)
 * ```
 */
export function resolveVideoConfig(config: VideoSyncConfig = {}): ResolvedVideoConfig {
  const videoQuality = config.videoQuality ?? DEFAULT_VIDEO_QUALITY;
  const deviceProfile = config.deviceProfile;
  const hardwareAcceleration = config.hardwareAcceleration ?? DEFAULT_HARDWARE_ACCELERATION;

  // Derive preset bitrate from device profile + quality preset
  let presetBitrate: number | undefined;
  if (deviceProfile) {
    const presetSettings = getPresetSettingsWithFallback(deviceProfile.name, videoQuality);
    presetBitrate = presetSettings.videoBitrate + presetSettings.audioBitrate;
  }

  // Derive whether video transforms are enabled
  const videoTransformsEnabled = config.videoTransforms
    ? hasEnabledVideoTransforms(config.videoTransforms)
    : false;

  // Derive video support from capabilities (default true for backward compat)
  const supportsVideo = config.capabilities?.supportsVideo ?? true;

  return {
    raw: Object.freeze({ ...config }),
    videoQuality,
    deviceProfile,
    presetBitrate,
    videoTransformsEnabled,
    hardwareAcceleration,
    supportsVideo,
  };
}
