/**
 * @podkit/core
 *
 * Core sync logic for podkit.
 * Handles collection adapters, sync engine, transcoding, and artwork processing.
 */

export const VERSION = '0.0.0';

// Shared types
export type {
  AudioFileType,
  TrackMetadata,
  TrackFilter,
  PodkitError,
} from './types.js';
export { createError } from './types.js';

// Collection adapters
export type {
  FileAccess,
  CollectionTrack,
  CollectionAdapter,
  AdapterConfig,
  DirectoryAdapterConfig as AdapterDirectoryConfig,
  SubsonicAdapterConfig as AdapterSubsonicConfig,
} from './adapters/interface.js';

export {
  DirectoryAdapter,
  createDirectoryAdapter,
} from './adapters/directory.js';

export type {
  DirectoryAdapterConfig,
  ScanProgress,
  ScanWarning,
} from './adapters/directory.js';

// Subsonic adapter
export {
  SubsonicAdapter,
  createSubsonicAdapter,
} from './adapters/subsonic.js';

export type { SubsonicAdapterConfig } from './adapters/subsonic.js';

// Sync engine
export type {
  MatchedTrack,
  ConflictTrack,
  SyncDiff,
  SyncPlan,
  SyncOperation,
  ExecuteOptions,
  SyncProgress,
  SyncExecutor,
  SyncDiffer,
  SyncPlanner,
  PlanOptions,
  TranscodePresetRef,
  SourceCategory,
  SyncWarning,
  SyncWarningType,
  // Transform-related update types
  UpdateReason,
  MetadataChange,
  UpdateTrack,
  DiffOptions,
} from './sync/types.js';

// Differ
export {
  computeDiff,
  createDiffer,
  DefaultSyncDiffer,
} from './sync/differ.js';

// Planner
export {
  createPlan,
  createPlanner,
  DefaultSyncPlanner,
  isIPodCompatible,
  requiresTranscoding,
  estimateTranscodedSize,
  estimateCopySize,
  calculateOperationSize,
  willFitInSpace,
  getPlanSummary,
  categorizeSource,
  isLosslessSource,
  willWarnLossyToLossy,
} from './sync/planner.js';

// Track matching
export type { Matchable, MatchResult, TransformMatchKeys } from './sync/matching.js';
export {
  normalizeString,
  normalizeArtist,
  normalizeTitle,
  normalizeAlbum,
  getMatchKey,
  tracksMatch,
  buildMatchIndex,
  findMatches,
  findOrphanedTracks,
  getTransformMatchKeys,
} from './sync/matching.js';

// Sync executor
export type {
  ExecutorProgress,
  ExtendedExecuteOptions,
  ExecuteResult,
  ExecutorDependencies,
  ErrorCategory,
  CategorizedError,
  RetryConfig,
  ExecutionWarning,
  ExecutionWarningType,
} from './sync/executor.js';
export {
  DefaultSyncExecutor,
  createExecutor,
  executePlan,
  getOperationDisplayName,
  categorizeError,
  createCategorizedError,
  getRetriesForCategory,
  DEFAULT_RETRY_CONFIG,
} from './sync/executor.js';

// Transcoding
export type {
  TranscoderCapabilities,
  TranscodeResult,
  AudioMetadata,
  Transcoder,
  TranscodeProgress,
  TranscodeOptions,
  QualityPreset,
  AacQualityPreset,
  TranscodeConfig,
  AacPreset,
} from './transcode/types.js';
export {
  QUALITY_PRESETS,
  AAC_QUALITY_PRESETS,
  AAC_PRESETS,
  ALAC_PRESET,
  isValidQualityPreset,
  isValidAacPreset,
  getPresetBitrate,
  isLosslessPreset,
  isVbrPreset,
  resolveFallback,
} from './transcode/types.js';

export {
  FFmpegTranscoder,
  createFFmpegTranscoder,
  isFFmpegAvailable,
  FFmpegNotFoundError,
  TranscodeError,
  buildTranscodeArgs,
  buildAlacArgs,
  buildVbrArgs,
} from './transcode/ffmpeg.js';
export type { FFmpegTranscoderConfig } from './transcode/ffmpeg.js';

// Transcode progress parsing (shared utilities)
export {
  parseFFmpegProgress,
  parseFFmpegProgressLine,
  parseTimeString,
} from './transcode/progress.js';

// Artwork
export type {
  ArtworkFormat,
  ArtworkSource,
  ExtractedArtwork,
  ArtworkProcessor,
  ArtworkOptions,
} from './artwork/types.js';
export {
  IPOD_ARTWORK_FORMATS,
  EXTERNAL_ARTWORK_NAMES,
} from './artwork/types.js';

export type { ExtractArtworkOptions } from './artwork/extractor.js';
export {
  extractArtwork,
  saveArtworkToTemp,
  cleanupTempArtwork,
  cleanupAllTempArtwork,
  extractAndSaveArtwork,
} from './artwork/extractor.js';

// Metadata extraction utilities
export type { FileDisplayMetadata } from './metadata/extractor.js';
export {
  getFileDisplayMetadata,
  getFilesDisplayMetadata,
} from './metadata/extractor.js';

