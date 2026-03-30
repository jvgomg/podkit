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
  BaseOperation,
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
  DiffOptions,
  // Unified executor types (canonical definitions)
  ErrorCategory,
  CategorizedError,
  ExecutionWarningType,
  ExecutionWarning,
  ExecutorProgress,
  ExecuteResult,
} from './sync/engine/types.js';

// Per-handler operation types
export type { MusicOperation } from './sync/music/types.js';
export type { VideoOperation } from './sync/video/types.js';

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
} from './sync/engine/upgrades.js';
export type { PresetChangeOptions } from './sync/engine/upgrades.js';

// Music planning utilities
export {
  isDefaultCompatibleFormat,
  requiresTranscoding,
  estimateTranscodedSize,
  estimateCopySize,
  calculateMusicOperationSize,
  categorizeSource,
  isLosslessSource,
  willWarnLossyToLossy,
  fileTypeToAudioCodec,
  isDeviceCompatible,
  changesToMetadata,
} from './sync/music/planner.js';

// Track matching
export type { Matchable, MatchResult, TransformMatchKeys } from './metadata/matching.js';
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
} from './metadata/matching.js';

// Sync tags
export type { SyncTagData, SyncTagUpdate } from './metadata/sync-tags.js';
export {
  syncTagMatchesConfig,
  buildAudioSyncTag,
  buildCopySyncTag,
  buildVideoSyncTag,
  syncTagsEqual,
} from './metadata/sync-tags.js';

// Shared error handling (canonical implementations)
export type { RetryConfig as SharedRetryConfig } from './sync/engine/error-handling.js';
export {
  categorizeError as sharedCategorizeError,
  createCategorizedError as sharedCreateCategorizedError,
  getRetriesForCategory as sharedGetRetriesForCategory,
  withRetry,
  DEFAULT_RETRY_CONFIG as SHARED_DEFAULT_RETRY_CONFIG,
  VIDEO_RETRY_CONFIG,
} from './sync/engine/error-handling.js';

// Music sync pipeline (three-stage execution engine, ADR-011)
export type {
  ExtendedExecuteOptions,
  ExecutorDependencies,
  RetryConfig,
  SyncTagConfig,
} from './sync/music/pipeline.js';
export {
  MusicPipeline,
  createMusicPipeline,
  executeMusicPlan,
  getMusicOperationDisplayName,
  categorizeError,
  createCategorizedError,
  getRetriesForCategory,
  MUSIC_RETRY_CONFIG,
} from './sync/music/pipeline.js';

// Device capabilities
export type {
  DeviceCapabilities,
  DeviceArtworkSource,
  AudioCodec,
  AudioNormalizationMode,
} from './device/capabilities.js';
export { getDeviceCapabilities } from './ipod/capabilities.js';

// Device presets
export { DEVICE_PRESETS, getDevicePreset, resolveDeviceCapabilities } from './device/index.js';
export type { DeviceTypeId, DevicePreset } from './device/index.js';

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
  CodecPreset,
} from './transcode/types.js';
export {
  QUALITY_PRESETS,
  ENCODING_MODES,
  TRANSFER_MODES,
  AAC_PRESETS,
  ALAC_PRESET,
  OPUS_PRESETS,
  MP3_PRESETS,
  FLAC_ESTIMATED_KBPS,
  ALAC_ESTIMATED_KBPS,
  isValidQualityPreset,
  isValidTransferMode,
  getPresetBitrate,
  getCodecPresetBitrate,
  getCodecVbrQuality,
  getLosslessEstimatedKbps,
  isMaxPreset,
  isVbrEncoding,
  encoderAvailabilityFrom,
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
  EncoderConfig,
  AacTranscodeConfig,
  FFmpegTranscoderConfig,
  OptimizedCopyFormat,
} from './transcode/ffmpeg.js';

// Codec metadata
export type { TranscodeTargetCodec, CodecMetadata } from './transcode/codecs.js';
export {
  CODEC_METADATA,
  getCodecMetadata,
  DEFAULT_LOSSY_STACK,
  DEFAULT_LOSSLESS_STACK,
} from './transcode/codecs.js';

// Codec preference resolver
export type {
  EncoderAvailability,
  ResolvedCodec,
  CodecResolutionResult,
  CodecResolutionError,
} from './transcode/codec-resolver.js';
export { resolveCodecPreferences, isCodecResolutionError } from './transcode/codec-resolver.js';

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

