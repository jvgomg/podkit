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