// iPod database abstraction layer
export type {
  TrackInput,
  TrackFields,
  IPodTrack,
  IpodPlaylist,
  IpodDeviceInfo,
  IpodInfo,
  SaveResult,
  RemoveTrackResult,
  RemoveAllTracksResult,
  RemoveTracksByContentTypeResult,
} from './ipod/types.js';
export { IpodError } from './ipod/errors.js';
export type { IpodErrorCode } from './ipod/errors.js';
export { MediaType, isMusicMediaType } from './ipod/constants.js';
export type { MediaTypeValue, ContentType as MediaContentType } from './ipod/constants.js';
export { IpodDatabase } from './ipod/database.js';
export { isVideoMediaType } from './ipod/video.js';
export {
  IPOD_GENERATIONS,
  formatGeneration,
  getVideoProfile,
  supportsVideo,
} from './ipod/generation.js';
export type { IpodGenerationMetadata } from './ipod/generation.js';

// Transforms
export type {
  TransformableTrack,
  TransformResult,
  TrackTransform,
  FtInTitleConfig,
  TransformsConfig,
} from './transforms/types.js';
export {
  DEFAULT_FTINTITLE_CONFIG,
  DEFAULT_TRANSFORMS_CONFIG,
} from './transforms/types.js';
export {
  applyTransforms,
  hasEnabledTransforms,
  getEnabledTransformsSummary,
} from './transforms/pipeline.js';
export { ftintitleTransform } from './transforms/ftintitle/index.js';
export {
  applyFtInTitle,
  extractFeaturedArtist,
  insertFeatIntoTitle,
  titleContainsFeat,
} from './transforms/ftintitle/index.js';

// Video transcoding
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
} from './video/types.js';
export {
  VIDEO_QUALITY_PRESETS,
  DEVICE_PROFILES,
  VIDEO_PRESET_SETTINGS,
  isValidVideoQualityPreset,
  getDeviceProfile,
  getDefaultDeviceProfile,
  getDeviceProfileByGeneration,
  getDeviceProfileNames,
  getPresetSettings,
  getPresetSettingsWithFallback,
} from './video/types.js';

// Video metadata
export type {
  ContentType,
  VideoMetadata,
  VideoMetadataBase,
  MovieMetadata,
  TVShowMetadata,
  VideoMetadataAdapter,
} from './video/metadata.js';
export {
  isMovieMetadata,
  isTVShowMetadata,
  formatEpisodeId,
  parseEpisodeId,
} from './video/metadata.js';

// Video probe
export type { VideoProbeConfig } from './video/probe.js';
export { probeVideo, VideoProbeError } from './video/probe.js';

// Video compatibility
export type { PassthroughResult } from './video/compatibility.js';
export {
  checkVideoCompatibility,
  isCompatibleVideoCodec,
  isCompatibleAudioCodec,
  isCompatibleContainer,
  canPassthrough,
} from './video/compatibility.js';

// Video quality capping
export type { TargetDimensions, QualityWarning } from './video/quality.js';
export {
  calculateTargetDimensions,
  calculateEffectiveSettings,
  generateQualityWarnings,
  isSourceQualityLimiting,
  getQualityLimitationSummary,
} from './video/quality.js';

// Video transcoding
export type {
  VideoTranscodeOptions,
  HardwareAccelerationInfo,
} from './video/transcode.js';
export {
  transcodeVideo,
  buildVideoTranscodeArgs,
  buildScaleFilter,
  parseVideoProgress,
  detectHardwareAcceleration,
  VideoTranscodeError,
} from './video/transcode.js';

// Video directory adapter
export type {
  CollectionVideo,
  VideoScanProgress,
  VideoScanWarning,
  VideoFilter,
  VideoDirectoryAdapterConfig,
} from './video/directory-adapter.js';
export {
  VideoDirectoryAdapter,
  createVideoDirectoryAdapter,
} from './video/directory-adapter.js';

// Video sync differ
export type {
  IPodVideo,
  MatchedVideo,
  VideoSyncDiff,
  VideoDiffOptions,
  VideoSyncDiffer,
} from './sync/video-differ.js';
export {
  diffVideos,
  generateVideoMatchKey,
  createVideoDiffer,
  DefaultVideoSyncDiffer,
} from './sync/video-differ.js';

// Video sync planner
export type {
  VideoSyncPlanOptions,
  VideoSyncPlan,
  VideoSyncWarning,
  VideoSyncWarningType,
  VideoPlanSummary,
  VideoSyncPlanner,
} from './sync/video-planner.js';
export {
  planVideoSync,
  willVideoPlanFit,
  getVideoPlanSummary,
  createVideoPlanner,
  DefaultVideoSyncPlanner,
  estimateTranscodedSize as estimateVideoTranscodedSize,
  estimatePassthroughSize,
} from './sync/video-planner.js';

// Video sync executor
export type {
  VideoExecutorProgress,
  VideoExecuteOptions,
  VideoExecuteResult,
  VideoSyncExecutor,
  VideoExecutorDependencies,
} from './sync/video-executor.js';
export {
  DefaultVideoSyncExecutor,
  PlaceholderVideoSyncExecutor,
  getVideoOperationDisplayName,
  createVideoExecutor,
} from './sync/video-executor.js';

// Device management
export type {
  PlatformDeviceInfo,
  DeviceManager,
  EjectResult,
  MountResult,
  EjectOptions,
  MountOptions,
  IpodIdentity,
} from './device/index.js';
export {
  getDeviceManager,
  createDeviceManager,
  clearDeviceManagerCache,
  getPlatform,
  isPlatformSupported,
} from './device/index.js';

// Stream utilities (for remote sources)
export { streamToTempFile, cleanupTempFile } from './utils/stream.js';
