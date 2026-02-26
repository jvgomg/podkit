/**
 * Implementation of the IpodDatabase class.
 *
 * IpodDatabase provides a high-level API for interacting with iPod databases,
 * wrapping libgpod-node's Database class and providing clean interfaces for
 * track and playlist operations.
 */

import { Database, type TrackHandle, type Playlist } from '@podkit/libgpod-node';
import type {
  IPodTrack,
  IpodPlaylist,
  IpodDeviceInfo,
  IpodInfo,
  TrackInput,
  TrackFields,
  SaveResult,
} from './types.js';
import { IpodError } from './errors.js';
import { IpodTrackImpl, type IpodDatabaseInternal } from './track.js';
import { IpodPlaylistImpl, type PlaylistDatabaseInternal } from './playlist.js';
import * as fs from 'node:fs';

/**
 * Main interface for interacting with iPod databases.
 *
 * IpodDatabase wraps libgpod-node's Database and provides a clean API for
 * managing tracks and playlists without exposing internal details like
 * TrackHandle.
 *
 * @example
 * ```typescript
 * import { IpodDatabase } from '@podkit/core';
 *
 * // Open an iPod
 * const ipod = await IpodDatabase.open('/Volumes/IPOD');
 *
 * // Add a track
 * const track = ipod.addTrack({
 *   title: 'Song Title',
 *   artist: 'Artist Name',
 * });
 *
 * // Copy audio file and set artwork
 * track.copyFile('/path/to/song.mp3')
 *      .setArtwork('/path/to/cover.jpg');
 *
 * // Save changes
 * await ipod.save();
 * ipod.close();
 * ```
 */
export class IpodDatabase implements IpodDatabaseInternal, PlaylistDatabaseInternal {
  private db: Database;
  private _mountPoint: string;
  private trackHandles = new WeakMap<IPodTrack, TrackHandle>();
  private playlistIds = new WeakMap<IpodPlaylist, bigint>();
  private _closed = false;

  /**
   * Private constructor - use static open() method instead.
   */
  private constructor(db: Database, mountPoint: string) {
    this.db = db;
    this._mountPoint = mountPoint;
  }

