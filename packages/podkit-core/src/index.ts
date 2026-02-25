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
  CollectionTrack,
  CollectionAdapter,
  AdapterConfig,
} from './adapters/interface.js';

export {
  DirectoryAdapter,
  createDirectoryAdapter,
} from './adapters/directory.js';

export type {
  DirectoryAdapterConfig,
  ScanProgress,
} from './adapters/directory.js';

// Sync engine
export type {
  IPodTrack,
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
} from './sync/planner.js';

// Track matching
export type { Matchable, MatchResult } from './sync/matching.js';
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
  TranscodePreset,
  TranscoderCapabilities,
  TranscodeResult,
  AudioMetadata,
  Transcoder,
  TranscodeProgress,
  TranscodeOptions,
} from './transcode/types.js';
export { PRESETS } from './transcode/types.js';

export {
  FFmpegTranscoder,
  createFFmpegTranscoder,
  isFFmpegAvailable,
  FFmpegNotFoundError,
  TranscodeError,
  buildTranscodeArgs,
  buildVbrArgs,
  parseProgressLine,
} from './transcode/ffmpeg.js';
export type { FFmpegTranscoderConfig } from './transcode/ffmpeg.js';

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

// iPod database abstraction layer
// Note: IPodTrack from ./ipod/types.js is the new abstraction layer version
// with methods. The IPodTrack from ./sync/types.js is a simpler data-only
// interface used by the sync engine. These will be unified in a future migration.
export type {
  TrackInput,
  TrackFields,
  IPodTrack as IpodTrackInterface,
  IpodPlaylist,
  IpodDeviceInfo,
  IpodInfo,
  SaveResult,
} from './ipod/types.js';
export { IpodError } from './ipod/errors.js';
export type { IpodErrorCode } from './ipod/errors.js';
export { MediaType } from './ipod/constants.js';
export type { MediaTypeValue } from './ipod/constants.js';
export { IpodDatabase } from './ipod/database.js';
