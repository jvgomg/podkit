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

// Video metadata
export type {
  ContentType,
  VideoMetadata,
  VideoMetadataBase,
  MovieMetadata,
  TVShowMetadata,
  VideoMetadataAdapter,
} from './metadata.js';

export { isMovieMetadata, isTVShowMetadata, formatEpisodeId, parseEpisodeId } from './metadata.js';

// Embedded video metadata adapter
export type { EmbeddedVideoMetadataConfig } from './metadata-embedded.js';
export {
  EmbeddedVideoMetadataAdapter,
  VideoMetadataError,
  parseFilename,
} from './metadata-embedded.js';

// Content type detection
export type { ContentTypeConfidence, ContentTypeResult } from './content-type.js';
export { detectContentType } from './content-type.js';

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
export type { VideoTranscodeOptions, HardwareAccelerationInfo } from './transcode.js';
export {
  transcodeVideo,
  buildVideoTranscodeArgs,
  buildScaleFilter,
  parseVideoProgress,
  detectHardwareAcceleration,
  VideoTranscodeError,
} from './transcode.js';

// Video directory adapter
export type {
  CollectionVideo,
  VideoScanProgress,
  VideoScanWarning,
  VideoFilter,
  VideoDirectoryAdapterConfig,
} from './directory-adapter.js';
export { VideoDirectoryAdapter, createVideoDirectoryAdapter } from './directory-adapter.js';
