/**
 * Mock @podkit/core for the demo CLI build.
 *
 * Re-exports all types from the real core and provides mock implementations
 * of functions and classes that return canned demo data.
 *
 * The build plugin replaces `@podkit/core` imports with this module.
 */

import { readState, updateState } from './state.js';
import {
  DEMO_MOUNT_POINT,
  DEMO_DEVICE_INFO,
  DEMO_PLATFORM_DEVICE,
  getDemoCollectionTracks,
  getDemoCollectionVideos,
  getDemoIpodTracks,
  getDemoIpodVideoTracks,
} from './demo-data.js';

// =============================================================================
// Version
// =============================================================================

export const VERSION = '0.0.0-demo';

// =============================================================================
// Re-exported types (these are type-only, no runtime cost)
// =============================================================================

// Shared types
export type { AudioFileType, TrackMetadata, TrackFilter, PodkitError } from '@podkit/core';

// Collection adapter types
export type {
  FileAccess,
  CollectionTrack,
  CollectionAdapter,
  MusicAdapter,
  AdapterConfig,
  DirectoryAdapterConfig as AdapterDirectoryConfig,
  SubsonicAdapterConfig as AdapterSubsonicConfig,
} from '@podkit/core';

export type { DirectoryAdapterConfig, ScanProgress, ScanWarning } from '@podkit/core';

export type { SubsonicAdapterConfig } from '@podkit/core';

// Sync types
export type {
  SyncPlan,
  SyncOperation,
  ExecuteOptions,
  SyncProgress,
  PlanOptions,
  TranscodePresetRef,
  SourceCategory,
  SyncWarning,
  SyncWarningType,
  UpdateReason,
  UpgradeReason,
  MetadataChange,
  DiffOptions,
} from '@podkit/core';

// Executor types
export type {
  ExecutorProgress,
  ExtendedExecuteOptions,
  ExecuteResult,
  ExecutorDependencies,
  ErrorCategory,
  CategorizedError,
  RetryConfig,
  SyncTagConfig,
  ExecutionWarning,
  ExecutionWarningType,
} from '@podkit/core';

// Shared error handling types
export type { SharedRetryConfig } from '@podkit/core';

// Matching types
export type { Matchable, MatchResult, TransformMatchKeys } from '@podkit/core';

// Transcoding types
export type {
  TranscoderCapabilities,
  TranscodeResult,
  AudioMetadata,
  Transcoder,
  TranscodeProgress,
  TranscodeOptions,
  QualityPreset,
  EncodingMode,
  TranscodeConfig,
  AacPreset,
  FFmpegTranscoderConfig,
  EncoderConfig,
  TranscodeTargetCodec,
  CodecMetadata,
  CodecPreset,
  EncoderAvailability,
  ResolvedCodec,
  CodecResolutionResult,
  CodecResolutionError,
} from '@podkit/core';

// Artwork types
export type {
  ArtworkFormat,
  ArtworkSource,
  ExtractedArtwork,
  ArtworkProcessor,
  ArtworkOptions,
  ExtractArtworkOptions,
} from '@podkit/core';

// Album artwork cache types
export type { AlbumArtworkEntry, AlbumArtworkCacheOptions } from '@podkit/core';

// Artwork diagnostics types
export type {
  MHNIEntry,
  MHIIEntry,
  MHIFEntry,
  ArtworkDB,
  AnomalyType,
  Anomaly,
  FormatSummary,
  IntegrityReport,
} from '@podkit/core';

// Artwork repair types
export type {
  ResetResult,
  ResetOptions,
  RebuildProgress,
  RebuildResult,
  RebuildOptions,
  RebuildDependencies,
} from '@podkit/core';

// Diagnostics types
export type {
  DiagnosticDeviceType,
  DiagnosticContext,
  CheckResult,
  RepairRequirement,
  RepairContext,
  DiagnosticRepairResult,
  RepairRunOptions,
  DiagnosticRepair,
  DiagnosticCheck,
  DiagnosticReport,
  RunDiagnosticsInput,
} from '@podkit/core';

// Metadata types
export type { FileDisplayMetadata } from '@podkit/core';

// iPod types
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
  IpodErrorCode,
  MediaTypeValue,
  MediaContentType,
  IpodGenerationMetadata,
} from '@podkit/core';

// Device validation types
export type {
  DeviceValidationResult,
  DeviceIssue,
  DeviceWarning,
  DeviceCapabilitySummary,
  UnsupportedReason,
} from '@podkit/core';

// Sync tag types
export type { SyncTagData, SyncTagUpdate } from '@podkit/core';

// Upgrade detection types
export type { PresetChangeOptions } from '@podkit/core';

// Transform types
export type {
  TransformableTrack,
  TransformResult,
  TrackTransform,
  CleanArtistsConfig,
  TransformsConfig,
  VideoTrackTransform,
  VideoTransformableTrack,
  VideoTransformResult,
  ShowLanguageConfig,
  VideoTransformsConfig,
} from '@podkit/core';

// Video types
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
  ContentType,
  VideoMetadata,
  VideoMetadataBase,
  MovieMetadata,
  TVShowMetadata,
  VideoMetadataAdapter,
  VideoProbeConfig,
  PassthroughResult,
  TargetDimensions,
  QualityWarning,
  VideoTranscodeOptions,
  HardwareAccelerationInfo,
  CollectionVideo,
  VideoScanProgress,
  VideoScanWarning,
  VideoFilter,
  VideoDirectoryAdapterConfig,
  DeviceVideo,
  VideoExecuteOptions,
  VideoSyncExecutor,
  VideoExecutorDependencies,
} from '@podkit/core';

// Device management types
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
} from '@podkit/core';

// ContentTypeHandler types
export type {
  ContentTypeHandler,
  ExecutionContext,
  OperationProgress,
  DryRunSummary,
} from '@podkit/core';

// Generic differ types
export type { UnifiedSyncDiff } from '@podkit/core';

// Generic planner types
export type { SyncPlanOptions } from '@podkit/core';

// Generic executor types
export type { SyncExecuteOptions } from '@podkit/core';

// Video adapter type alias
export type { VideoAdapter } from '@podkit/core';

// =============================================================================
// createError
// =============================================================================

export function createError(type: string, details: Record<string, unknown>) {
  return { type, ...details };
}

// =============================================================================
// MediaType constants
// =============================================================================

export const MediaType = {
  Audio: 0x0001,
  Movie: 0x0002,
  Podcast: 0x0004,
  Audiobook: 0x0008,
  MusicVideo: 0x0020,
  TVShow: 0x0040,
} as const;

export function isMusicMediaType(mediaType: number): boolean {
  const isAudio = (mediaType & MediaType.Audio) !== 0;
  const isPodcast = (mediaType & MediaType.Podcast) !== 0;
  const isAudiobook = (mediaType & MediaType.Audiobook) !== 0;
  const isVideo =
    (mediaType & MediaType.Movie) !== 0 ||
    (mediaType & MediaType.TVShow) !== 0 ||
    (mediaType & MediaType.MusicVideo) !== 0;
  return isAudio && !isPodcast && !isAudiobook && !isVideo;
}

export function isVideoMediaType(mediaType: number): boolean {
  return (
    (mediaType & MediaType.Movie) !== 0 ||
    (mediaType & MediaType.TVShow) !== 0 ||
    (mediaType & MediaType.MusicVideo) !== 0
  );
}

// =============================================================================
// IpodError
// =============================================================================

export class IpodError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'IpodError';
    this.code = code;
  }
}

// =============================================================================
// Mock IpodTrack implementation
// =============================================================================

