/**
 * Type definitions for the iPod database abstraction layer.
 *
 * These types provide a clean interface for iPod operations without
 * exposing libgpod-node internals like TrackHandle.
 */

import type { SyncTagData } from '../metadata/sync-tags.js';
import type { DeviceTrack } from '../device/adapter.js';

/**
 * Input for creating a new track.
 *
 * Only `title` is required; other fields are optional and will use
 * appropriate defaults if not provided.
 *
 * @example
 * ```typescript
 * const input: TrackInput = {
 *   title: 'Song Title',
 *   artist: 'Artist Name',
 *   album: 'Album Name',
 *   trackNumber: 1,
 *   totalTracks: 12,
 * };
 *
 * const track = ipod.addTrack(input);
 * ```
 */
export interface TrackInput {
  /** Track title (required) */
  title: string;

  // Core metadata
  /** Artist name */
  artist?: string;
  /** Album name */
  album?: string;
  /** Album artist (for compilations or albums with multiple artists) */
  albumArtist?: string;
  /** Genre */
  genre?: string;
  /** Composer */
  composer?: string;
  /** Comment field */
  comment?: string;
  /** Grouping (for organizing tracks) */
  grouping?: string;

  // Track/disc info
  /** Track number on disc */
  trackNumber?: number;
  /** Total number of tracks on disc */
  totalTracks?: number;
  /** Disc number in a multi-disc set */
  discNumber?: number;
  /** Total number of discs in the set */
  totalDiscs?: number;
  /** Release year */
  year?: number;

  // Technical info (from source file)
  /** Duration in milliseconds */
  duration?: number;
  /** Bitrate in kbps */
  bitrate?: number;
  /** Sample rate in Hz */
  sampleRate?: number;
  /** File size in bytes */
  size?: number;
  /** Beats per minute */
  bpm?: number;
  /** Sound Check volume normalization value */
  soundcheck?: number;
  /** File type description (e.g., "MPEG audio file", "AAC audio file") */
  filetype?: string;
  /** Media type flags (use MediaType constants) */
  mediaType?: number;

  // Flags
  /** Whether the track is part of a compilation album */
  compilation?: boolean;

  // Play stats (for sync/restore scenarios)
  /** Rating from 0-100, where 20 = 1 star, 40 = 2 stars, etc. */
  rating?: number;
  /** Number of times the track has been played */
  playCount?: number;
  /** Number of times the track has been skipped */
  skipCount?: number;

  // Video-specific fields
  /** TV show name (for TV show episodes) */
  tvShow?: string;
  /** Episode name/title (for TV show episodes, as a string) */
  tvEpisode?: string;
  /** TV show name for sorting (optional, defaults to tvShow) */
  sortTvShow?: string;
  /** Season number (1-99) */
  seasonNumber?: number;
  /** Episode number (1-999) */
  episodeNumber?: number;
  /** Whether this track is a movie */
  movieFlag?: boolean;
}

/**
 * Fields that can be updated on an existing track.
 *
 * Similar to TrackInput but all fields are optional. Only include
 * fields you want to change.
 *
 * @example
 * ```typescript
 * // Update just the rating
 * track.update({ rating: 80 });
 *
 * // Update multiple fields
 * track.update({
 *   title: 'New Title',
 *   artist: 'New Artist',
 * });
 * ```
 */
export interface TrackFields {
  /** Track title */
  title?: string;
  /** Artist name */
  artist?: string;
  /** Album name */
  album?: string;
  /** Album artist */
  albumArtist?: string;
  /** Genre */
  genre?: string;
  /** Composer */
  composer?: string;
  /** Comment field */
  comment?: string;
  /** Grouping */
  grouping?: string;
  /** Track number on disc */
  trackNumber?: number;
  /** Total number of tracks on disc */
  totalTracks?: number;
  /** Disc number */
  discNumber?: number;
  /** Total number of discs */
  totalDiscs?: number;
  /** Release year */
  year?: number;
  /** Duration in milliseconds */
  duration?: number;
  /** Bitrate in kbps */
  bitrate?: number;
  /** Sample rate in Hz */
  sampleRate?: number;
  /** File size in bytes */
  size?: number;
  /** Beats per minute */
  bpm?: number;
  /** Sound Check volume normalization value */
  soundcheck?: number;
  /** File type description (e.g., "MPEG audio file", "AAC audio file") */
  filetype?: string;
  /** Media type flags */
  mediaType?: number;
  /** Whether the track is part of a compilation */
  compilation?: boolean;
  /** Rating from 0-100 */
  rating?: number;
  /** Play count */
  playCount?: number;
  /** Skip count */
  skipCount?: number;