// Diagnostics (device health checks)
export type {
  DiagnosticDeviceType,
  DiagnosticContext,
  CheckResult,
  RepairRequirement,
  RepairContext,
  RepairResult as DiagnosticRepairResult,
  RepairRunOptions,
  DiagnosticRepair,
  DiagnosticCheck,
  DiagnosticReport,
  RunDiagnosticsInput,
} from './diagnostics/index.js';
export { runDiagnostics, getDiagnosticCheck, getDiagnosticCheckIds } from './diagnostics/index.js';

// Metadata extraction utilities
export type { FileDisplayMetadata } from './metadata/extractor.js';
export { getFileDisplayMetadata, getFilesDisplayMetadata } from './metadata/extractor.js';

// iPod database abstraction layer
export type {
  TrackInput,
  TrackFields,
  IpodTrack,
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

// Video types and match key generation
export type { DeviceVideo } from './sync/video/types.js';
export { generateVideoMatchKey } from './sync/video/types.js';

// Video sync estimation
export {
  estimateTranscodedSize as estimateVideoTranscodedSize,
  estimatePassthroughSize,
  calculateVideoOperationSize,
  calculateVideoOperationTime,
} from './sync/video/planner.js';

// Video sync executor
export type {
  VideoExecuteOptions,
  VideoSyncExecutor,
  VideoExecutorDependencies,
} from './sync/video/executor.js';
export { getVideoOperationDisplayName } from './sync/video/executor.js';

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
  normalizeContentDir,
  normalizeContentPaths,
  validateContentPaths,
  PODKIT_DIR,
  MANIFEST_FILE,
  DEFAULT_CONTENT_PATHS,
} from './device/index.js';
export type { ContentPaths } from './device/index.js';

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

// Device readiness pipeline
export type {
  ReadinessStage,
  ReadinessStageResult,
  ReadinessLevel,
  ReadinessResult,
  ReadinessInput,
} from './device/index.js';
export {
  checkReadiness,
  checkIpodStructure,
  checkSysInfo,
  checkDatabase,
  createUsbOnlyReadinessResult,
  STAGE_DISPLAY_NAMES,
} from './device/index.js';

// USB discovery
export type { UsbDiscoveredDevice } from './device/index.js';
export { discoverUsbIpods } from './device/index.js';

// OS error code interpreter
export type { InterpretedError } from './device/index.js';
export { interpretError } from './device/index.js';

// Sound Check (volume normalization)
export type { SoundCheckResult } from './metadata/soundcheck.js';
export {
  replayGainToSoundcheck,
  iTunNORMToSoundcheck,
  extractSoundcheck,
} from './metadata/soundcheck.js';

// ContentTypeHandler interface and registry
export type {
  ContentTypeHandler,
  ExecutionContext,
  OperationProgress,
  DryRunSummary,
  MatchInfo,
  UnifiedSyncDiff,
} from './sync/engine/content-type.js';

// Content type handlers
export { MusicHandler, createMusicHandler } from './sync/music/handler.js';
export type { MusicSyncConfig, ResolvedMusicConfig } from './sync/music/config.js';
export { MusicTrackClassifier, classifierFromConfig } from './sync/music/classifier.js';
export type {
  MusicAction,
  TrackClassification,
  ClassifierContext,
} from './sync/music/classifier.js';
export { MusicOperationFactory } from './sync/music/operation-factory.js';
export { VideoHandler, createVideoHandler } from './sync/video/handler.js';
export type { VideoSyncConfig, ResolvedVideoConfig } from './sync/video/config.js';
export { VideoTrackClassifier } from './sync/video/classifier.js';
export type { VideoAction, VideoClassification } from './sync/video/classifier.js';

// Generic differ
export { SyncDiffer, createSyncDiffer } from './sync/engine/differ.js';

// Generic planner
export type { SyncPlanOptions } from './sync/engine/planner.js';
export { SyncPlanner, createSyncPlanner, orderOperations } from './sync/engine/planner.js';

// Generic executor
export type { SyncExecuteOptions } from './sync/engine/executor.js';
export { SyncExecutor, createSyncExecutor } from './sync/engine/executor.js';

// Stream utilities (for remote sources)
export { streamToTempFile, cleanupTempFile } from './utils/stream.js';