function createMockIpodTrack(data: Record<string, unknown>): any {
  return {
    title: data.title ?? '',
    artist: data.artist ?? '',
    album: data.album ?? '',
    albumArtist: data.albumArtist,
    genre: data.genre,
    composer: data.composer,
    comment: data.comment,
    grouping: data.grouping,
    trackNumber: data.trackNumber,
    totalTracks: data.totalTracks,
    discNumber: data.discNumber,
    totalDiscs: data.totalDiscs,
    year: data.year,
    duration: data.duration ?? 0,
    bitrate: data.bitrate ?? 0,
    sampleRate: data.sampleRate ?? 44100,
    size: data.size ?? 0,
    bpm: data.bpm,
    filetype: data.filetype,
    mediaType: data.mediaType ?? 0x0001,
    filePath: data.filePath ?? '',
    timeAdded: data.timeAdded ?? Math.floor(Date.now() / 1000),
    timeModified: data.timeModified ?? Math.floor(Date.now() / 1000),
    timePlayed: data.timePlayed ?? 0,
    timeReleased: data.timeReleased ?? 0,
    playCount: data.playCount ?? 0,
    skipCount: data.skipCount ?? 0,
    rating: data.rating ?? 0,
    hasArtwork: data.hasArtwork ?? false,
    hasFile: data.hasFile ?? false,
    compilation: data.compilation ?? false,
    tvShow: data.tvShow,
    tvEpisode: data.tvEpisode,
    sortTvShow: data.sortTvShow,
    seasonNumber: data.seasonNumber,
    episodeNumber: data.episodeNumber,
    movieFlag: data.movieFlag,
    update(_fields: Record<string, unknown>) {
      return createMockIpodTrack({ ...data, ..._fields });
    },
    remove() {},
    copyFile(_path: string) {
      return createMockIpodTrack({ ...data, hasFile: true });
    },
    setArtwork(_path: string) {
      return createMockIpodTrack({ ...data, hasArtwork: true });
    },
    setArtworkFromData(_buf: Buffer) {
      return createMockIpodTrack({ ...data, hasArtwork: true });
    },
    removeArtwork() {
      return createMockIpodTrack({ ...data, hasArtwork: false });
    },
  };
}

// =============================================================================
// IpodDatabase (mock)
// =============================================================================

export class IpodDatabase {
  private _mountPoint: string;
  private _closed = false;

  private constructor(mountPoint: string) {
    this._mountPoint = mountPoint;
  }

  static readonly IpodModels = {
    CLASSIC_120GB: 'MB562',
    CLASSIC_160GB: 'MC297',
    CLASSIC_80GB: 'MB147',
    VIDEO_30GB: 'MA446',
    VIDEO_60GB: 'MA147',
    VIDEO_80GB: 'MA450',
  };

  static async open(mountPoint: string): Promise<IpodDatabase> {
    return new IpodDatabase(mountPoint);
  }

  static async initializeIpod(
    mountPoint: string,
    _options?: { model?: string; name?: string }
  ): Promise<IpodDatabase> {
    return new IpodDatabase(mountPoint);
  }

  static async hasDatabase(_mountPoint: string): Promise<boolean> {
    return true;
  }

  get mountPoint(): string {
    return this._mountPoint;
  }

  get device() {
    return { ...DEMO_DEVICE_INFO };
  }

  get trackCount(): number {
    const state = readState();
    let count = 0;
    if (state.musicSynced) count += getDemoIpodTracks().length;
    if (state.videoSynced) count += getDemoIpodVideoTracks().length;
    return count;
  }

  get playlistCount(): number {
    return 1; // Master playlist
  }

  getInfo() {
    return {
      mountPoint: this._mountPoint,
      trackCount: this.trackCount,
      playlistCount: this.playlistCount,
      device: { ...DEMO_DEVICE_INFO },
    };
  }

  getTracks(): any[] {
    const state = readState();
    const tracks: any[] = [];
    if (state.musicSynced) {
      tracks.push(...getDemoIpodTracks().map((t) => createMockIpodTrack(t)));
    }
    if (state.videoSynced) {
      tracks.push(...getDemoIpodVideoTracks().map((t) => createMockIpodTrack(t)));
    }
    return tracks;
  }

  addTrack(input: Record<string, unknown>): any {
    return createMockIpodTrack(input);
  }

  updateTrack(track: any, fields: Record<string, unknown>): any {
    return createMockIpodTrack({ ...track, ...fields });
  }

  removeTrack(_track: any, _options?: { deleteFile?: boolean }) {
    return { removed: true };
  }

  removeAllTracks(_options?: { deleteFiles?: boolean }) {
    return { removedCount: 0, fileDeleteErrors: [] };
  }

  removeTracksByContentType(_contentType: string, _options?: { deleteFiles?: boolean }) {
    return { removedCount: 0, totalCount: 0, fileDeleteErrors: [] };
  }

  copyFileToTrack(track: any, _sourcePath: string): any {
    return createMockIpodTrack({ ...track, hasFile: true });
  }

  setTrackArtwork(track: any, _imagePath: string): any {
    return createMockIpodTrack({ ...track, hasArtwork: true });
  }

  setTrackArtworkFromData(track: any, _imageData: Buffer): any {
    return createMockIpodTrack({ ...track, hasArtwork: true });
  }

  removeTrackArtwork(track: any): any {
    return createMockIpodTrack({ ...track, hasArtwork: false });
  }

  getPlaylists(): any[] {
    return [
      {
        name: 'iPod',
        trackCount: this.trackCount,
        isMaster: true,
        isSmart: false,
        isPodcasts: false,
        timestamp: Math.floor(Date.now() / 1000),
        rename: () => {},
        remove: () => {},
        getTracks: () => this.getTracks(),
        addTrack: () => {},
        removeTrack: () => {},
        containsTrack: () => false,
      },
    ];
  }

  getMasterPlaylist() {
    return this.getPlaylists()[0];
  }

  getPlaylistByName(_name: string) {
    return null;
  }

  createPlaylist(_name: string) {
    return this.getPlaylists()[0];
  }

  removePlaylist(_playlist: any) {}

  renamePlaylist(_playlist: any, _newName: string) {
    return this.getPlaylists()[0];
  }

  addTrackToPlaylist(_playlist: any, _track: any) {
    return this.getPlaylists()[0];
  }

  removeTrackFromPlaylist(_playlist: any, _track: any) {
    return this.getPlaylists()[0];
  }

  getPlaylistTracks(_playlist: any): any[] {
    return this.getTracks();
  }

  playlistContainsTrack(_playlist: any, _track: any): boolean {
    return false;
  }

  async save() {
    return { warnings: [] };
  }

  close() {
    this._closed = true;
  }

  [Symbol.dispose]() {
    this.close();
  }
}

// =============================================================================
// Device Management (mock)
// =============================================================================

function createMockDeviceManager(): any {
  return {
    platform: 'darwin',
    isSupported: true,
    async eject(_mountPoint: string, _options?: any) {
      return { success: true, device: 'disk4s2' };
    },
    async mount(_deviceId: string, _options?: any) {
      return { success: true, device: 'disk4s2', mountPoint: DEMO_MOUNT_POINT };
    },
    async listDevices() {
      return [{ ...DEMO_PLATFORM_DEVICE }];
    },
    async findIpodDevices() {
      return [{ ...DEMO_PLATFORM_DEVICE }];
    },
    async findByVolumeUuid(_uuid: string) {
      return { ...DEMO_PLATFORM_DEVICE };
    },
    getManualInstructions(_op: string) {
      return 'See podkit documentation.';
    },
    requiresPrivileges(_op: string) {
      return false;
    },
    async getSiblingVolumes(_mountPoint: string) {
      return [];
    },
  };
}

let cachedManager: any = null;

export function getDeviceManager(): any {
  if (!cachedManager) {
    cachedManager = createMockDeviceManager();
  }
  return cachedManager;
}

export function createDeviceManager(): any {
  return createMockDeviceManager();
}

export function clearDeviceManagerCache(): void {
  cachedManager = null;
}