  // Video-specific fields
  /** TV show name (for TV show episodes) */
  tvShow?: string;
  /** Episode name/title (for TV show episodes, as a string) */
  tvEpisode?: string;
  /** TV show name for sorting (optional, defaults to tvShow) */
  sortTvShow?: string;
  /** Season number (1-99) */
  seasonNumber?: number;
  /** Episode number (1-999) */
  episodeNumber?: number;
  /** Whether this track is a movie */
  movieFlag?: boolean;
}

/**
 * Represents a track on the iPod.
 *
 * Track objects are **snapshots** of track metadata at the time they were
 * retrieved. They also serve as references for operations - the object
 * itself identifies which track to operate on.
 *
 * Operations that modify the track (like `update()` or `copyFile()`) return
 * a new IpodTrack snapshot reflecting the changes.
 *
 * @example
 * ```typescript
 * // Get all tracks
 * const tracks = ipod.getTracks();
 *
 * // Display track info
 * for (const track of tracks) {
 *   console.log(`${track.artist} - ${track.title}`);
 * }
 *
 * // Update a track (returns new snapshot)
 * const updated = track.update({ rating: 100 });
 *
 * // Chain operations
 * ipod.addTrack({ title: 'Song', artist: 'Artist' })
 *     .copyFile('/path/to/song.mp3')
 *     .setArtwork('/path/to/cover.jpg');
 * ```
 */
export interface IpodTrack extends DeviceTrack {
  // Core metadata (read-only snapshot)
  /** Track title */
  readonly title: string;
  /** Artist name */
  readonly artist: string;
  /** Album name */
  readonly album: string;
  /** Album artist */
  readonly albumArtist?: string;
  /** Genre */
  readonly genre?: string;
  /** Composer */
  readonly composer?: string;
  /** Comment field */
  readonly comment?: string;
  /** Grouping */
  readonly grouping?: string;

  // Track/disc info
  /** Track number on disc */
  readonly trackNumber?: number;
  /** Total number of tracks on disc */
  readonly totalTracks?: number;
  /** Disc number */
  readonly discNumber?: number;
  /** Total number of discs */
  readonly totalDiscs?: number;
  /** Release year */
  readonly year?: number;

  // Technical info
  /** Duration in milliseconds */
  readonly duration: number;
  /** Bitrate in kbps */
  readonly bitrate: number;
  /** Sample rate in Hz */
  readonly sampleRate: number;
  /** File size in bytes */
  readonly size: number;
  /** Beats per minute */
  readonly bpm?: number;
  /** Sound Check volume normalization value */
  readonly soundcheck?: number;
  /** File type description (e.g., "MPEG audio file", "AAC audio file") */
  readonly filetype?: string;
  /** Media type flags */
  readonly mediaType: number;

  // File path on iPod
  /** Path to the audio file on iPod (colon-separated, e.g., ":iPod_Control:Music:F00:ABCD.mp3") */
  readonly filePath: string;

  // Timestamps (Unix seconds)
  /** Time the track was added to the library */
  readonly timeAdded: number;
  /** Time the track metadata was last modified */
  readonly timeModified: number;
  /** Time the track was last played */
  readonly timePlayed: number;
  /** Release time (used for podcasts) */
  readonly timeReleased: number;

  // Play statistics
  /** Number of times the track has been played */
  readonly playCount: number;
  /** Number of times the track has been skipped */
  readonly skipCount: number;
  /** Rating from 0-100, where 20 = 1 star, 40 = 2 stars, etc. */
  readonly rating: number;

  // Flags
  /** Whether the track has artwork */
  readonly hasArtwork: boolean;
  /** Whether the audio file has been copied to the iPod */
  readonly hasFile: boolean;
  /** Whether the track is part of a compilation album */
  readonly compilation: boolean;

  // Sync tag (parsed from comment field)
  /** Parsed sync tag data, or null if no sync tag is present */
  readonly syncTag: SyncTagData | null;

  // Video-specific fields
  /** TV show name (for TV show episodes) */
  readonly tvShow?: string;
  /** Episode name/title (for TV show episodes, as a string) */
  readonly tvEpisode?: string;
  /** TV show name for sorting */
  readonly sortTvShow?: string;
  /** Season number (0 if not set) */
  readonly seasonNumber?: number;
  /** Episode number (0 if not set) */
  readonly episodeNumber?: number;
  /** Whether this track is a movie */
  readonly movieFlag?: boolean;

  // Operations

  /**
   * Updates track metadata.
   *
   * @param fields - Fields to update
   * @returns A new IpodTrack snapshot with updated values
   * @throws {IpodError} If the track has been removed (code: TRACK_REMOVED)
   */
  update(fields: TrackFields): IpodTrack;

