/**
 * @podkit/core
 *
 * Core sync logic for podkit.
 * Handles collection adapters, sync engine, transcoding, and artwork processing.
 */

export const VERSION = '0.0.0';

// Shared types
export type { AudioFileType, TrackMetadata, TrackFilter, PodkitError } from './types.js';
export { createError } from './types.js';

// Collection adapters
export type {
  FileAccess,
  CollectionTrack,
  CollectionAdapter,
  MusicAdapter,
  AdapterConfig,
  DirectoryAdapterConfig as AdapterDirectoryConfig,
  SubsonicAdapterConfig as AdapterSubsonicConfig,
  SoundCheckSource,
} from './adapters/interface.js';

export { DirectoryAdapter, createDirectoryAdapter } from './adapters/directory.js';

export type { DirectoryAdapterConfig, ScanProgress, ScanWarning } from './adapters/directory.js';

// Subsonic adapter
export {
  SubsonicAdapter,
  createSubsonicAdapter,
  SubsonicConnectionError,
} from './adapters/subsonic.js';

export type { SubsonicAdapterConfig } from './adapters/subsonic.js';

// Sync engine
export type {
  MatchedTrack,
  SyncDiff,
  SyncPlan,
  SyncOperation,
  ExecuteOptions,
  SyncProgress,
  PlanOptions,
  TranscodePresetRef,
  SourceCategory,
  SyncWarning,
  SyncWarningType,
  // Transform-related update types
  UpdateReason,
  UpgradeReason,
  MetadataChange,
  UpdateTrack,
  DiffOptions,
  // Unified executor types (canonical definitions)
  ErrorCategory,
  CategorizedError,
  ExecutionWarningType,
  ExecutionWarning,
  ExecutorProgress,
  ExecuteResult,
} from './sync/types.js';

// Upgrade detection (self-healing sync)
export {
  isQualityUpgrade,
  detectUpgrades,
  isFileReplacementUpgrade,
  isSourceLossless,
  detectPresetChange,
  detectBitratePresetMismatch,
  DEFAULT_VBR_TOLERANCE,
  DEFAULT_CBR_TOLERANCE,
  DEFAULT_MIN_PRESET_BITRATE,
} from './sync/upgrades.js';
export type { PresetChangeOptions } from './sync/upgrades.js';

// Planner
export {
  createMusicPlan,
  isIPodCompatible,
  requiresTranscoding,
  estimateTranscodedSize,
  estimateCopySize,
  calculateMusicOperationSize,
  willMusicFitInSpace,
  getMusicPlanSummary,
  categorizeSource,
  isLosslessSource,
  willWarnLossyToLossy,
  fileTypeToAudioCodec,
  isDeviceCompatible,
} from './sync/music-planner.js';

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

// Sync tags
export type { SyncTagData, SyncTagUpdate } from './sync/sync-tags.js';
export {
  syncTagMatchesConfig,
  buildAudioSyncTag,
  buildCopySyncTag,
  buildVideoSyncTag,
  syncTagsEqual,
} from './sync/sync-tags.js';

// Shared error handling (canonical implementations)
export type { RetryConfig as SharedRetryConfig } from './sync/error-handling.js';
export {
  categorizeError as sharedCategorizeError,
  createCategorizedError as sharedCreateCategorizedError,
  getRetriesForCategory as sharedGetRetriesForCategory,
  withRetry,
  DEFAULT_RETRY_CONFIG as SHARED_DEFAULT_RETRY_CONFIG,
  VIDEO_RETRY_CONFIG,
} from './sync/error-handling.js';

// Sync executor (implementation-specific types)
export type {
  ExtendedExecuteOptions,
  ExecutorDependencies,
  RetryConfig,
  SyncTagConfig,
} from './sync/music-executor.js';
export {
  MusicExecutor,
  createExecutor,
  executePlan,
  getMusicOperationDisplayName,
  categorizeError,
  createCategorizedError,
  getRetriesForCategory,
  MUSIC_RETRY_CONFIG,
} from './sync/music-executor.js';

// Device capabilities
export type { DeviceCapabilities, DeviceArtworkSource, AudioCodec } from './device/capabilities.js';
export { getDeviceCapabilities } from './ipod/capabilities.js';

// Device presets
export { DEVICE_PRESETS, getDevicePreset, resolveDeviceCapabilities } from './device/index.js';
export type { DeviceTypeId } from './device/index.js';