export function getPlatform(): string {
  return 'darwin';
}

export function isPlatformSupported(): boolean {
  return true;
}

// =============================================================================
// Directory Adapter (mock)
// =============================================================================

export class DirectoryAdapter {
  readonly name = 'Directory';
  private _path: string;

  constructor(config: { path: string }) {
    this._path = config.path;
  }

  async connect() {}

  async getItems() {
    return getDemoCollectionTracks();
  }

  async getFilteredItems(_filter: any) {
    return getDemoCollectionTracks();
  }

  getFileAccess(track: any) {
    return { type: 'path' as const, path: track.filePath };
  }

  async disconnect() {}
}

export function createDirectoryAdapter(config: { path: string }) {
  return new DirectoryAdapter(config);
}

// =============================================================================
// Subsonic Adapter (mock)
// =============================================================================

export class SubsonicAdapter {
  readonly name = 'Subsonic';

  constructor(_config: any) {}

  async connect() {}
  async getItems() {
    return getDemoCollectionTracks();
  }
  async getFilteredItems(_filter: any) {
    return getDemoCollectionTracks();
  }
  getFileAccess(track: any) {
    return { type: 'path' as const, path: track.filePath };
  }
  async disconnect() {}
}

export function createSubsonicAdapter(config: any) {
  return new SubsonicAdapter(config);
}

export class SubsonicConnectionError extends Error {
  constructor(message: string = 'Subsonic connection failed') {
    super(message);
    this.name = 'SubsonicConnectionError';
  }
}

// =============================================================================
// Video Directory Adapter (mock)
// =============================================================================

export class VideoDirectoryAdapter {
  readonly name = 'Video Directory';
  private _path: string;

  constructor(config: { path: string }) {
    this._path = config.path;
  }

  async connect() {}

  async getItems() {
    return getDemoCollectionVideos();
  }

  async getFilteredItems(_filter: any) {
    return getDemoCollectionVideos();
  }

  async disconnect() {}
}

export function createVideoDirectoryAdapter(config: { path: string }) {
  return new VideoDirectoryAdapter(config);
}

// =============================================================================
// Differ (mock)
// =============================================================================

export function isDefaultCompatibleFormat(_fileType: string): boolean {
  return ['mp3', 'm4a', 'aac', 'alac'].includes(_fileType);
}

export function requiresTranscoding(_fileType: string): boolean {
  return ['flac', 'ogg', 'opus', 'wav', 'aiff'].includes(_fileType);
}

export function estimateTranscodedSize(durationMs: number, bitrateKbps: number): number {
  return Math.ceil((durationMs / 1000) * ((bitrateKbps * 1000) / 8) + 2048);
}

export function estimateCopySize(track: any): number {
  if (track.duration && track.duration > 0) {
    return estimateTranscodedSize(track.duration, 256);
  }
  return estimateTranscodedSize(240000, 256);
}

export function calculateMusicOperationSize(operation: any): number {
  if (operation.type === 'add-transcode') {
    const duration = operation.source?.duration ?? 240000;
    return estimateTranscodedSize(duration, 256);
  }
  if (operation.type === 'add-direct-copy' || operation.type === 'add-optimized-copy') {
    return estimateCopySize(operation.source);
  }
  return 0;
}

export function categorizeSource(track: any) {
  if (track.lossless || ['flac', 'wav', 'aiff'].includes(track.fileType)) return 'lossless';
  if (['ogg', 'opus'].includes(track.fileType)) return 'incompatible-lossy';
  return 'compatible-lossy';
}

export function isLosslessSource(category: string): boolean {
  return category === 'lossless';
}

export function willWarnLossyToLossy(category: string): boolean {
  return category === 'incompatible-lossy';
}

// =============================================================================
// Executor (mock)
// =============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MusicPipeline {
  private _ipod: any;
  private _transcoder: any;

  constructor(deps: any) {
    this._ipod = deps.ipod;
    this._transcoder = deps.transcoder;
  }

  getWarnings() {
    return [];
  }

  async *execute(plan: any, options: any = {}): AsyncIterable<any> {
    const ops = plan.operations || [];
    const total = ops.length;
    const bytesTotal = plan.estimatedSize || 0;
    let bytesProcessed = 0;

    for (let i = 0; i < total; i++) {
      const op = ops[i];
      const trackName =
        op.type === 'add-transcode' ||
        op.type === 'add-direct-copy' ||
        op.type === 'add-optimized-copy'
          ? `${op.source.artist} - ${op.source.title}`
          : op.type === 'remove'
            ? `${op.track.artist} - ${op.track.title}`
            : 'Unknown';

      const opSize = calculateMusicOperationSize(op);

      // Emit transcoding/copying progress
      const phase =
        op.type === 'add-transcode'
          ? 'transcoding'
          : op.type === 'add-direct-copy' || op.type === 'add-optimized-copy'
            ? 'copying'
            : 'removing';

      yield {
        phase,
        operation: op,
        index: i,
        current: i,
        total,
        currentTrack: trackName,
        bytesProcessed,
        bytesTotal,
        skipped: options.dryRun || false,
      };

      if (!options.dryRun) {
        await delay(75);
      }

      bytesProcessed += opSize;
    }

    // Emit artwork phase
    if (!options.dryRun && total > 0) {
      const artworkOps = ops.filter(
        (op: any) =>
          op.type === 'add-transcode' ||
          op.type === 'add-direct-copy' ||
          op.type === 'add-optimized-copy'
      );
      for (let i = 0; i < artworkOps.length; i++) {
        const op = artworkOps[i];
        yield {
          phase: 'copying',
          operation: op,
          index: ops.length - 1,
          current: ops.length - 1,
          total,
          currentTrack: `Artwork: ${op.source.artist} - ${op.source.title}`,
          bytesProcessed,
          bytesTotal,
        };
        await delay(30);
      }
    }

    // Emit database update phase
    if (total > 0) {
      yield {
        phase: 'updating-db',
        operation: ops[ops.length - 1],
        index: total - 1,
        current: total - 1,
        total,
        currentTrack: 'Saving database...',
        bytesProcessed: bytesTotal,
        bytesTotal,
      };
      if (!options.dryRun) {
        await delay(50);
        // Mark music as synced
        updateState({ musicSynced: true });
      }
    }

    // Completion
    if (total > 0) {
      yield {
        phase: 'complete',
        operation: ops[ops.length - 1],
        index: total - 1,
        current: total - 1,
        total,
        currentTrack: '',
        bytesProcessed: bytesTotal,
        bytesTotal,
      };
    }
  }
}

export function createMusicPipeline(deps: any) {
  return new MusicPipeline(deps);
}

export async function executeMusicPlan(plan: any, deps: any, options: any = {}) {
  const executor = new MusicPipeline(deps);
  let completed = 0;
  let failed = 0;
  let skipped = 0;

  for await (const progress of executor.execute(plan, options)) {
    if (progress.skipped) skipped++;
    else if (progress.error) failed++;
    else if (progress.phase !== 'complete') completed++;
  }

  return {
    completed,
    failed,
    skipped,
    errors: [],
    categorizedErrors: [],
    warnings: [],
    bytesTransferred: plan.estimatedSize || 0,
  };
}

export function getMusicOperationDisplayName(operation: any): string {
  switch (operation.type) {
    case 'add-transcode':
    case 'add-direct-copy':
    case 'add-optimized-copy':
      return `${operation.source.artist} - ${operation.source.title}`;
    case 'remove':
      return `${operation.track.artist} - ${operation.track.title}`;
    case 'update-metadata':
      return `${operation.track.artist} - ${operation.track.title}`;
    case 'upgrade-transcode':
    case 'upgrade-direct-copy':
    case 'upgrade-optimized-copy':
    case 'upgrade-artwork':
      return `${operation.source.artist} - ${operation.source.title}`;
    case 'video-transcode':
    case 'video-copy':
      return operation.source.title;
    case 'video-remove':
      return operation.video.title;
    default:
      return 'Unknown operation';
  }
}

