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
  DEMO_SYNC_STATS,
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
  AdapterConfig,
  DirectoryAdapterConfig as AdapterDirectoryConfig,
  SubsonicAdapterConfig as AdapterSubsonicConfig,
} from '@podkit/core';

export type { DirectoryAdapterConfig, ScanProgress, ScanWarning } from '@podkit/core';

export type { SubsonicAdapterConfig } from '@podkit/core';

// Sync types
export type {
  MatchedTrack,
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
  UpdateReason,
  MetadataChange,
  UpdateTrack,
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
  ExecutionWarning,
  ExecutionWarningType,
} from '@podkit/core';

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
  AacQualityPreset,
  TranscodeConfig,
  AacPreset,
  FFmpegTranscoderConfig,
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

// Metadata types
export type { FileDisplayMetadata } from '@podkit/core';

// iPod types
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

// Transform types
export type {
  TransformableTrack,
  TransformResult,
  TrackTransform,
  CleanArtistsConfig,
  TransformsConfig,
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
  IPodVideo,
  MatchedVideo,
  VideoSyncDiff,
  VideoDiffOptions,
  VideoSyncDiffer,
  VideoSyncPlanOptions,
  VideoSyncPlan,
  VideoSyncWarning,
  VideoSyncWarningType,
  VideoPlanSummary,
  VideoSyncPlanner,
  VideoExecutorProgress,
  VideoExecuteOptions,
  VideoExecuteResult,
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
} from '@podkit/core';

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
// Mock IPodTrack implementation
// =============================================================================

