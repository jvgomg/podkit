/**
 * Implementation of the IpodTrack interface.
 *
 * IpodTrackImpl wraps a libgpod-node TrackHandle and provides fluent methods
 * for track operations. All operations are delegated to the parent IpodDatabase.
 */

import type { TrackHandle, Track } from '@podkit/libgpod-node';
import type { IpodTrack, TrackFields, RemoveTrackResult } from './types.js';
import type { SyncTagData } from '../metadata/sync-tags.js';
import type { AudioNormalization } from '../metadata/normalization.js';
import { soundcheckToReplayGainDb } from '../metadata/normalization.js';
import { parseSyncTag } from '../metadata/sync-tags.js';
import { IpodError } from './errors.js';

/**
 * Internal interface for IpodDatabase operations.
 *
 * This interface defines the methods that IpodTrackImpl needs to delegate
 * operations to. It avoids circular dependencies by not importing the
 * full IpodDatabase class.
 */
export interface IpodDatabaseInternal {
  /**
   * Updates track metadata.
   *
   * @param track - The track to update
   * @param fields - Fields to update
   * @returns A new IpodTrack snapshot with updated values
   */
  updateTrack(track: IpodTrack, fields: TrackFields): IpodTrack;

  /**
   * Removes a track from the database.
   *
   * @param track - The track to remove
   * @param options - Optional settings for the removal
   * @returns Result indicating success and any file deletion errors
   */
  removeTrack(track: IpodTrack, options?: { deleteFile?: boolean }): RemoveTrackResult;

  /**
   * Copies an audio file to the iPod for a track.
   *
   * @param track - The track to copy the file for
   * @param sourcePath - Path to the source audio file
   * @returns A new IpodTrack snapshot with hasFile: true
   */
  copyFileToTrack(track: IpodTrack, sourcePath: string): IpodTrack;

  /**
   * Sets artwork for a track from an image file.
   *
   * @param track - The track to set artwork for
   * @param imagePath - Path to the image file
   * @returns A new IpodTrack snapshot with hasArtwork: true
   */
  setTrackArtwork(track: IpodTrack, imagePath: string): IpodTrack;

  /**
   * Sets artwork for a track from image data.
   *
   * @param track - The track to set artwork for
   * @param imageData - Buffer containing image data
   * @returns A new IpodTrack snapshot with hasArtwork: true
   */
  setTrackArtworkFromData(track: IpodTrack, imageData: Buffer): IpodTrack;

  /**
   * Removes artwork from a track.
   *
   * @param track - The track to remove artwork from
   * @returns A new IpodTrack snapshot with hasArtwork: false
   */
  removeTrackArtwork(track: IpodTrack): IpodTrack;
}

/**
 * Implementation of the IpodTrack interface.
 *
 * This class wraps a libgpod-node TrackHandle and provides:
 * - Read-only snapshot properties from the Track data
 * - Fluent methods that delegate to the parent IpodDatabase
 * - Removed state tracking to prevent operations on deleted tracks
 *
 * @example
 * ```typescript
 * // Track instances are created by IpodDatabase, not directly
 * const track = ipod.addTrack({ title: 'Song', artist: 'Artist' });
 *
 * // Read properties
 * console.log(`${track.artist} - ${track.title}`);
 *
 * // Chain operations (each returns a new snapshot)
 * track.copyFile('/path/to/song.mp3')
 *      .setArtwork('/path/to/cover.jpg');
 *
 * // Remove track
 * track.remove();
 * // track.update({ title: 'New' }); // Throws IpodError('TRACK_REMOVED')
 * ```
 */
export class IpodTrackImpl implements IpodTrack {
  // Internal state
  private readonly _db: IpodDatabaseInternal;
  private readonly _handle: TrackHandle;
  private _removed: boolean = false;

  // Read-only properties from Track snapshot
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly albumArtist?: string;
  readonly genre?: string;
  readonly composer?: string;
  readonly comment?: string;
  readonly grouping?: string;
  readonly trackNumber?: number;
  readonly totalTracks?: number;
  readonly discNumber?: number;
  readonly totalDiscs?: number;
  readonly year?: number;
  readonly duration: number;
  readonly bitrate: number;
  readonly sampleRate: number;
  readonly size: number;
  readonly bpm?: number;
  readonly soundcheck?: number;
  readonly filetype?: string;

  get normalization(): AudioNormalization | undefined {
    if (this.soundcheck === undefined || this.soundcheck === 0) return undefined;
    return {
      source: 'itunes-soundcheck',
      soundcheckValue: this.soundcheck,
      trackGain: soundcheckToReplayGainDb(this.soundcheck),
    };
  }
  readonly mediaType: number;
  readonly filePath: string;
  readonly timeAdded: number;
  readonly timeModified: number;
  readonly timePlayed: number;
  readonly timeReleased: number;
  readonly playCount: number;
  readonly skipCount: number;
  readonly rating: number;
  readonly hasArtwork: boolean;
  readonly hasFile: boolean;
  readonly compilation: boolean;

  // Sync tag (parsed from comment)
  readonly syncTag: SyncTagData | null;

  // Video-specific fields
  readonly tvShow?: string;
  readonly tvEpisode?: string;
  readonly sortTvShow?: string;
  readonly seasonNumber?: number;
  readonly episodeNumber?: number;
  readonly movieFlag?: boolean;