export function categorizeError(_error: Error, operationType: string) {
  if (operationType === 'add-transcode' || operationType === 'upgrade-transcode')
    return 'transcode';
  if (operationType === 'add-direct-copy' || operationType === 'add-optimized-copy') return 'copy';
  return 'unknown';
}

export function createCategorizedError(
  error: Error,
  operation: any,
  retryAttempts: number,
  wasRetried: boolean
) {
  return {
    error,
    category: categorizeError(error, operation.type),
    trackName: getMusicOperationDisplayName(operation),
    retryAttempts,
    wasRetried,
  };
}

export function getRetriesForCategory(category: string, _config: any): number {
  if (category === 'transcode' || category === 'copy') return 1;
  return 0;
}

export const MUSIC_RETRY_CONFIG = {
  transcodeRetries: 1,
  copyRetries: 1,
  databaseRetries: 0,
  retryDelayMs: 1000,
};

// =============================================================================
// Video Differ (mock)
// =============================================================================

export function generateVideoMatchKey(video: any): string {
  if (video.contentType === 'movie') {
    return `movie:${video.title.toLowerCase()}:${video.year || ''}`;
  }
  return `tvshow:${(video.seriesTitle || video.title).toLowerCase()}`;
}

// =============================================================================
// Video Estimation (mock)
// =============================================================================

export function estimateVideoTranscodedSize(
  durationSeconds: number,
  videoBitrateKbps: number,
  audioBitrateKbps: number
): number {
  return Math.ceil(
    (durationSeconds * videoBitrateKbps * 1000) / 8 +
      (durationSeconds * audioBitrateKbps * 1000) / 8 +
      4096
  );
}

export function estimatePassthroughSize(video: any): number {
  const videoBitrate = video.width >= 1280 ? 2500 : video.width >= 640 ? 1500 : 800;
  return estimateVideoTranscodedSize(video.duration, videoBitrate, 128);
}

// =============================================================================
// Video Executor (mock)
// =============================================================================

export class PlaceholderVideoSyncExecutor {
  async *execute(plan: any, options: any = {}): AsyncIterable<any> {
    if (!options.dryRun) {
      throw new Error('PlaceholderVideoSyncExecutor only supports dry-run mode.');
    }
    const ops = plan.operations || [];
    for (let i = 0; i < ops.length; i++) {
      yield {
        phase: 'video-copying',
        operation: ops[i],
        index: i,
        current: i,
        total: ops.length,
        currentTrack: getVideoOperationDisplayName(ops[i]),
        bytesProcessed: 0,
        bytesTotal: plan.estimatedSize || 0,
        skipped: true,
      };
    }
  }
}

export function getVideoOperationDisplayName(operation: any): string {
  if (operation.type === 'video-transcode' || operation.type === 'video-copy') {
    const video = operation.source;
    if (video.year) return `${video.title} (${video.year})`;
    return video.title;
  }
  if (operation.type === 'video-remove') {
    return operation.video.title;
  }
  return 'Unknown operation';
}

export function createVideoExecutor(_deps?: any) {
  return new PlaceholderVideoSyncExecutor();
}

// =============================================================================
// FFmpeg Transcoder (mock)
// =============================================================================

export class FFmpegNotFoundError extends Error {
  constructor(message: string = 'FFmpeg not found') {
    super(message);
    this.name = 'FFmpegNotFoundError';
  }
}