function createMockIPodTrack(data: Record<string, unknown>): any {
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
      return createMockIPodTrack({ ...data, ..._fields });
    },
    remove() {},
    copyFile(_path: string) {
      return createMockIPodTrack({ ...data, hasFile: true });
    },
    setArtwork(_path: string) {
      return createMockIPodTrack({ ...data, hasArtwork: true });
    },
    setArtworkFromData(_buf: Buffer) {
      return createMockIPodTrack({ ...data, hasArtwork: true });
    },
    removeArtwork() {
      return createMockIPodTrack({ ...data, hasArtwork: false });
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
      tracks.push(...getDemoIpodTracks().map((t) => createMockIPodTrack(t)));
    }
    if (state.videoSynced) {
      tracks.push(...getDemoIpodVideoTracks().map((t) => createMockIPodTrack(t)));
    }
    return tracks;
  }

  addTrack(input: Record<string, unknown>): any {
    return createMockIPodTrack(input);
  }

  updateTrack(track: any, fields: Record<string, unknown>): any {
    return createMockIPodTrack({ ...track, ...fields });
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
    return createMockIPodTrack({ ...track, hasFile: true });
  }

  setTrackArtwork(track: any, _imagePath: string): any {
    return createMockIPodTrack({ ...track, hasArtwork: true });
  }

  setTrackArtworkFromData(track: any, _imageData: Buffer): any {
    return createMockIPodTrack({ ...track, hasArtwork: true });
  }

  removeTrackArtwork(track: any): any {
    return createMockIPodTrack({ ...track, hasArtwork: false });
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

  async getTracks() {
    return getDemoCollectionTracks();
  }

  async getFilteredTracks(_filter: any) {
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
  async getTracks() {
    return getDemoCollectionTracks();
  }
  async getFilteredTracks(_filter: any) {
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

  async getVideos() {
    return getDemoCollectionVideos();
  }

  async getFilteredVideos(_filter: any) {
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

export function computeDiff(collectionTracks: any[], ipodTracks: any[], _options?: any) {
  // If iPod is empty, all tracks are to-add
  if (ipodTracks.length === 0) {
    return {
      toAdd: collectionTracks,
      toRemove: [],
      existing: [],
      toUpdate: [],
    };
  }
  // After sync, everything is existing
  return {
    toAdd: [],
    toRemove: [],
    existing: collectionTracks.map((ct: any, i: number) => ({
      collection: ct,
      ipod: ipodTracks[i],
    })),
    toUpdate: [],
  };
}

export class DefaultSyncDiffer {
  diff(collectionTracks: any[], ipodTracks: any[], options?: any) {
    return computeDiff(collectionTracks, ipodTracks, options);
  }
}

export function createDiffer() {
  return new DefaultSyncDiffer();
}

// =============================================================================
// Planner (mock)
// =============================================================================

export function createPlan(diff: any, _options?: any) {
  const operations: any[] = [];

  for (const track of diff.toAdd || []) {
    operations.push({
      type: 'transcode',
      source: track,
      preset: { name: 'high' },
    });
  }

  const estimatedSize = DEMO_SYNC_STATS.music.estimatedSizeBytes;
  const estimatedTime = DEMO_SYNC_STATS.music.estimatedTimeSeconds;

  return {
    operations,
    estimatedTime,
    estimatedSize,
    warnings: [],
  };
}

export class DefaultSyncPlanner {
  plan(diff: any, options?: any) {
    return createPlan(diff, options);
  }
}

export function createPlanner() {
  return new DefaultSyncPlanner();
}

export function isIPodCompatible(_fileType: string): boolean {
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

export function calculateOperationSize(operation: any): number {
  if (operation.type === 'transcode') {
    const duration = operation.source?.duration ?? 240000;
    return estimateTranscodedSize(duration, 256);
  }
  if (operation.type === 'copy') {
    return estimateCopySize(operation.source);
  }
  return 0;
}

export function willFitInSpace(_plan: any, _availableSpace: number): boolean {
  return true;
}

export function getPlanSummary(plan: any) {
  let transcodeCount = 0;
  let copyCount = 0;
  let removeCount = 0;
  let updateCount = 0;
  let upgradeCount = 0;
  for (const op of plan.operations || []) {
    if (op.type === 'transcode') transcodeCount++;
    else if (op.type === 'copy') copyCount++;
    else if (op.type === 'remove') removeCount++;
    else if (op.type === 'update-metadata') updateCount++;
    else if (op.type === 'upgrade') upgradeCount++;
  }
  return { transcodeCount, copyCount, removeCount, updateCount, upgradeCount };
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

export class DefaultSyncExecutor {
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
        op.type === 'transcode' || op.type === 'copy'
          ? `${op.source.artist} - ${op.source.title}`
          : op.type === 'remove'
            ? `${op.track.artist} - ${op.track.title}`
            : 'Unknown';

      const opSize = calculateOperationSize(op);

      // Emit transcoding/copying progress
      const phase =
        op.type === 'transcode' ? 'transcoding' : op.type === 'copy' ? 'copying' : 'removing';

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
      const artworkOps = ops.filter((op: any) => op.type === 'transcode' || op.type === 'copy');
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

export function createExecutor(deps: any) {
  return new DefaultSyncExecutor(deps);
}

export async function executePlan(plan: any, deps: any, options: any = {}) {
  const executor = new DefaultSyncExecutor(deps);
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

export function getOperationDisplayName(operation: any): string {
  switch (operation.type) {
    case 'transcode':
    case 'copy':
      return `${operation.source.artist} - ${operation.source.title}`;
    case 'remove':
      return `${operation.track.artist} - ${operation.track.title}`;
    case 'update-metadata':
      return `${operation.track.artist} - ${operation.track.title}`;
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
  if (operationType === 'transcode') return 'transcode';
  if (operationType === 'copy') return 'copy';
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
    trackName: getOperationDisplayName(operation),
    retryAttempts,
    wasRetried,
  };
}

export function getRetriesForCategory(category: string, _config: any): number {
  if (category === 'transcode' || category === 'copy') return 1;
  return 0;
}

export const DEFAULT_RETRY_CONFIG = {
  transcodeRetries: 1,
  copyRetries: 1,
  databaseRetries: 0,
  retryDelayMs: 1000,
};

// =============================================================================
// Video Differ (mock)
// =============================================================================

export function diffVideos(collectionVideos: any[], ipodVideos: any[], _options?: any) {
  if (ipodVideos.length === 0) {
    return {
      toAdd: collectionVideos,
      toRemove: [],
      existing: [],
    };
  }
  return {
    toAdd: [],
    toRemove: [],
    existing: collectionVideos.map((cv: any, i: number) => ({
      collection: cv,
      ipod: ipodVideos[i],
    })),
  };
}

export function generateVideoMatchKey(video: any): string {
  if (video.contentType === 'movie') {
    return `movie:${video.title.toLowerCase()}:${video.year || ''}`;
  }
  return `tvshow:${(video.seriesTitle || video.title).toLowerCase()}`;
}

export class DefaultVideoSyncDiffer {
  diff(collectionVideos: any[], ipodVideos: any[], options?: any) {
    return diffVideos(collectionVideos, ipodVideos, options);
  }
}

export function createVideoDiffer() {
  return new DefaultVideoSyncDiffer();
}

// =============================================================================
// Video Planner (mock)
// =============================================================================

export function planVideoSync(diff: any, _options?: any) {
  const operations: any[] = [];
  for (const video of diff.toAdd || []) {
    // M4V with H.264 can be copied directly
    operations.push({
      type: 'video-copy',
      source: video,
    });
  }

  return {
    operations,
    estimatedTime: DEMO_SYNC_STATS.video.estimatedTimeSeconds,
    estimatedSize: DEMO_SYNC_STATS.video.estimatedSizeBytes,
    warnings: [],
  };
}

export function willVideoPlanFit(_plan: any, _availableSpace: number): boolean {
  return true;
}

export function getVideoPlanSummary(plan: any) {
  let transcodeCount = 0;
  let copyCount = 0;
  let removeCount = 0;
  for (const op of plan.operations || []) {
    if (op.type === 'video-transcode') transcodeCount++;
    else if (op.type === 'video-copy') copyCount++;
    else if (op.type === 'video-remove') removeCount++;
  }
  return { transcodeCount, copyCount, removeCount, skippedCount: 0 };
}

export class DefaultVideoSyncPlanner {
  plan(diff: any, options?: any) {
    return planVideoSync(diff, options);
  }
}

export function createVideoPlanner() {
  return new DefaultVideoSyncPlanner();
}

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

export class DefaultVideoSyncExecutor {
  private _ipod: any;

  constructor(deps: any) {
    this._ipod = deps?.ipod;
  }

  async *execute(plan: any, options: any = {}): AsyncIterable<any> {
    const ops = plan.operations || [];
    const total = ops.length;
    const bytesTotal = plan.estimatedSize || 0;
    let bytesProcessed = 0;

    for (let i = 0; i < total; i++) {
      const op = ops[i];
      const phase =
        op.type === 'video-transcode'
          ? 'video-transcoding'
          : op.type === 'video-copy'
            ? 'video-copying'
            : 'removing';

      const displayName = getVideoOperationDisplayName(op);
      const opSize = op.type === 'video-copy' ? estimatePassthroughSize(op.source) : 0;

      yield {
        phase,
        operation: op,
        index: i,
        current: i,
        total,
        currentTrack: displayName,
        bytesProcessed,
        bytesTotal,
        skipped: options.dryRun || false,
      };

      if (!options.dryRun) {
        await delay(100);
      }

      bytesProcessed += opSize;
    }

    if (!options.dryRun && total > 0) {
      updateState({ videoSynced: true });
    }

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

export function createVideoExecutor(deps?: any) {
  if (deps?.ipod) {
    return new DefaultVideoSyncExecutor(deps);
  }
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

export const QUALITY_PRESETS = [
  'lossless',
  'max',
  'max-cbr',
  'high',
  'high-cbr',
  'medium',
  'medium-cbr',
  'low',
  'low-cbr',
] as const;

export const AAC_QUALITY_PRESETS = [
  'max',
  'max-cbr',
  'high',
  'high-cbr',
  'medium',
  'medium-cbr',
  'low',
  'low-cbr',
] as const;

export const AAC_PRESETS = {
  max: { mode: 'vbr', quality: 5, targetKbps: 320 },
  high: { mode: 'vbr', quality: 5, targetKbps: 256 },
  medium: { mode: 'vbr', quality: 4, targetKbps: 192 },
  low: { mode: 'vbr', quality: 2, targetKbps: 128 },
  'max-cbr': { mode: 'cbr', targetKbps: 320 },
  'high-cbr': { mode: 'cbr', targetKbps: 256 },
  'medium-cbr': { mode: 'cbr', targetKbps: 192 },
  'low-cbr': { mode: 'cbr', targetKbps: 128 },
} as const;

export const ALAC_PRESET = {
  codec: 'alac' as const,
  container: 'm4a' as const,
  estimatedKbps: 900,
} as const;

export function isValidQualityPreset(value: string): boolean {
  return QUALITY_PRESETS.includes(value as any);
}

export function isValidAacPreset(value: string): boolean {
  return AAC_QUALITY_PRESETS.includes(value as any);
}

export function getPresetBitrate(preset: string): number {
  if (preset === 'lossless') return 900;
  return (AAC_PRESETS as any)[preset]?.targetKbps ?? 256;
}

export function isLosslessPreset(preset: string): boolean {
  return preset === 'lossless';
}

export function isVbrPreset(preset: string): boolean {
  if (preset === 'lossless') return false;
  return (AAC_PRESETS as any)[preset]?.mode === 'vbr';
}

export function resolveLossyQuality(config: any) {
  if (config.lossyQuality) return config.lossyQuality;
  return config.quality === 'lossless' ? 'max' : config.quality;
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
// Stream utilities (mock)
// =============================================================================

export async function streamToTempFile(_getStream: any, _size?: number): Promise<string> {
  return '/tmp/podkit-demo/temp-stream';
}

export function cleanupTempFile(_path: string) {}