// Transcoding
export type {
  TranscoderCapabilities,
  TranscodeResult,
  AudioMetadata,
  Transcoder,
  TranscodeProgress,
  TranscodeOptions,
  QualityPreset,
  EncodingMode,
  TransferMode,
  TranscodeConfig,
  AacPreset,
} from './transcode/types.js';
export {
  QUALITY_PRESETS,
  ENCODING_MODES,
  TRANSFER_MODES,
  AAC_PRESETS,
  ALAC_PRESET,
  isValidQualityPreset,
  isValidTransferMode,
  getPresetBitrate,
  isMaxPreset,
  isVbrEncoding,
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
  buildOptimizedCopyArgs,
} from './transcode/ffmpeg.js';
export type {
  AacTranscodeConfig,
  FFmpegTranscoderConfig,
  OptimizedCopyFormat,
} from './transcode/ffmpeg.js';

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
export { IPOD_ARTWORK_FORMATS, EXTERNAL_ARTWORK_NAMES } from './artwork/types.js';

export type { ExtractArtworkOptions } from './artwork/extractor.js';
export {
  extractArtwork,
  selectBestPicture,
  saveArtworkToTemp,
  cleanupTempArtwork,
  cleanupAllTempArtwork,
  extractAndSaveArtwork,
} from './artwork/extractor.js';

// Artwork hashing (for change detection)
export { hashArtwork } from './artwork/hash.js';

// Album-level artwork cache (shared by sync executor and repair)
export type { AlbumArtworkEntry, AlbumArtworkCacheOptions } from './artwork/album-cache.js';
export { AlbumArtworkCache, getAlbumKey } from './artwork/album-cache.js';

// Artwork diagnostics (ArtworkDB parser + integrity checker)
export type { MHNIEntry, MHIIEntry, MHIFEntry, ArtworkDB } from './artwork/artworkdb-parser.js';
export { parseArtworkDB } from './artwork/artworkdb-parser.js';

export type { AnomalyType, Anomaly, FormatSummary, IntegrityReport } from './artwork/integrity.js';
export { checkIntegrity } from './artwork/integrity.js';

// Artwork database operations (reset + rebuild)
export type {
  ResetResult,
  ResetOptions,
  RebuildProgress,
  RebuildResult,
  RebuildOptions,
  RebuildDependencies,
} from './artwork/repair.js';
export { resetArtworkDatabase, rebuildArtworkDatabase } from './artwork/repair.js';

// Diagnostics (iPod health checks)
export type {
  DiagnosticContext,
  CheckResult,
  RepairRequirement,
  RepairContext,
  RepairResult as DiagnosticRepairResult,
  RepairRunOptions,
  DiagnosticRepair,
  DiagnosticCheck,
  DiagnosticReport,
} from './diagnostics/index.js';
export { runDiagnostics, getDiagnosticCheck, getDiagnosticCheckIds } from './diagnostics/index.js';

// Metadata extraction utilities
export type { FileDisplayMetadata } from './metadata/extractor.js';
export { getFileDisplayMetadata, getFilesDisplayMetadata } from './metadata/extractor.js';

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
export { MediaType, isMusicMediaType, CONTENT_TYPES } from './ipod/constants.js';
export type { MediaTypeValue, ContentType as MediaContentType } from './ipod/constants.js';
export { IpodDatabase } from './ipod/database.js';
export { isVideoMediaType } from './ipod/video.js';
export {
  IPOD_GENERATIONS,
  formatGeneration,
  getVideoProfile,
  supportsVideo,
  supportsAlac,
} from './ipod/generation.js';
export type { IpodGenerationMetadata } from './ipod/generation.js';

// Device validation
export {
  validateDevice,
  isUnsupportedGeneration,
  formatValidationMessages,
  formatCapabilities,
  buildSyncWarnings,
} from './ipod/device-validation.js';
export type {
  DeviceValidationResult,
  DeviceIssue,
  DeviceWarning,
  DeviceCapabilitySummary,
  UnsupportedReason,
} from './ipod/device-validation.js';

// Transforms
export type {
  TransformableTrack,
  TransformResult,
  TrackTransform,
  CleanArtistsConfig,
  TransformsConfig,
} from './transforms/types.js';
export { DEFAULT_CLEAN_ARTISTS_CONFIG, DEFAULT_TRANSFORMS_CONFIG } from './transforms/types.js';
export {
  applyTransforms,
  hasEnabledTransforms,
  getEnabledTransformsSummary,
} from './transforms/pipeline.js';
export { cleanArtistsTransform } from './transforms/ftintitle/index.js';
export {
  applyFtInTitle,
  extractFeaturedArtist,
  insertFeatIntoTitle,
  titleContainsFeat,
} from './transforms/ftintitle/index.js';