export class TranscodeError extends Error {
  readonly exitCode?: number;
  readonly stderr?: string;
  constructor(message: string, exitCode?: number, stderr?: string) {
    super(message);
    this.name = 'TranscodeError';
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export class FFmpegTranscoder {
  constructor(_config?: any) {}

  async detect() {
    return {
      version: '7.1',
      path: '/usr/local/bin/ffmpeg',
      aacEncoders: ['aac_at', 'aac'],
      preferredEncoder: 'aac_at',
    };
  }

  async transcode(input: string, output: string, _preset: string) {
    return {
      outputPath: output,
      size: 8000000,
      duration: 3500,
      bitrate: 256,
    };
  }

  async probe(_file: string) {
    return {
      duration: 240000,
      bitrate: 900,
      sampleRate: 44100,
      channels: 2,
      codec: 'flac',
      format: 'flac',
    };
  }
}

export function createFFmpegTranscoder(config?: any) {
  return new FFmpegTranscoder(config);
}

export async function isFFmpegAvailable(): Promise<boolean> {
  return true;
}

export function buildTranscodeArgs(_input: string, _output: string, _preset: string): string[] {
  return [];
}

export function buildAlacArgs(_input: string, _output: string): string[] {
  return [];
}

export function buildVbrArgs(_encoder: string, _quality: number): string[] {
  return [];
}

// =============================================================================
// Transcode progress parsing
// =============================================================================

export function parseFFmpegProgress(_lines: string) {
  return { time: 0, duration: 0, percent: 0 };
}

export function parseFFmpegProgressLine(_line: string) {
  return null;
}

export function parseTimeString(_str: string): number {
  return 0;
}

// =============================================================================
// Quality presets (constants)
// =============================================================================

export const QUALITY_PRESETS = ['max', 'high', 'medium', 'low'] as const;

export const AAC_PRESETS = {
  high: { mode: 'vbr', quality: 5, targetKbps: 256 },
  medium: { mode: 'vbr', quality: 4, targetKbps: 192 },
  low: { mode: 'vbr', quality: 2, targetKbps: 128 },
} as const;

export const ALAC_PRESET = {
  codec: 'alac' as const,
  container: 'm4a' as const,
  estimatedKbps: 900,
} as const;

export function isValidQualityPreset(value: string): boolean {
  return QUALITY_PRESETS.includes(value as any);
}

export function getPresetBitrate(preset: string): number {
  return (AAC_PRESETS as any)[preset]?.targetKbps ?? 256;
}

export function isMaxPreset(preset: string): boolean {
  return preset === 'max';
}

export function isVbrEncoding(encoding?: string): boolean {
  return encoding !== 'cbr';
}

export function supportsAlac(_generation: string): boolean {
  return false;
}

// =============================================================================
// Artwork (mock)
// =============================================================================

export const IPOD_ARTWORK_FORMATS = [] as any[];
export const EXTERNAL_ARTWORK_NAMES = ['cover.jpg', 'folder.jpg', 'cover.png', 'folder.png'];

export async function extractArtwork(_filePath: string, _options?: any) {
  return null;
}

export async function saveArtworkToTemp(_artwork: any) {
  return '/tmp/podkit-demo/artwork.jpg';
}

export function cleanupTempArtwork(_path: string) {}
export function cleanupAllTempArtwork() {}

export async function extractAndSaveArtwork(_filePath: string, _options?: any) {
  return null;
}

export function hashArtwork(_data: Buffer | Uint8Array): string {
  return '00000000';
}

export function selectBestPicture(pictures: any[]) {
  return pictures[0];
}

// =============================================================================
// Metadata extraction (mock)
// =============================================================================

export async function getFileDisplayMetadata(_filePath: string) {
  return { hasArtwork: true, bitrate: 900 };
}

export async function getFilesDisplayMetadata(filePaths: string[]) {
  return new Map(filePaths.map((fp) => [fp, { hasArtwork: true, bitrate: 900 }]));
}

// =============================================================================
// Device Validation (mock)
// =============================================================================

export function validateDevice(_device: any, _mountPoint?: string) {
  return {
    supported: true,
    issues: [],
    warnings: [],
    capabilities: {
      music: true,
      artwork: true,
      video: true,
      podcast: true,
    },
  };
}

export function isUnsupportedGeneration(_generation: string): boolean {
  return false;
}

export function formatValidationMessages(_result: any): string[] {
  return [];
}

export function formatCapabilities(_capabilities: any, _device: any): string[] {
  return ['    + Music', '    + Album artwork', '    + Video playback', '    + Podcasts'];
}

export function buildSyncWarnings(_validation: any, _config: any): string[] {
  return [];
}

// =============================================================================
// iPod Generation (mock)
// =============================================================================

export const IPOD_GENERATIONS = {} as any;

export function formatGeneration(generation: string): string {
  if (generation === 'classic_3') return 'Classic (3rd Generation)';
  if (generation === 'classic_2') return 'Classic (2nd Generation)';
  if (generation === 'classic_1') return 'Classic (1st Generation)';
  return generation;
}

export function getVideoProfile(_generation: string) {
  return 'ipod-classic';
}

export function supportsVideo(_generation: string): boolean {
  return true;
}

// =============================================================================
// Transforms (mock, pass-through)
// =============================================================================

export const DEFAULT_CLEAN_ARTISTS_CONFIG = { enabled: false };
export const DEFAULT_TRANSFORMS_CONFIG = { cleanArtists: { enabled: false } };

export function applyTransforms(track: any, _config: any) {
  return { track, transformed: false, changes: [] };
}

export function hasEnabledTransforms(_config: any): boolean {
  return false;
}

export function getEnabledTransformsSummary(_config: any): string[] {
  return [];
}

export function cleanArtistsTransform(track: any, _config: any) {
  return { track, transformed: false, changes: [] };
}

export function applyFtInTitle(title: string, artist: string, _config?: any) {
  return { title, artist, transformed: false };
}

export function extractFeaturedArtist(_title: string) {
  return null;
}

export function insertFeatIntoTitle(title: string, _feat: string) {
  return title;
}

export function titleContainsFeat(_title: string): boolean {
  return false;
}

// =============================================================================
// Track Matching (mock)
// =============================================================================

export function normalizeString(str: string): string {
  return str.toLowerCase().trim();
}

export function normalizeArtist(artist: string): string {
  return normalizeString(artist);
}

export function normalizeTitle(title: string): string {
  return normalizeString(title);
}

export function normalizeAlbum(album: string): string {
  return normalizeString(album);
}

export function getMatchKey(track: any): string {
  return `${normalizeArtist(track.artist)}\u001F${normalizeTitle(track.title)}\u001F${normalizeAlbum(track.album)}`;
}

export function tracksMatch(a: any, b: any): boolean {
  return getMatchKey(a) === getMatchKey(b);
}

export function buildMatchIndex(tracks: any[]) {
  const index = new Map();
  for (const track of tracks) {
    index.set(getMatchKey(track), track);
  }
  return index;
}

export function findMatches(collectionTracks: any[], ipodIndex: Map<string, any>) {
  return collectionTracks
    .filter((t: any) => ipodIndex.has(getMatchKey(t)))
    .map((t: any) => ({ collection: t, ipod: ipodIndex.get(getMatchKey(t)) }));
}

export function findOrphanedTracks(ipodTracks: any[], matchedIds: Set<string>) {
  return ipodTracks.filter((t: any) => !matchedIds.has(getMatchKey(t)));
}

export function getTransformMatchKeys(_track: any, _config: any) {
  return [];
}

// =============================================================================
// Video types / functions (mock)
// =============================================================================

export const VIDEO_QUALITY_PRESETS = ['max', 'high', 'medium', 'low'] as const;
export const DEVICE_PROFILES = {} as any;
export const VIDEO_PRESET_SETTINGS = {} as any;

export function isValidVideoQualityPreset(value: string): boolean {
  return VIDEO_QUALITY_PRESETS.includes(value as any);
}

export function getDeviceProfile(_name: string) {
  return { maxWidth: 640, maxHeight: 480, profile: 'main', level: '3.1' };
}

export function getDefaultDeviceProfile() {
  return getDeviceProfile('ipod-classic');
}

export function getDeviceProfileByGeneration(_generation: string) {
  return getDeviceProfile('ipod-classic');
}

export function getDeviceProfileNames(): string[] {
  return ['ipod-classic', 'ipod-video-5g', 'ipod-nano-3g'];
}

export function getPresetSettings(_preset: string) {
  return { videoBitrate: 1500, audioBitrate: 128, crf: 23 };
}

export function getPresetSettingsWithFallback(_preset: string) {
  return getPresetSettings(_preset);
}

// Video metadata helpers
export function isMovieMetadata(metadata: any): boolean {
  return metadata?.contentType === 'movie';
}

export function isTVShowMetadata(metadata: any): boolean {
  return metadata?.contentType === 'tvshow';
}

export function formatEpisodeId(season: number, episode: number): string {
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
}

export function parseEpisodeId(_str: string) {
  return null;
}

// Video probe
export class VideoProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoProbeError';
  }
}

export async function probeVideo(_filePath: string) {
  return {
    filePath: _filePath,
    container: 'm4v',
    videoCodec: 'h264',
    videoProfile: 'main',
    videoLevel: '3.1',
    width: 640,
    height: 480,
    videoBitrate: 1500,
    frameRate: 24,
    audioCodec: 'aac',
    audioBitrate: 128,
    audioChannels: 2,
    audioSampleRate: 48000,
    duration: 5400,
    hasVideoStream: true,
    hasAudioStream: true,
  };
}

// Video compatibility
export function checkVideoCompatibility(_analysis: any, _device: any) {
  return { status: 'passthrough', reason: 'Compatible format' };
}

export function isCompatibleVideoCodec(_codec: string): boolean {
  return true;
}

export function isCompatibleAudioCodec(_codec: string): boolean {
  return true;
}

export function isCompatibleContainer(_container: string): boolean {
  return true;
}

export function canPassthrough(_analysis: any, _device: any) {
  return { passthrough: true, reason: 'Compatible format' };
}

// Video quality
export function calculateTargetDimensions(_source: any, _device: any) {
  return { width: 640, height: 480 };
}

export function calculateEffectiveSettings(_analysis: any, _preset: string, _device: any) {
  return {
    targetVideoBitrate: 1500,
    targetAudioBitrate: 128,
    targetWidth: 640,
    targetHeight: 480,
    useHardwareAcceleration: true,
  };
}

export function generateQualityWarnings(_analysis: any, _settings: any): any[] {
  return [];
}

export function isSourceQualityLimiting(_analysis: any, _settings: any): boolean {
  return false;
}

export function getQualityLimitationSummary(_analysis: any, _settings: any): string | null {
  return null;
}

// Video transcoding
export function transcodeVideo(_input: string, _output: string, _settings: any, _options?: any) {
  return Promise.resolve();
}

export function buildVideoTranscodeArgs(_input: string, _output: string, _settings: any): string[] {
  return [];
}

export function buildScaleFilter(_width: number, _height: number): string {
  return '';
}

export function parseVideoProgress(_output: string) {
  return null;
}

export async function detectHardwareAcceleration() {
  return { available: true, method: 'videotoolbox' };
}

export class VideoTranscodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoTranscodeError';
  }
}

// =============================================================================
// Sync Tags (mock)
// =============================================================================

export function syncTagMatchesConfig(_tag: any, _config: any): boolean {
  return true;
}

export function syncTagsEqual(_a: any, _b: any): boolean {
  return true;
}

export function buildAudioSyncTag(_config: any): any {
  return {};
}

export function buildCopySyncTag(_transferMode: string, _artworkHash?: string): any {
  return { quality: 'copy' };
}

export function buildVideoSyncTag(_config: any): any {
  return {};
}

// =============================================================================
// Sound Check (mock)
// =============================================================================

export function replayGainToSoundcheck(_gain: number): number {
  return 1000;
}

export function iTunNORMToSoundcheck(_norm: string): number {
  return 1000;
}

export function extractSoundcheck(_track: any): any {
  return null;
}