  /**
   * Removes the track from the iPod database and deletes its file from disk.
   *
   * After calling this method, subsequent operations on this track
   * object will throw an IpodError.
   *
   * @param options - Optional settings
   * @param options.keepFile - If true, keep the audio file on disk (default: false)
   * @throws {IpodError} If the track has already been removed (code: TRACK_REMOVED)
   */
  remove(options?: { keepFile?: boolean }): void;

  /**
   * Copies an audio file to the iPod for this track.
   *
   * @param sourcePath - Path to the source audio file
   * @returns A new IpodTrack snapshot with hasFile: true
   * @throws {IpodError} If the source file is not found (code: FILE_NOT_FOUND)
   * @throws {IpodError} If the copy operation fails (code: COPY_FAILED)
   */
  copyFile(sourcePath: string): IpodTrack;

  /**
   * Sets artwork for the track from an image file.
   *
   * @param imagePath - Path to the image file (JPEG or PNG)
   * @returns A new IpodTrack snapshot with hasArtwork: true
   * @throws {IpodError} If artwork operation fails (code: ARTWORK_FAILED)
   */
  setArtwork(imagePath: string): IpodTrack;

  /**
   * Sets artwork for the track from image data.
   *
   * @param imageData - Buffer containing image data (JPEG or PNG)
   * @returns A new IpodTrack snapshot with hasArtwork: true
   * @throws {IpodError} If artwork operation fails (code: ARTWORK_FAILED)
   */
  setArtworkFromData(imageData: Buffer): IpodTrack;

  /**
   * Removes artwork from the track.
   *
   * @returns A new IpodTrack snapshot with hasArtwork: false
   * @throws {IpodError} If artwork operation fails (code: ARTWORK_FAILED)
   */
  removeArtwork(): IpodTrack;
}

/**
 * Represents a playlist on the iPod.
 *
 * Playlist objects are **snapshots** of playlist data at the time they were
 * retrieved. Operations that modify the playlist return a new IpodPlaylist
 * snapshot reflecting the changes.
 *
 * @example
 * ```typescript
 * // Create a playlist and add tracks
 * const playlist = ipod.createPlaylist('Favorites');
 *
 * for (const track of ipod.getTracks()) {
 *   if (track.rating >= 80) {
 *     playlist.addTrack(track);
 *   }
 * }
 *
 * // Chain operations
 * ipod.createPlaylist('Road Trip')
 *     .addTrack(track1)
 *     .addTrack(track2)
 *     .addTrack(track3);
 * ```
 */
export interface IpodPlaylist {
  /** Playlist name */
  readonly name: string;
  /** Number of tracks in the playlist */
  readonly trackCount: number;
  /** Whether this is the master playlist (contains all tracks) */
  readonly isMaster: boolean;
  /** Whether this is a smart playlist (rules-based, read-only) */
  readonly isSmart: boolean;
  /** Whether this is the podcasts playlist */
  readonly isPodcasts: boolean;
  /** Creation timestamp (Unix seconds) */
  readonly timestamp: number;

  /**
   * Renames the playlist.
   *
   * @param newName - New name for the playlist
   * @returns A new IpodPlaylist snapshot with the updated name
   * @throws {IpodError} If the playlist is the master playlist or has been removed
   */
  rename(newName: string): IpodPlaylist;

  /**
   * Removes the playlist from the iPod.
   *
   * After calling this method, subsequent operations on this playlist
   * object will throw an IpodError.
   *
   * @throws {IpodError} If this is the master playlist (code: PLAYLIST_REMOVED)
   * @throws {IpodError} If the playlist has already been removed (code: PLAYLIST_REMOVED)
   */
  remove(): void;

  /**
   * Gets all tracks in this playlist.
   *
   * @returns Array of tracks in playlist order
   * @throws {IpodError} If the playlist has been removed (code: PLAYLIST_REMOVED)
   */
  getTracks(): IpodTrack[];

  /**
   * Adds a track to the playlist.
   *
   * @param track - Track to add
   * @returns A new IpodPlaylist snapshot with the track added
   * @throws {IpodError} If the playlist or track has been removed
   */
  addTrack(track: IpodTrack): IpodPlaylist;

  /**
   * Removes a track from the playlist.
   *
   * Note: This only removes the track from this playlist, not from the iPod.
   *
   * @param track - Track to remove
   * @returns A new IpodPlaylist snapshot with the track removed
   * @throws {IpodError} If the playlist has been removed (code: PLAYLIST_REMOVED)
   */
  removeTrack(track: IpodTrack): IpodPlaylist;