// Video transforms
export type {
  VideoTrackTransform,
  VideoTransformableTrack,
  VideoTransformResult,
  ShowLanguageConfig,
  VideoTransformsConfig,
} from './transforms/types.js';
export {
  DEFAULT_SHOW_LANGUAGE_CONFIG,
  DEFAULT_VIDEO_TRANSFORMS_CONFIG,
} from './transforms/types.js';
export {
  applyVideoTransforms,
  hasEnabledVideoTransforms,
  getEnabledVideoTransformsSummary,
  getVideoTransformMatchKeys,
} from './transforms/video-pipeline.js';
export {
  applyShowLanguage,
  parseLanguageMarker,
  showLanguageTransform,
} from './transforms/video-show-language.js';

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
export type { VideoTranscodeOptions, HardwareAccelerationInfo } from './video/transcode.js';
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
export { VideoDirectoryAdapter, createVideoDirectoryAdapter } from './video/directory-adapter.js';

// Video adapter type alias (defined here to avoid circular imports between adapters/ and video/)
import type { CollectionAdapter } from './adapters/interface.js';
import type { CollectionVideo, VideoFilter } from './video/directory-adapter.js';
/** Video collection adapter type alias */
export type VideoAdapter = CollectionAdapter<CollectionVideo, VideoFilter>;

// Video sync differ
export type {
  IPodVideo,
  MatchedVideo,
  VideoSyncDiff,
  VideoDiffOptions,
  VideoSyncDiffer,
  VideoUpdateTrack,
  VideoUpdateReason,
} from './sync/video-differ.js';
export { diffVideos, generateVideoMatchKey } from './sync/video-differ.js';

// Video sync planner
export type {
  VideoSyncPlanOptions,
  VideoSyncWarning,
  VideoSyncWarningType,
  VideoPlanSummary,
  VideoSyncPlanner,
} from './sync/video-planner.js';
export {
  planVideoSync,
  willVideoPlanFit,
  getVideoPlanSummary,
  estimateTranscodedSize as estimateVideoTranscodedSize,
  estimatePassthroughSize,
} from './sync/video-planner.js';

// Video sync executor
export type {
  VideoExecuteOptions,
  VideoSyncExecutor,
  VideoExecutorDependencies,
} from './sync/video-executor.js';
export { getVideoOperationDisplayName } from './sync/video-executor.js';

// Device adapter interface
export type {
  DeviceAdapter,
  DeviceTrack,
  DeviceTrackInput,
  DeviceTrackMetadata,
} from './device/index.js';
export { IpodDeviceAdapter } from './device/index.js';
export { MassStorageAdapter, MassStorageTrack } from './device/index.js';
export type {
  MetadataReader,
  MetadataReaderResult,
  MassStorageAdapterOptions,
  MassStorageManifest,
} from './device/index.js';
export {
  sanitizeFilename,
  generateTrackPath,
  deduplicatePath,
  padTrackNumber,
  isAudioExtension,
  MUSIC_DIR,
  PODKIT_DIR,
  MANIFEST_FILE,
} from './device/index.js';

// Device management
export type {
  PlatformDeviceInfo,
  DeviceManager,
  EjectResult,
  MountResult,
  EjectOptions,
  MountOptions,
  IpodIdentity,
  DeviceAssessment,
  IFlashAssessment,
  IFlashEvidence,
  UsbDeviceInfo,
  EjectProgressEvent,
  EjectWithRetryOptions,
} from './device/index.js';
export {
  getDeviceManager,
  createDeviceManager,
  clearDeviceManagerCache,
  getPlatform,
  isPlatformSupported,
  ejectWithRetry,
  stripPartitionSuffix,
} from './device/index.js';

// Sound Check (volume normalization)
export type { SoundCheckResult } from './sync/soundcheck.js';
export {
  replayGainToSoundcheck,
  iTunNORMToSoundcheck,
  extractSoundcheck,
} from './sync/soundcheck.js';

// ContentTypeHandler interface and registry
export type {
  ContentTypeHandler,
  HandlerDiffOptions,
  HandlerPlanOptions,
  ExecutionContext,
  OperationProgress,
  DryRunSummary,
  MatchInfo,
  UnifiedSyncDiff,
} from './sync/content-type.js';

// Content type handlers
export { MusicHandler, createMusicHandler } from './sync/handlers/music-handler.js';
export type { MusicExecutionConfig } from './sync/handlers/music-handler.js';
export {
  VideoHandler,
  createVideoHandler,
  type VideoHandlerDiffOptions,
} from './sync/handlers/video-handler.js';

// Generic differ
export type { SyncDiffOptions } from './sync/differ.js';
export { SyncDiffer, createSyncDiffer } from './sync/differ.js';

// Generic planner
export type { SyncPlanOptions } from './sync/planner.js';
export { SyncPlanner, createSyncPlanner, orderOperations } from './sync/planner.js';

// Generic executor
export type { SyncExecuteOptions } from './sync/executor.js';
export { SyncExecutor, createSyncExecutor } from './sync/executor.js';

// Stream utilities (for remote sources)
export { streamToTempFile, cleanupTempFile } from './utils/stream.js';