// =============================================================================
// Upgrade detection (mock)
// =============================================================================

export function isQualityUpgrade(_source: any, _device: any): boolean {
  return false;
}

export function detectUpgrades(_source: any, _device: any): string[] {
  return [];
}

export function isFileReplacementUpgrade(_source: any, _device: any): boolean {
  return false;
}

export function isSourceLossless(_source: any): boolean {
  return false;
}

export function detectPresetChange(_source: any, _device: any, _options?: any): boolean {
  return false;
}

export function detectBitratePresetMismatch(_source: any, _device: any, _options?: any): boolean {
  return false;
}

export const DEFAULT_VBR_TOLERANCE = 0.15;
export const DEFAULT_CBR_TOLERANCE = 0.05;
export const DEFAULT_MIN_PRESET_BITRATE = 64;

export const DEFAULT_LOSSY_STACK = ['opus', 'aac', 'mp3'];
export const DEFAULT_LOSSLESS_STACK = ['source', 'flac', 'alac'];

// Codec metadata and presets (inlined to avoid cyclic imports)
export const CODEC_METADATA = {
  aac: {
    codec: 'aac',
    container: 'M4A',
    extension: '.m4a',
    ffmpegFormat: 'ipod',
    filetypeLabel: 'AAC audio file',
    sampleRate: 44100,
    type: 'lossy',
  },
  alac: {
    codec: 'alac',
    container: 'M4A',
    extension: '.m4a',
    ffmpegFormat: 'ipod',
    filetypeLabel: 'ALAC audio file',
    sampleRate: 44100,
    type: 'lossless',
  },
  opus: {
    codec: 'opus',
    container: 'OGG',
    extension: '.opus',
    ffmpegFormat: 'ogg',
    filetypeLabel: 'Opus audio file',
    sampleRate: 48000,
    type: 'lossy',
  },
  mp3: {
    codec: 'mp3',
    container: 'MP3',
    extension: '.mp3',
    ffmpegFormat: 'mp3',
    filetypeLabel: 'MPEG audio file',
    sampleRate: 44100,
    type: 'lossy',
  },
  flac: {
    codec: 'flac',
    container: 'FLAC',
    extension: '.flac',
    ffmpegFormat: 'flac',
    filetypeLabel: 'FLAC audio file',
    sampleRate: 44100,
    type: 'lossless',
  },
} as const;
export function getCodecMetadata(codec: string) {
  return (CODEC_METADATA as any)[codec];
}
export const OPUS_PRESETS = {
  high: { targetKbps: 160 },
  medium: { targetKbps: 128 },
  low: { targetKbps: 96 },
} as const;
export const MP3_PRESETS = {
  high: { targetKbps: 256, vbrQuality: 0 },
  medium: { targetKbps: 192, vbrQuality: 2 },
  low: { targetKbps: 128, vbrQuality: 4 },
} as const;
export const FLAC_ESTIMATED_KBPS = 700;
export const ALAC_ESTIMATED_KBPS = 900;
export function getCodecPresetBitrate(_codec: string, _preset: string, customBitrate?: number) {
  return customBitrate ?? 256;
}
export function getCodecVbrQuality(_codec: string, _preset: string) {
  return undefined;
}
export function getLosslessEstimatedKbps(_codec: string) {
  return 900;
}
export function resolveCodecPreferences(_config: any, _deviceCodecs: any, _encoders: any) {
  return { lossy: { codec: 'aac', metadata: CODEC_METADATA.aac }, lossless: ['source'] };
}
export function isCodecResolutionError(_result: any): boolean {
  return false;
}
export function encoderAvailabilityFrom(_caps: any) {
  return { hasEncoder: () => true };
}

// =============================================================================
// Album Artwork Cache (mock)
// =============================================================================

export class AlbumArtworkCache {
  constructor(_options?: any) {}
  get(_key: string): any {
    return undefined;
  }
  set(_key: string, _entry: any): void {}
  has(_key: string): boolean {
    return false;
  }
  clear(): void {}
  get size(): number {
    return 0;
  }
}

export function getAlbumKey(_track: any): string {
  return '';
}

// =============================================================================
// Artwork diagnostics (mock)
// =============================================================================

export function parseArtworkDB(_path: string): any {
  return { images: [], files: [], items: [] };
}

export function checkIntegrity(_db: any): any {
  return { anomalies: [], formats: [], healthy: true };
}

// =============================================================================
// Artwork repair (mock)
// =============================================================================

export async function resetArtworkDatabase(_mountPoint: string, _options?: any) {
  return { success: true };
}

export async function rebuildArtworkDatabase(_mountPoint: string, _options?: any) {
  return { success: true, tracksProcessed: 0, artworkCount: 0 };
}

// =============================================================================
// Diagnostics (mock)
// =============================================================================

export async function runDiagnostics(_context: any) {
  return { checks: [], healthy: true };
}

export function getDiagnosticCheck(_id: string): any {
  return null;
}

export function getDiagnosticCheckIds(): string[] {
  return [];
}

// =============================================================================
// CONTENT_TYPES constant
// =============================================================================

export const CONTENT_TYPES = {
  music: 'music',
  video: 'video',
} as const;

// =============================================================================
// Eject with retry (mock)
// =============================================================================

export async function ejectWithRetry(_mountPoint: string, _options?: any) {
  return { success: true, device: 'disk4s2' };
}

export function stripPartitionSuffix(device: string): string {
  return device;
}

// =============================================================================
// Video transforms (mock)
// =============================================================================

export const DEFAULT_SHOW_LANGUAGE_CONFIG = { enabled: false };
export const DEFAULT_VIDEO_TRANSFORMS_CONFIG = { showLanguage: { enabled: false } };

export function applyVideoTransforms(track: any, _config: any) {
  return { track, transformed: false, changes: [] };
}

export function hasEnabledVideoTransforms(_config: any): boolean {
  return false;
}

export function getEnabledVideoTransformsSummary(_config: any): string[] {
  return [];
}

export function getVideoTransformMatchKeys(_track: any, _config: any) {
  return [];
}

export function applyShowLanguage(title: string, _config?: any) {
  return { title, transformed: false };
}

export function parseLanguageMarker(_title: string) {
  return null;
}

export function showLanguageTransform(track: any, _config: any) {
  return { track, transformed: false, changes: [] };
}

// =============================================================================
// Shared error handling exports (mock)
// =============================================================================

export function sharedCategorizeError(_error: Error, operationType: string) {
  if (operationType === 'add-transcode' || operationType === 'upgrade-transcode')
    return 'transcode';
  if (operationType === 'add-direct-copy' || operationType === 'add-optimized-copy') return 'copy';
  return 'unknown';
}

export function sharedCreateCategorizedError(
  error: Error,
  category: string,
  trackName: string,
  retryAttempts: number,
  wasRetried: boolean
) {
  return { error, category, trackName, retryAttempts, wasRetried };
}

export function sharedGetRetriesForCategory(category: string, _config: any): number {
  if (category === 'transcode' || category === 'copy') return 1;
  return 0;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  _maxRetries: number,
  _delayMs?: number
): Promise<T> {
  return fn();
}

export const SHARED_DEFAULT_RETRY_CONFIG = {
  transcode: 1,
  copy: 1,
  database: 0,
  artwork: 0,
  unknown: 0,
  retryDelayMs: 1000,
};

export const VIDEO_RETRY_CONFIG = {
  transcode: 0,
  copy: 1,
  database: 0,
  artwork: 0,
  unknown: 0,
  retryDelayMs: 1000,
};

// =============================================================================
// ENCODING_MODES constant
// =============================================================================

export const ENCODING_MODES = ['vbr', 'cbr'] as const;

// =============================================================================
// MusicHandler (mock)
// =============================================================================

export class MusicHandler {
  readonly type = 'music';