  /**
   * Checks if a track is in this playlist.
   *
   * @param track - Track to check
   * @returns true if the track is in the playlist
   * @throws {IpodError} If the playlist has been removed (code: PLAYLIST_REMOVED)
   */
  containsTrack(track: IpodTrack): boolean;
}

/**
 * Information about the iPod device.
 *
 * Provides details about the iPod model and its capabilities.
 */
export interface IpodDeviceInfo {
  /** Human-readable model name (e.g., "iPod Video (60GB)") */
  readonly modelName: string;
  /** Model number string (e.g., "MA147") or null if unknown */
  readonly modelNumber: string | null;
  /** Generation identifier (e.g., "video_1", "classic_1", "nano_3") */
  readonly generation: string;
  /** Storage capacity in GB */
  readonly capacity: number;
  /** Whether the device supports album artwork */
  readonly supportsArtwork: boolean;
  /** Whether the device supports video playback */
  readonly supportsVideo: boolean;
  /** Whether the device supports photo display */
  readonly supportsPhoto: boolean;
  /** Whether the device supports podcasts */
  readonly supportsPodcast: boolean;
}

/**
 * Information about the iPod database.
 *
 * Provides an overview of the iPod state including mount point,
 * content counts, and device information.
 *
 * @example
 * ```typescript
 * const info = ipod.getInfo();
 * console.log(`${info.device.modelName} (${info.device.capacity}GB)`);
 * console.log(`Mount: ${info.mountPoint}`);
 * console.log(`Tracks: ${info.trackCount}`);
 * console.log(`Playlists: ${info.playlistCount}`);
 * ```
 */
export interface IpodInfo {
  /** Mount point path (e.g., "/Volumes/IPOD") */
  readonly mountPoint: string;
  /** Number of tracks in the database */
  readonly trackCount: number;
  /** Number of playlists (including master and system playlists) */
  readonly playlistCount: number;
  /** Device information */
  readonly device: IpodDeviceInfo;
}

/**
 * Result from saving the iPod database.
 *
 * Contains any warnings generated during the save operation,
 * such as tracks without audio files.
 *
 * @example
 * ```typescript
 * const result = await ipod.save();
 * if (result.warnings.length > 0) {
 *   console.warn('Save warnings:');
 *   for (const warning of result.warnings) {
 *     console.warn(`  - ${warning}`);
 *   }
 * }
 * ```
 */
export interface SaveResult {
  /**
   * Warnings generated during save.
   *
   * Examples:
   * - "3 tracks have no audio file and won't be playable"
   * - "Failed to optimize database indexes"
   */
  readonly warnings: string[];
}

/**
 * Result from removing a track from the database.
 *
 * The track is always removed from the database. If file deletion was
 * requested but failed, the error is captured in `fileDeleteError`
 * rather than throwing.
 *
 * @example
 * ```typescript
 * const result = ipod.removeTrack(track, { deleteFile: true });
 * if (result.fileDeleteError) {
 *   console.warn(`Track removed but file deletion failed: ${result.fileDeleteError}`);
 * }
 * ```
 */
export interface RemoveTrackResult {
  /** Whether the track was removed from the database (always true on success) */
  readonly removed: boolean;
  /**
   * Error message if file deletion was requested but failed.
   * Undefined if file deletion was not requested or succeeded.
   */
  readonly fileDeleteError?: string;
}

/**
 * Result from removing all tracks from the database.
 *
 * @example
 * ```typescript
 * const result = ipod.removeAllTracks({ deleteFiles: true });
 * console.log(`Removed ${result.removedCount} tracks`);
 * if (result.fileDeleteErrors.length > 0) {
 *   console.warn(`${result.fileDeleteErrors.length} file(s) could not be deleted`);
 * }
 * ```
 */
export interface RemoveAllTracksResult {
  /** Number of tracks removed from the database */
  readonly removedCount: number;
  /**
   * Errors from file deletions that failed.
   * Each entry describes which file failed and why.
   */
  readonly fileDeleteErrors: string[];
}

/**
 * Result from removing tracks by content type from the database.
 *
 * @example
 * ```typescript
 * const result = ipod.removeTracksByContentType('video', { deleteFiles: true });
 * console.log(`Removed ${result.removedCount} video tracks`);
 * if (result.fileDeleteErrors.length > 0) {
 *   console.warn(`${result.fileDeleteErrors.length} file(s) could not be deleted`);
 * }
 * ```
 */
export interface RemoveTracksByContentTypeResult {
  /** Number of tracks removed from the database */
  readonly removedCount: number;
  /** Total number of tracks of this content type before removal */
  readonly totalCount: number;
  /**
   * Errors from file deletions that failed.
   * Each entry describes which file failed and why.
   */
  readonly fileDeleteErrors: string[];
}
