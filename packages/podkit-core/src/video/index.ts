/**
 * Video transcoding module
 *
 * Types, device profiles, and utilities for video transcoding.
 */

export type {
  VideoQualityPreset,
  VideoCodec,
  VideoProfile,
  VideoAudioCodec,
  VideoDeviceProfile,
  VideoSourceAnalysis,
  VideoTranscodeSettings,
  VideoCompatibilityStatus,
  VideoCompatibility,
  VideoPresetSettings,
} from './types.js';

export {
  VIDEO_QUALITY_PRESETS,
  DEVICE_PROFILES,
  VIDEO_PRESET_SETTINGS,
  isValidVideoQualityPreset,
  getDeviceProfile,
  getDefaultDeviceProfile,
  getDeviceProfileNames,
  getPresetSettings,
  getPresetSettingsWithFallback,
} from './types.js';

// Video probe
export type { VideoProbeConfig } from './probe.js';
export { probeVideo, VideoProbeError } from './probe.js';

// Compatibility checking
export type { PassthroughResult } from './compatibility.js';
export {
  checkVideoCompatibility,
  isCompatibleVideoCodec,
  isCompatibleAudioCodec,
  isCompatibleContainer,
  canPassthrough,
} from './compatibility.js';

// Quality capping
export type { TargetDimensions, QualityWarning } from './quality.js';
export {
  calculateTargetDimensions,
  calculateEffectiveSettings,
  generateQualityWarnings,
  isSourceQualityLimiting,
  getQualityLimitationSummary,
} from './quality.js';

// Video transcoding
export type {
  VideoTranscodeProgress,
  VideoTranscodeOptions,
  HardwareAccelerationInfo,
} from './transcode.js';
export {
  transcodeVideo,
  buildVideoTranscodeArgs,
  buildScaleFilter,
  parseVideoProgress,
  detectHardwareAcceleration,
  VideoTranscodeError,
} from './transcode.js';