  constructor(_config?: any) {
    // Config accepted but ignored in mock
  }

  getOperationPriority(op: any): number {
    const type = op?.type ?? '';
    if (type.includes('remove')) return 0;
    if (type.includes('update') || type.includes('sync-tag')) return 1;
    if (type.includes('copy')) return 2;
    if (type.includes('upgrade')) return 3;
    if (type.includes('transcode')) return 4;
    return 5;
  }

  generateMatchKey(source: any): string {
    return getMatchKey(source);
  }

  generateDeviceMatchKey(device: any): string {
    return getMatchKey(device);
  }

  applyTransformKey(source: any): string {
    return getMatchKey(source);
  }

  getDeviceItemId(device: any): string {
    return device.filePath ?? '';
  }

  detectUpdates(_source: any, _device: any, _options?: any): string[] {
    return [];
  }

  filterDeviceItems(tracks: any[]): any[] {
    return tracks.filter((t: any) => isMusicMediaType(t.mediaType ?? 0x0001));
  }

  planAdd(source: any, _options?: any) {
    return { operation: { type: 'add-transcode', source, preset: { name: 'high' } } };
  }

  planUpdate(source: any, device: any, reasons: string[], _options?: any) {
    return { type: 'update-metadata', source, track: device, reasons };
  }

  planRemove(device: any) {
    return { type: 'remove', track: device };
  }

  estimateSize(operation: any): number {
    return calculateMusicOperationSize(operation);
  }

  estimateTime(_operation: any): number {
    return 5;
  }

  getDisplayName(operation: any): string {
    return getMusicOperationDisplayName(operation);
  }

  getDryRunSummary(diff: any, plan: any): any {
    return {
      toAdd: diff.toAdd?.length ?? 0,
      toRemove: diff.toRemove?.length ?? 0,
      existing: diff.existing?.length ?? 0,
      toUpdate: diff.toUpdate?.length ?? 0,
      operationCounts: {},
      estimatedSize: plan.estimatedSize ?? 0,
      estimatedTime: plan.estimatedTime ?? 0,
      warnings: [],
      operations: [],
    };
  }

  async executeOperation(_operation: any, _context: any): Promise<any> {
    return { phase: 'complete' };
  }
}

export function createMusicHandler(config?: any): MusicHandler {
  return new MusicHandler(config);
}

export function getMusicDeviceItems(device: any): any[] {
  return device.getTracks?.()?.filter?.((t: any) => t.mediaType === 1) ?? [];
}

// =============================================================================
// VideoHandler (mock)
// =============================================================================

export class VideoHandler {
  readonly type = 'video';

  constructor(_config?: any) {
    // Config accepted but ignored in mock
  }

  getOperationPriority(op: any): number {
    const type = op?.type ?? '';
    if (type.includes('remove')) return 0;
    if (type.includes('update')) return 1;
    if (type.includes('copy')) return 2;
    if (type.includes('upgrade')) return 3;
    if (type.includes('transcode')) return 4;
    return 5;
  }

  generateMatchKey(source: any): string {
    return generateVideoMatchKey(source);
  }

  generateDeviceMatchKey(device: any): string {
    return generateVideoMatchKey(device);
  }

  applyTransformKey(source: any): string {
    return generateVideoMatchKey(source);
  }

  getDeviceItemId(device: any): string {
    return device.id ?? '';
  }

  detectUpdates(_source: any, _device: any, _options?: any): string[] {
    return [];
  }

  filterDeviceItems(tracks: any[]): any[] {
    return tracks.filter((t: any) => isVideoMediaType(t.mediaType ?? 0));
  }

  planAdd(source: any, _options?: any) {
    return { operation: { type: 'video-copy', source } };
  }

  planUpdate(source: any, device: any, reasons: string[], _options?: any) {
    return { type: 'video-update-metadata', source, track: device, reasons };
  }

  planRemove(device: any) {
    return { type: 'video-remove', video: device };
  }

  estimateSize(_operation: any): number {
    return 0;
  }

  estimateTime(_operation: any): number {
    return 5;
  }

  getDisplayName(operation: any): string {
    return getVideoOperationDisplayName(operation);
  }

  getDryRunSummary(diff: any, plan: any): any {
    return {
      toAdd: diff.toAdd?.length ?? 0,
      toRemove: diff.toRemove?.length ?? 0,
      existing: diff.existing?.length ?? 0,
      toUpdate: diff.toUpdate?.length ?? 0,
      operationCounts: {},
      estimatedSize: plan.estimatedSize ?? 0,
      estimatedTime: plan.estimatedTime ?? 0,
      warnings: [],
      operations: [],
    };
  }

  async executeOperation(_operation: any, _context: any): Promise<any> {
    return { phase: 'complete' };
  }
}

export function createVideoHandler(config?: any): VideoHandler {
  return new VideoHandler(config);
}

export function getVideoDeviceItems(device: any): any[] {
  return device.getTracks?.()?.filter?.((t: any) => t.mediaType === 2 || t.mediaType === 6) ?? [];
}

// =============================================================================
// SyncDiffer (mock)
// =============================================================================

export class SyncDiffer {
  private _handler: any;

  constructor(handler: any) {
    this._handler = handler;
  }

  diff(sourceItems: any[], deviceItems: any[], _options?: any) {
    if (deviceItems.length === 0) {
      return {
        toAdd: sourceItems,
        toRemove: [],
        existing: [],
        toUpdate: [],
      };
    }
    return {
      toAdd: [],
      toRemove: [],
      existing: sourceItems.map((s: any, i: number) => ({
        source: s,
        device: deviceItems[i],
      })),
      toUpdate: [],
    };
  }
}

export function createSyncDiffer(handler: any) {
  return new SyncDiffer(handler);
}

// =============================================================================
// SyncPlanner (mock)
// =============================================================================

export class SyncPlanner {
  private _handler: any;

  constructor(handler: any) {
    this._handler = handler;
  }

  plan(diff: any, _options?: any) {
    const operations: any[] = [];
    for (const item of diff.toAdd || []) {
      const result = this._handler.planAdd(item, _options);
      if (result?.operation) operations.push(result.operation);
    }
    return {
      operations,
      estimatedTime: 0,
      estimatedSize: 0,
      warnings: [],
    };
  }
}

export function createSyncPlanner(handler: any) {
  return new SyncPlanner(handler);
}

export function orderOperations(operations: any[]): any[] {
  const order: Record<string, number> = {
    remove: 0,
    'video-remove': 0,
    'update-metadata': 1,
    'video-update-metadata': 1,
    copy: 2,
    'video-copy': 2,
    upgrade: 3,
    'video-upgrade': 3,
    transcode: 4,
    'video-transcode': 4,
  };
  return [...operations].sort((a, b) => (order[a.type] ?? 99) - (order[b.type] ?? 99));
}

// =============================================================================
// SyncExecutor (mock)
// =============================================================================

export class SyncExecutor {
  private _handler: any;

  constructor(handler: any) {
    this._handler = handler;
  }

  async *execute(plan: any, _options?: any): AsyncIterable<any> {
    const ops = plan.operations || [];
    for (let i = 0; i < ops.length; i++) {
      yield {
        phase: 'in-progress',
        operation: ops[i],
        index: i,
        current: i,
        total: ops.length,
        currentTrack: this._handler.getDisplayName(ops[i]),
        bytesProcessed: 0,
        bytesTotal: plan.estimatedSize || 0,
      };
    }
    if (ops.length > 0) {
      yield {
        phase: 'complete',
        operation: ops[ops.length - 1],
        index: ops.length - 1,
        current: ops.length - 1,
        total: ops.length,
        currentTrack: '',
        bytesProcessed: plan.estimatedSize || 0,
        bytesTotal: plan.estimatedSize || 0,
      };
    }
  }