  /**
   * Opens an iPod database from a mount point.
   *
   * @param mountPoint - Path to the iPod mount point (e.g., "/Volumes/IPOD")
   * @returns Promise resolving to an IpodDatabase instance
   * @throws {IpodError} If the iPod is not found (code: NOT_FOUND)
   * @throws {IpodError} If the database is corrupt (code: DATABASE_CORRUPT)
   *
   * @example
   * ```typescript
   * const ipod = await IpodDatabase.open('/Volumes/IPOD');
   * console.log(`Found ${ipod.trackCount} tracks`);
   * ipod.close();
   * ```
   */
  static async open(mountPoint: string): Promise<IpodDatabase> {
    // Check if mountpoint exists
    try {
      await fs.promises.access(mountPoint);
    } catch {
      throw new IpodError(`iPod not found at path: ${mountPoint}`, 'NOT_FOUND');
    }

    try {
      const db = await Database.open(mountPoint);
      return new IpodDatabase(db, mountPoint);
    } catch (error) {
      // Map libgpod errors to IpodError
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('corrupt') || message.includes('parse')) {
        throw new IpodError(`Database corrupt: ${message}`, 'DATABASE_CORRUPT');
      }
      throw new IpodError(`Failed to open database: ${message}`, 'DATABASE_CORRUPT');
    }
  }

  /**
   * Asserts that the database is open.
   *
   * @throws {IpodError} If the database has been closed (code: DATABASE_CLOSED)
   */
  private assertOpen(): void {
    if (this._closed) {
      throw new IpodError('Database is closed', 'DATABASE_CLOSED');
    }
  }

  /**
   * Gets the TrackHandle for an IPodTrack.
   *
   * @param track - The track to get the handle for
   * @returns The underlying TrackHandle
   * @throws {IpodError} If the track is not known to this database (code: TRACK_REMOVED)
   */
  private getTrackHandle(track: IPodTrack): TrackHandle {
    const handle = this.trackHandles.get(track);
    if (!handle) {
      throw new IpodError('Unknown track', 'TRACK_REMOVED');
    }
    return handle;
  }

  /**
   * Gets the playlist ID for an IpodPlaylist.
   *
   * @param playlist - The playlist to get the ID for
   * @returns The underlying playlist ID
   * @throws {IpodError} If the playlist is not known to this database (code: PLAYLIST_REMOVED)
   */
  private getPlaylistId(playlist: IpodPlaylist): bigint {
    const id = this.playlistIds.get(playlist);
    if (id === undefined) {
      throw new IpodError('Unknown playlist', 'PLAYLIST_REMOVED');
    }
    return id;
  }

  /**
   * Creates an IPodTrack from a TrackHandle.
   *
   * @param handle - The TrackHandle from libgpod-node
   * @returns A new IpodTrackImpl instance
   */
  private createTrackFromHandle(handle: TrackHandle): IPodTrack {
    const data = this.db.getTrack(handle);
    const track = new IpodTrackImpl(this, handle, data);
    this.trackHandles.set(track, handle);
    return track;
  }

  /**
   * Creates an IpodPlaylist from libgpod Playlist data.
   *
   * @param id - The playlist ID
   * @param data - The Playlist data from libgpod-node
   * @returns A new IpodPlaylistImpl instance
   */
  private createPlaylistFromData(id: bigint, data: Playlist): IpodPlaylist {
    const playlist = new IpodPlaylistImpl(this, id, data);
    this.playlistIds.set(playlist, id);
    return playlist;
  }

  // ============================================================================
  // Properties
  // ============================================================================

  /**
   * The iPod mount point path.
   *
   * @throws {IpodError} If the database is closed (code: DATABASE_CLOSED)
   */
  get mountPoint(): string {
    this.assertOpen();
    return this._mountPoint;
  }

  /**
   * Device information for the connected iPod.
   *
   * @throws {IpodError} If the database is closed (code: DATABASE_CLOSED)
   */
  get device(): IpodDeviceInfo {
    this.assertOpen();
    const info = this.db.getInfo();
    const device = info.device;
    return {
      modelName: device.modelName,
      modelNumber: device.modelNumber,
      generation: device.generation,
      capacity: device.capacity,
      supportsArtwork: device.supportsArtwork,
      supportsVideo: device.supportsVideo,
      supportsPhoto: device.supportsPhoto,
      supportsPodcast: device.supportsPodcast,
    };
  }

  /**
   * Number of tracks in the database.
   *
   * @throws {IpodError} If the database is closed (code: DATABASE_CLOSED)
   */
  get trackCount(): number {
    this.assertOpen();
    return this.db.trackCount;
  }

  /**
   * Number of playlists in the database.
   *
   * @throws {IpodError} If the database is closed (code: DATABASE_CLOSED)
   */
  get playlistCount(): number {
    this.assertOpen();
    return this.db.playlistCount;
  }

  // ============================================================================
  // Info
  // ============================================================================

  /**
   * Gets information about the iPod database.
   *
   * @returns Database information including mount point, track/playlist counts, and device info
   * @throws {IpodError} If the database is closed (code: DATABASE_CLOSED)
   *
   * @example
   * ```typescript
   * const info = ipod.getInfo();
   * console.log(`${info.device.modelName} (${info.device.capacity}GB)`);
   * console.log(`Mount: ${info.mountPoint}`);
   * console.log(`Tracks: ${info.trackCount}`);
   * ```
   */
  getInfo(): IpodInfo {
    this.assertOpen();
    return {
      mountPoint: this._mountPoint,
      trackCount: this.db.trackCount,
      playlistCount: this.db.playlistCount,
      device: this.device,
    };
  }

  // ============================================================================
  // Track Operations
  // ============================================================================

  /**
   * Gets all tracks in the database.
   *
   * @returns Array of IPodTrack objects
   * @throws {IpodError} If the database is closed (code: DATABASE_CLOSED)
   *
   * @example
   * ```typescript
   * for (const track of ipod.getTracks()) {
   *   console.log(`${track.artist} - ${track.title}`);
   * }
   * ```
   */
  getTracks(): IPodTrack[] {
    this.assertOpen();
    return this.db.getTracks().map((handle) => this.createTrackFromHandle(handle));
  }

  /**
   * Adds a new track to the database.
   *
   * Note: This only adds metadata to the database. Use copyFileToTrack() or
   * track.copyFile() to copy the audio file to the iPod.
   *
   * @param input - Track metadata
   * @returns The created track
   * @throws {IpodError} If the database is closed (code: DATABASE_CLOSED)
   *
   * @example
   * ```typescript
   * const track = ipod.addTrack({
   *   title: 'Song Title',
   *   artist: 'Artist Name',
   *   album: 'Album Name',
   * });
   *
   * // Copy the audio file
   * track.copyFile('/path/to/song.mp3');
   * ```
   */
  addTrack(input: TrackInput): IPodTrack {
    this.assertOpen();
    const handle = this.db.addTrack(input);
    return this.createTrackFromHandle(handle);
  }

  /**
   * Updates track metadata.
   *
   * @param track - The track to update
   * @param fields - Fields to update
   * @returns A new IPodTrack snapshot with updated values
   * @throws {IpodError} If the track is unknown (code: TRACK_REMOVED)
   * @throws {IpodError} If the database is closed (code: DATABASE_CLOSED)
   */
  updateTrack(track: IPodTrack, fields: TrackFields): IPodTrack {
    this.assertOpen();
    const handle = this.getTrackHandle(track);
    this.db.updateTrack(handle, fields);
    return this.createTrackFromHandle(handle);
  }

  /**
   * Removes a track from the database.
   *
   * After calling this, the track object should not be used.
   *
   * @param track - The track to remove
   * @param options - Optional settings for the removal
   * @param options.deleteFile - If true, also delete the audio file from the iPod (default: false)
   * @throws {IpodError} If the track is unknown (code: TRACK_REMOVED)
   * @throws {IpodError} If the database is closed (code: DATABASE_CLOSED)
   */
  removeTrack(track: IPodTrack, options?: { deleteFile?: boolean }): void {
    this.assertOpen();
    const handle = this.getTrackHandle(track);

    // Delete the audio file if requested
    if (options?.deleteFile) {
      const filePath = this.db.getTrackFilePath(handle);
      if (filePath) {
        try {
          fs.unlinkSync(filePath);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // eslint-disable-next-line no-console
          console.error(`Failed to delete track file ${filePath}: ${message}`);
        }
      }
    }

    this.db.removeTrack(handle);
    // Mark the track as removed
    if (track instanceof IpodTrackImpl) {
      track._markRemoved();
    }
    // Remove from WeakMap is automatic when track is garbage collected
  }

  /**
   * Removes all tracks from the database.
   *
   * This is a destructive operation that removes all tracks and their audio files
   * from the iPod. The database must be saved after calling this method.
   *
   * @param options - Optional settings for the removal
   * @param options.deleteFiles - If true, also delete audio files from the iPod (default: true)
   * @returns The number of tracks removed
   * @throws {IpodError} If the database is closed (code: DATABASE_CLOSED)
   *
   * @example
   * ```typescript
   * const count = ipod.removeAllTracks();
   * console.log(`Removed ${count} tracks`);
   * await ipod.save();
   * ```
   */
  removeAllTracks(options?: { deleteFiles?: boolean }): number {
    this.assertOpen();
    const deleteFiles = options?.deleteFiles ?? true;
    const tracks = this.getTracks();
    const count = tracks.length;

    for (const track of tracks) {
      this.removeTrack(track, { deleteFile: deleteFiles });
    }

    return count;
  }

  /**
   * Copies an audio file to the iPod for a track.
   *
   * @param track - The track to copy the file for
   * @param sourcePath - Path to the source audio file
   * @returns A new IPodTrack snapshot with hasFile: true
   * @throws {IpodError} If the source file is not found (code: FILE_NOT_FOUND)
   * @throws {IpodError} If the copy operation fails (code: COPY_FAILED)
   * @throws {IpodError} If the track is unknown (code: TRACK_REMOVED)
   * @throws {IpodError} If the database is closed (code: DATABASE_CLOSED)
   */
  copyFileToTrack(track: IPodTrack, sourcePath: string): IPodTrack {
    this.assertOpen();
    const handle = this.getTrackHandle(track);

    // Check if source file exists
    try {
      fs.accessSync(sourcePath);
    } catch {
      throw new IpodError(`Source file not found: ${sourcePath}`, 'FILE_NOT_FOUND');
    }

    try {
      this.db.copyTrackToDevice(handle, sourcePath);
      return this.createTrackFromHandle(handle);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new IpodError(`Failed to copy file: ${message}`, 'COPY_FAILED');
    }
  }

  /**
   * Sets artwork for a track from an image file.
   *
   * @param track - The track to set artwork for
   * @param imagePath - Path to the image file (JPEG or PNG)
   * @returns A new IPodTrack snapshot with hasArtwork: true
   * @throws {IpodError} If artwork operation fails (code: ARTWORK_FAILED)
   * @throws {IpodError} If the track is unknown (code: TRACK_REMOVED)
   * @throws {IpodError} If the database is closed (code: DATABASE_CLOSED)
   */
  setTrackArtwork(track: IPodTrack, imagePath: string): IPodTrack {
    this.assertOpen();
    const handle = this.getTrackHandle(track);

    try {
      this.db.setTrackArtwork(handle, imagePath);
      return this.createTrackFromHandle(handle);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new IpodError(`Failed to set artwork: ${message}`, 'ARTWORK_FAILED');
    }
  }

  /**
   * Sets artwork for a track from image data.
   *
   * @param track - The track to set artwork for
   * @param imageData - Buffer containing image data (JPEG or PNG)
   * @returns A new IPodTrack snapshot with hasArtwork: true
   * @throws {IpodError} If artwork operation fails (code: ARTWORK_FAILED)
   * @throws {IpodError} If the track is unknown (code: TRACK_REMOVED)
   * @throws {IpodError} If the database is closed (code: DATABASE_CLOSED)
   */
  setTrackArtworkFromData(track: IPodTrack, imageData: Buffer): IPodTrack {
    this.assertOpen();
    const handle = this.getTrackHandle(track);

    try {
      this.db.setTrackArtworkFromData(handle, imageData);
      return this.createTrackFromHandle(handle);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new IpodError(`Failed to set artwork: ${message}`, 'ARTWORK_FAILED');
    }
  }

  /**
   * Removes artwork from a track.
   *
   * @param track - The track to remove artwork from
   * @returns A new IPodTrack snapshot with hasArtwork: false
   * @throws {IpodError} If artwork operation fails (code: ARTWORK_FAILED)
   * @throws {IpodError} If the track is unknown (code: TRACK_REMOVED)
   * @throws {IpodError} If the database is closed (code: DATABASE_CLOSED)
   */
  removeTrackArtwork(track: IPodTrack): IPodTrack {
    this.assertOpen();
    const handle = this.getTrackHandle(track);

    try {
      this.db.removeTrackArtwork(handle);
      return this.createTrackFromHandle(handle);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new IpodError(`Failed to remove artwork: ${message}`, 'ARTWORK_FAILED');
    }
  }

  // ============================================================================
  // Playlist Operations
  // ============================================================================

  /**
   * Gets all playlists in the database.
   *
   * @returns Array of IpodPlaylist objects
   * @throws {IpodError} If the database is closed (code: DATABASE_CLOSED)
   *
   * @example
   * ```typescript
   * for (const playlist of ipod.getPlaylists()) {
   *   console.log(`${playlist.name}: ${playlist.trackCount} tracks`);
   * }
   * ```
   */
  getPlaylists(): IpodPlaylist[] {
    this.assertOpen();
    return this.db.getPlaylists().map((data) => this.createPlaylistFromData(data.id, data));
  }

  /**
   * Gets the master playlist (contains all tracks).
   *
   * @returns The master playlist
   * @throws {IpodError} If the database is closed (code: DATABASE_CLOSED)
   * @throws {IpodError} If no master playlist is found (code: DATABASE_CORRUPT)
   */
  getMasterPlaylist(): IpodPlaylist {
    this.assertOpen();
    const master = this.db.getMasterPlaylist();
    if (!master) {
      throw new IpodError('No master playlist found', 'DATABASE_CORRUPT');
    }
    return this.createPlaylistFromData(master.id, master);
  }

  /**
   * Finds a playlist by name.
   *
   * @param name - Playlist name to search for
   * @returns The playlist or null if not found
   * @throws {IpodError} If the database is closed (code: DATABASE_CLOSED)
   */
  getPlaylistByName(name: string): IpodPlaylist | null {
    this.assertOpen();
    const playlist = this.db.getPlaylistByName(name);
    if (!playlist) {
      return null;
    }
    return this.createPlaylistFromData(playlist.id, playlist);
  }

  /**
   * Creates a new playlist.
   *
   * @param name - Name for the new playlist
   * @returns The created playlist
   * @throws {IpodError} If the database is closed (code: DATABASE_CLOSED)
   *
   * @example
   * ```typescript
   * const playlist = ipod.createPlaylist('Favorites');
   * playlist.addTrack(track1).addTrack(track2);
   * ```
   */
  createPlaylist(name: string): IpodPlaylist {
    this.assertOpen();
    const playlist = this.db.createPlaylist(name);
    return this.createPlaylistFromData(playlist.id, playlist);
  }

  /**
   * Removes a playlist from the database.
   *
   * Note: The master playlist cannot be removed.
   *
   * @param playlist - The playlist to remove
   * @throws {IpodError} If the playlist is unknown (code: PLAYLIST_REMOVED)
   * @throws {IpodError} If the database is closed (code: DATABASE_CLOSED)
   */
  removePlaylist(playlist: IpodPlaylist): void {
    this.assertOpen();
    const id = this.getPlaylistId(playlist);
    this.db.removePlaylist(id);
    // Mark the playlist as removed
    if (playlist instanceof IpodPlaylistImpl) {
      playlist._markRemoved();
    }
  }

  /**
   * Renames a playlist.
   *
   * @param playlist - The playlist to rename
   * @param newName - New name for the playlist
   * @returns A new IpodPlaylist snapshot with the updated name
   * @throws {IpodError} If the playlist is unknown (code: PLAYLIST_REMOVED)
   * @throws {IpodError} If the database is closed (code: DATABASE_CLOSED)
   */
  renamePlaylist(playlist: IpodPlaylist, newName: string): IpodPlaylist {
    this.assertOpen();
    const id = this.getPlaylistId(playlist);
    const updated = this.db.renamePlaylist(id, newName);
    return this.createPlaylistFromData(updated.id, updated);
  }

  /**
   * Adds a track to a playlist.
   *
   * @param playlist - The playlist to add to
   * @param track - The track to add
   * @returns A new IpodPlaylist snapshot with the track added
   * @throws {IpodError} If the playlist is unknown (code: PLAYLIST_REMOVED)
   * @throws {IpodError} If the track is unknown (code: TRACK_REMOVED)
   * @throws {IpodError} If the database is closed (code: DATABASE_CLOSED)
   */
  addTrackToPlaylist(playlist: IpodPlaylist, track: IPodTrack): IpodPlaylist {
    this.assertOpen();
    const playlistId = this.getPlaylistId(playlist);
    const trackHandle = this.getTrackHandle(track);
    const updated = this.db.addTrackToPlaylist(playlistId, trackHandle);
    return this.createPlaylistFromData(updated.id, updated);
  }

  /**
   * Removes a track from a playlist.
   *
   * Note: This only removes the track from the playlist, not from the iPod.
   *
   * @param playlist - The playlist to remove from
   * @param track - The track to remove
   * @returns A new IpodPlaylist snapshot with the track removed
   * @throws {IpodError} If the playlist is unknown (code: PLAYLIST_REMOVED)
   * @throws {IpodError} If the track is unknown (code: TRACK_REMOVED)
   * @throws {IpodError} If the database is closed (code: DATABASE_CLOSED)
   */
  removeTrackFromPlaylist(playlist: IpodPlaylist, track: IPodTrack): IpodPlaylist {
    this.assertOpen();
    const playlistId = this.getPlaylistId(playlist);
    const trackHandle = this.getTrackHandle(track);
    const updated = this.db.removeTrackFromPlaylist(playlistId, trackHandle);
    return this.createPlaylistFromData(updated.id, updated);
  }

  /**
   * Gets all tracks in a playlist.
   *
   * @param playlist - The playlist to get tracks from
   * @returns Array of tracks in the playlist
   * @throws {IpodError} If the playlist is unknown (code: PLAYLIST_REMOVED)
   * @throws {IpodError} If the database is closed (code: DATABASE_CLOSED)
   */
  getPlaylistTracks(playlist: IpodPlaylist): IPodTrack[] {
    this.assertOpen();
    const playlistId = this.getPlaylistId(playlist);
    return this.db.getPlaylistTracks(playlistId).map((handle) => this.createTrackFromHandle(handle));
  }

  /**
   * Checks if a playlist contains a specific track.
   *
   * @param playlist - The playlist to check
   * @param track - The track to look for
   * @returns true if the playlist contains the track
   * @throws {IpodError} If the playlist is unknown (code: PLAYLIST_REMOVED)
   * @throws {IpodError} If the track is unknown (code: TRACK_REMOVED)
   * @throws {IpodError} If the database is closed (code: DATABASE_CLOSED)
   */
  playlistContainsTrack(playlist: IpodPlaylist, track: IPodTrack): boolean {
    this.assertOpen();
    const playlistId = this.getPlaylistId(playlist);
    const trackHandle = this.getTrackHandle(track);
    return this.db.playlistContainsTrack(playlistId, trackHandle);
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Saves changes to the iPod database.
   *
   * @returns Save result including any warnings
   * @throws {IpodError} If save fails (code: SAVE_FAILED)
   * @throws {IpodError} If the database is closed (code: DATABASE_CLOSED)
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
  async save(): Promise<SaveResult> {
    this.assertOpen();

    const warnings: string[] = [];

    // Check for tracks without files
    const tracks = this.getTracks();
    const tracksWithoutFiles = tracks.filter((t) => !t.hasFile);
    if (tracksWithoutFiles.length > 0) {
      warnings.push(
        `${tracksWithoutFiles.length} track${tracksWithoutFiles.length === 1 ? '' : 's'} have no audio file and won't be playable`
      );
    }

    try {
      await this.db.save();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new IpodError(`Failed to save database: ${message}`, 'SAVE_FAILED');
    }

    return { warnings };
  }

  /**
   * Closes the database and releases resources.
   *
   * After calling this, the database instance should not be used.
   */
  close(): void {
    if (!this._closed) {
      this.db.close();
      this._closed = true;
    }
  }

  /**
   * Ensure the database is closed when garbage collected.
   */
  [Symbol.dispose](): void {
    this.close();
  }
}