  /**
   * Creates a new IpodTrackImpl instance.
   *
   * @param db - The parent database instance (for delegating operations)
   * @param handle - The libgpod-node TrackHandle
   * @param data - The Track snapshot data
   */
  constructor(db: IpodDatabaseInternal, handle: TrackHandle, data: Track) {
    this._db = db;
    this._handle = handle;

    // Copy all fields from Track to read-only properties with appropriate defaults
    this.title = data.title ?? '';
    this.artist = data.artist ?? '';
    this.album = data.album ?? '';
    this.albumArtist = data.albumArtist ?? undefined;
    this.genre = data.genre ?? undefined;
    this.composer = data.composer ?? undefined;
    this.comment = data.comment ?? undefined;
    this.grouping = data.grouping ?? undefined;

    // Track/disc info (0 values become undefined for optional fields)
    this.trackNumber = data.trackNumber || undefined;
    this.totalTracks = data.totalTracks || undefined;
    this.discNumber = data.discNumber || undefined;
    this.totalDiscs = data.totalDiscs || undefined;
    this.year = data.year || undefined;

    // Technical info (required fields get defaults)
    this.duration = data.duration ?? 0;
    this.bitrate = data.bitrate ?? 0;
    this.sampleRate = data.sampleRate ?? 0;
    this.size = data.size ?? 0;
    this.bpm = data.bpm || undefined;
    this.soundcheck = data.soundcheck ?? undefined;
    this.filetype = data.filetype ?? undefined;
    this.mediaType = data.mediaType ?? 0;

    // File path (use ipodPath from Track)
    this.filePath = data.ipodPath ?? '';

    // Timestamps
    this.timeAdded = data.timeAdded ?? 0;
    this.timeModified = data.timeModified ?? 0;
    this.timePlayed = data.timePlayed ?? 0;
    this.timeReleased = data.timeReleased ?? 0;

    // Play statistics
    this.playCount = data.playCount ?? 0;
    this.skipCount = data.skipCount ?? 0;
    this.rating = data.rating ?? 0;

    // Flags
    this.hasArtwork = data.hasArtwork ?? false;
    this.hasFile = data.transferred ?? false;
    this.compilation = data.compilation ?? false;

    // Sync tag (parsed from comment field)
    this.syncTag = parseSyncTag(this.comment);

    // Video-specific fields
    this.tvShow = data.tvShow ?? undefined;
    this.tvEpisode = data.tvEpisode ?? undefined;
    this.sortTvShow = data.sortTvShow ?? undefined;
    this.seasonNumber = data.seasonNumber ?? undefined;
    this.episodeNumber = data.episodeNumber ?? undefined;
    this.movieFlag = data.movieFlag ?? undefined;
  }

  /**
   * Asserts that the track has not been removed.
   *
   * @throws {IpodError} If the track has been removed (code: TRACK_REMOVED)
   */
  private assertNotRemoved(): void {
    if (this._removed) {
      throw new IpodError('Track has been removed', 'TRACK_REMOVED');
    }
  }

  /**
   * Gets the internal TrackHandle.
   *
   * This is used by IpodDatabase to access the underlying libgpod handle.
   * Should not be used by external code.
   */
  get _internalHandle(): TrackHandle {
    return this._handle;
  }

  /**
   * Marks the track as removed.
   *
   * Called by IpodDatabase.removeTrack() to prevent subsequent operations.
   * Should not be called by external code.
   */
  _markRemoved(): void {
    this._removed = true;
  }

  /**
   * Updates track metadata.
   *
   * @param fields - Fields to update
   * @returns A new IpodTrack snapshot with updated values
   * @throws {IpodError} If the track has been removed (code: TRACK_REMOVED)
   */
  update(fields: TrackFields): IpodTrack {
    this.assertNotRemoved();
    return this._db.updateTrack(this, fields);
  }

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
  remove(options?: { keepFile?: boolean }): void {
    this.assertNotRemoved();
    this._db.removeTrack(this, { deleteFile: !options?.keepFile });
  }

  /**
   * Copies an audio file to the iPod for this track.
   *
   * @param sourcePath - Path to the source audio file
   * @returns A new IpodTrack snapshot with hasFile: true
   * @throws {IpodError} If the track has been removed (code: TRACK_REMOVED)
   * @throws {IpodError} If the source file is not found (code: FILE_NOT_FOUND)
   * @throws {IpodError} If the copy operation fails (code: COPY_FAILED)
   */
  copyFile(sourcePath: string): IpodTrack {
    this.assertNotRemoved();
    return this._db.copyFileToTrack(this, sourcePath);
  }

  /**
   * Sets artwork for the track from an image file.
   *
   * @param imagePath - Path to the image file (JPEG or PNG)
   * @returns A new IpodTrack snapshot with hasArtwork: true
   * @throws {IpodError} If the track has been removed (code: TRACK_REMOVED)
   * @throws {IpodError} If artwork operation fails (code: ARTWORK_FAILED)
   */
  setArtwork(imagePath: string): IpodTrack {
    this.assertNotRemoved();
    return this._db.setTrackArtwork(this, imagePath);
  }

  /**
   * Sets artwork for the track from image data.
   *
   * @param imageData - Buffer containing image data (JPEG or PNG)
   * @returns A new IpodTrack snapshot with hasArtwork: true
   * @throws {IpodError} If the track has been removed (code: TRACK_REMOVED)
   * @throws {IpodError} If artwork operation fails (code: ARTWORK_FAILED)
   */
  setArtworkFromData(imageData: Buffer): IpodTrack {
    this.assertNotRemoved();
    return this._db.setTrackArtworkFromData(this, imageData);
  }

  /**
   * Removes artwork from the track.
   *
   * @returns A new IpodTrack snapshot with hasArtwork: false
   * @throws {IpodError} If the track has been removed (code: TRACK_REMOVED)
   * @throws {IpodError} If artwork operation fails (code: ARTWORK_FAILED)
   */
  removeArtwork(): IpodTrack {
    this.assertNotRemoved();
    return this._db.removeTrackArtwork(this);
  }
}