  async executeAll(plan: any, options?: any) {
    let completed = 0;
    for await (const progress of this.execute(plan, options)) {
      if (progress.phase !== 'complete') completed++;
    }
    return {
      completed,
      failed: 0,
      skipped: 0,
      errors: [],
      categorizedErrors: [],
      warnings: [],
      bytesTransferred: plan.estimatedSize || 0,
    };
  }
}

export function createSyncExecutor(handler: any) {
  return new SyncExecutor(handler);
}

// =============================================================================
// Stream utilities (mock)
// =============================================================================

export async function streamToTempFile(_getStream: any, _size?: number): Promise<string> {
  return '/tmp/podkit-demo/temp-stream';
}

export function cleanupTempFile(_path: string) {}

// =============================================================================
// Device adapter mocks
// =============================================================================

export const DEVICE_PRESETS: Record<string, any> = {
  'echo-mini': {
    artworkSources: ['embedded'],
    artworkMaxResolution: 127,
    supportedAudioCodecs: ['aac', 'alac', 'mp3', 'flac', 'ogg', 'wav'],
    supportsVideo: false,
    audioNormalization: 'none',
    supportsAlbumArtistBrowsing: true,
  },
  rockbox: {
    artworkSources: ['sidecar', 'embedded'],
    artworkMaxResolution: 320,
    supportedAudioCodecs: ['aac', 'alac', 'mp3', 'flac', 'ogg', 'opus', 'wav', 'aiff'],
    supportsVideo: false,
    audioNormalization: 'replaygain',
    supportsAlbumArtistBrowsing: true,
  },
  generic: {
    artworkSources: ['embedded'],
    artworkMaxResolution: 500,
    supportedAudioCodecs: ['aac', 'mp3', 'flac'],
    supportsVideo: false,
    audioNormalization: 'none',
    supportsAlbumArtistBrowsing: true,
  },
};

export function fileTypeToAudioCodec(fileType: string, _codec?: string): string | undefined {
  return fileType;
}

export function normalizeContentPaths(
  partial: Partial<{ musicDir: string; moviesDir: string; tvShowsDir: string }>,
  defaults: { musicDir: string; moviesDir: string; tvShowsDir: string } = {
    musicDir: 'Music',
    moviesDir: 'Movies',
    tvShowsDir: 'TV Shows',
  }
): { musicDir: string; moviesDir: string; tvShowsDir: string } {
  return {
    musicDir: (partial.musicDir ?? defaults.musicDir).replace(/^\/+|\/+$/g, ''),
    moviesDir: (partial.moviesDir ?? defaults.moviesDir).replace(/^\/+|\/+$/g, ''),
    tvShowsDir: (partial.tvShowsDir ?? defaults.tvShowsDir).replace(/^\/+|\/+$/g, ''),
  };
}

export function validateContentPaths(_paths: {
  musicDir: string;
  moviesDir: string;
  tvShowsDir: string;
}): void {
  // No-op for demo
}

export function getDevicePreset(deviceType: string): any {
  return DEVICE_PRESETS[deviceType];
}

export function resolveDeviceCapabilities(deviceType: string, overrides?: any): any {
  const preset = getDevicePreset(deviceType);
  if (!preset) return undefined;
  if (!overrides) return preset;
  return {
    artworkSources: overrides.artworkSources ?? preset.artworkSources,
    artworkMaxResolution: overrides.artworkMaxResolution ?? preset.artworkMaxResolution,
    supportedAudioCodecs: overrides.supportedAudioCodecs ?? preset.supportedAudioCodecs,
    supportsVideo: overrides.supportsVideo ?? preset.supportsVideo,
    audioNormalization: overrides.audioNormalization ?? preset.audioNormalization,
    supportsAlbumArtistBrowsing:
      overrides.supportsAlbumArtistBrowsing ?? preset.supportsAlbumArtistBrowsing,
  };
}

export class MassStorageAdapter {
  readonly capabilities: any;
  readonly mountPoint: string;

  constructor(mountPoint: string, capabilities: any) {
    this.mountPoint = mountPoint;
    this.capabilities = capabilities;
  }

  static async open(mountPoint: string, capabilities: any): Promise<MassStorageAdapter> {
    return new MassStorageAdapter(mountPoint, capabilities);
  }

  getTracks(): any[] {
    return [];
  }

  close(): void {}
}

export class MassStorageTrack {
  constructor(_opts: any) {}
}

export class IpodDeviceAdapter {
  constructor(_ipod: any) {}
}

// ── Device readiness (mock) ─────────────────────────────────────────────────

export const STAGE_DISPLAY_NAMES: Record<string, string> = {
  usb: 'USB Connection',
  partition: 'Partition Table',
  filesystem: 'Filesystem',
  mount: 'Mounted',
  sysinfo: 'SysInfo',
  database: 'Database',
};

export async function checkReadiness(_input: any): Promise<any> {
  return { level: 'ready', stages: [], summary: { trackCount: 0 } };
}

export async function discoverUsbIpods(): Promise<any[]> {
  return [];
}

export function createUsbOnlyReadinessResult(_device: any): any {
  return { level: 'needs-partition', stages: [] };
}

export function interpretError(error: Error | string): any {
  const msg = typeof error === 'string' ? error : error.message;
  return { explanation: msg, rawMessage: msg };
}

// =============================================================================
// Stubs for exports used internally by @podkit/core but re-exported from index
// =============================================================================

export const DEFAULT_CONTENT_PATHS = {
  musicDir: 'Music',
  moviesDir: 'Video/Movies',
  tvShowsDir: 'Video/Shows',
};
export const MANIFEST_FILE = '.podkit-manifest.json';
export const PODKIT_DIR = '.podkit';
export const TRANSFER_MODES = ['fast', 'optimized', 'portable'] as const;

export class MusicOperationFactory {
  constructor(_config?: any) {}
}
export class MusicTrackClassifier {
  constructor(_config?: any) {}
}
export class VideoTrackClassifier {
  constructor(_config?: any) {}
}

export function buildOptimizedCopyArgs(_src: string, _dst: string): string[] {
  return [];
}
export function calculateVideoOperationSize(_op: any): number {
  return 0;
}
export function calculateVideoOperationTime(_op: any): number {
  return 0;
}
export function changesToMetadata(_changes: any): any {
  return {};
}
export function checkDatabase(_ctx: any): any {
  return { status: 'pass' };
}
export function checkIpodStructure(_ctx: any): any {
  return { status: 'pass' };
}
export function checkSysInfo(_ctx: any): any {
  return { status: 'pass' };
}
export function classifierFromConfig(_config: any): any {
  return new MusicTrackClassifier();
}
export function deduplicatePath(path: string): string {
  return path;
}
export function extractNormalization(_metadata: any): any {
  return undefined;
}
export function generateTrackPath(_track: any, _opts?: any): string {
  return '';
}
export function getDeviceCapabilities(_device: any): any {
  return {};
}
export function isAudioExtension(ext: string): boolean {
  return ['.mp3', '.m4a', '.flac', '.ogg', '.opus', '.wav', '.aiff', '.aac', '.alac'].includes(
    ext.toLowerCase()
  );
}
export function isDeviceCompatible(_track: any, _device: any): boolean {
  return true;
}
export function isValidTransferMode(mode: string): boolean {
  return (TRANSFER_MODES as readonly string[]).includes(mode);
}
export function normalizationToDb(_norm: any): number {
  return 0;
}
export function normalizationToSoundcheck(_norm: any): number {
  return 1000;
}
export function normalizeContentDir(dir: string): string {
  let result = dir.replace(/^\/+|\/+$/g, '');
  if (result === '.') result = '';
  return result;
}
export function padTrackNumber(num: number, total?: number): string {
  const width = total ? String(total).length : 2;
  return String(num).padStart(width, '0');
}
export function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_');
}
export function soundcheckToReplayGainDb(_sc: number): number {
  return 0;
}
