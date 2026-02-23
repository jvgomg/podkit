/**
 * High-level TypeScript wrapper for iPod database operations.
 *
 * This module provides a clean async API around the native bindings,
 * with proper TypeScript types and error handling.
 */

import {
  parse as nativeParse,
  type NativeDatabase,
} from './binding';

import type {
  Track,
  Playlist,
  DatabaseInfo,
  TrackInput,
  DeviceInfo,
  ArtworkCapabilities,
} from './types';

import { LibgpodError, LibgpodErrorCode } from './types';

/**
 * Represents an iPod database connection.
 *
 * Use `Database.open()` to parse an existing iPod database.
 *
 * @example
 * ```typescript
 * const db = await Database.open('/media/ipod');
 * console.log(`Found ${db.trackCount} tracks`);
 *
 * const tracks = db.getTracks();
 * for (const track of tracks) {
 *   console.log(`${track.artist} - ${track.title}`);
 * }
 *
 * db.close();
 * ```
 */
export class Database {
  private native: NativeDatabase | null;
  private _mountpoint: string;
  private _closed = false;

  private constructor(native: NativeDatabase, mountpoint: string) {
    this.native = native;
    this._mountpoint = mountpoint;
  }

  /**
   * Open an iPod database from a mount point.
   *
   * @param mountpoint Path to the iPod mount point (e.g., "/media/ipod")
   * @returns Database instance
   * @throws LibgpodError if the database cannot be parsed
   */
  static async open(mountpoint: string): Promise<Database> {
    try {
      const native = nativeParse(mountpoint);
      return new Database(native, mountpoint);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Corrupt,
        'parse'
      );
    }
  }

  /**
   * Synchronous version of open() for cases where async is not needed.
   *
   * @param mountpoint Path to the iPod mount point
   * @returns Database instance
   * @throws LibgpodError if the database cannot be parsed
   */
  static openSync(mountpoint: string): Database {
    try {
      const native = nativeParse(mountpoint);
      return new Database(native, mountpoint);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Corrupt,
        'parse'
      );
    }
  }

  /**
   * Ensure the database is open.
   */
  private ensureOpen(): NativeDatabase {
    if (this._closed || !this.native) {
      throw new LibgpodError(
        'Database is closed',
        LibgpodErrorCode.Unknown,
        'ensureOpen'
      );
    }
    return this.native;
  }

  /**
   * The iPod mount point path.
   */
  get mountpoint(): string {
    return this._mountpoint;
  }

  /**
   * Whether the database has been closed.
   */
  get closed(): boolean {
    return this._closed;
  }

  /**
   * Get database information.
   */
  getInfo(): DatabaseInfo {
    const native = this.ensureOpen();
    const info = native.getInfo();

    // Provide default device info if null
    const device: DeviceInfo = info.device ?? {
      modelNumber: null,
      modelName: 'Unknown',
      generation: 'unknown',
      model: 'unknown',
      capacity: 0,
      musicDirs: 0,
      supportsArtwork: false,
      supportsVideo: false,
      supportsPhoto: false,
      supportsPodcast: false,
    };

    return {
      mountpoint: info.mountpoint ?? this._mountpoint,
      version: info.version,
      id: info.id,
      trackCount: info.trackCount,
      playlistCount: info.playlistCount,
      device,
    };
  }

  /**
   * Number of tracks in the database.
   */
  get trackCount(): number {
    return this.getInfo().trackCount;
  }

  /**
   * Number of playlists in the database.
   */
  get playlistCount(): number {
    return this.getInfo().playlistCount;
  }

  /**
   * Device information.
   */
  get device(): DeviceInfo {
    return this.getInfo().device;
  }

  /**
   * Get all tracks in the database.
   *
   * @returns Array of track metadata
   */
  getTracks(): Track[] {
    const native = this.ensureOpen();
    return native.getTracks();
  }

  /**
   * Get a track by its ID.
   *
   * @param id Track ID
   * @returns Track or null if not found
   */
  getTrackById(id: number): Track | null {
    const native = this.ensureOpen();
    return native.getTrackById(id);
  }

  /**
   * Get all playlists in the database.
   *
   * @returns Array of playlist metadata
   */
  getPlaylists(): Playlist[] {
    const native = this.ensureOpen();
    return native.getPlaylists();
  }

  /**
   * Add a new track to the database.
   *
   * Note: This only adds metadata to the database. To copy a file to the iPod,
   * use `copyTrackToDevice()` after adding the track.
   *
   * @param input Track metadata
   * @returns The created track with assigned ID
   */
  addTrack(input: TrackInput): Track {
    const native = this.ensureOpen();
    return native.addTrack(input);
  }

  /**
   * Copy an audio file to the iPod storage.
   *
   * This copies the source file to the iPod's internal storage location
   * and updates the track's ipod_path. The track must already be added
   * to the database via `addTrack()` before calling this method.
   *
   * The file format must be iPod-compatible (MP3, AAC/M4A).
   * Transcoding should be done before calling this method.
   *
   * @param trackId ID of the track to copy file for
   * @param sourcePath Path to the source audio file
   * @returns The updated track with ipod_path set
   * @throws LibgpodError if copying fails (disk full, file not found, etc.)
   *
   * @example
   * ```typescript
   * const track = db.addTrack({ title: 'Song', artist: 'Artist' });
   * const updated = db.copyTrackToDevice(track.id, '/path/to/song.mp3');
   * console.log(updated.ipodPath); // :iPod_Control:Music:F00:...
   * await db.save();
   * ```
   */
  copyTrackToDevice(trackId: number, sourcePath: string): Track {
    const native = this.ensureOpen();
    try {
      return native.copyTrackToDevice(trackId, sourcePath);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'copyTrackToDevice'
      );
    }
  }

  /**
   * Async version of copyTrackToDevice for consistency with other async methods.
   *
   * @param trackId ID of the track to copy file for
   * @param sourcePath Path to the source audio file
   * @returns The updated track with ipod_path set
   */
  async copyTrackToDeviceAsync(
    trackId: number,
    sourcePath: string
  ): Promise<Track> {
    return this.copyTrackToDevice(trackId, sourcePath);
  }

  /**
   * Remove a track from the database.
   *
   * Note: This does not delete the file from the iPod.
   *
   * @param trackId Track ID to remove
   */
  removeTrack(trackId: number): void {
    const native = this.ensureOpen();
    native.removeTrack(trackId);
  }

  /**
   * Set artwork for a track from an image file.
   *
   * Uses libgpod's `itdb_track_set_thumbnails` to set artwork.
   * libgpod automatically handles:
   * - Resizing to all required thumbnail sizes
   * - Converting to the correct pixel format for the device
   * - Writing to .ithmb files on save()
   *
   * The image file must exist until save() is called, as thumbnails
   * are generated lazily during the write operation.
   *
   * @param trackId ID of the track to set artwork for
   * @param imagePath Path to the image file (JPEG or PNG recommended)
   * @returns The updated track with hasArtwork set to true
   * @throws LibgpodError if setting artwork fails (track not found, invalid image, etc.)
   *
   * @example
   * ```typescript
   * // Extract artwork from source file and apply to iPod track
   * const artworkPath = await extractAndSaveArtwork('/path/to/song.flac');
   * if (artworkPath) {
   *   db.setTrackArtwork(track.id, artworkPath);
   * }
   * await db.save();
   * // Clean up temp artwork file after save
   * await cleanupTempArtwork(artworkPath);
   * ```
   */
  setTrackArtwork(trackId: number, imagePath: string): Track {
    const native = this.ensureOpen();
    try {
      return native.setTrackThumbnails(trackId, imagePath);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'setTrackArtwork'
      );
    }
  }

  /**
   * Async version of setTrackArtwork for consistency with other async methods.
   *
   * @param trackId ID of the track to set artwork for
   * @param imagePath Path to the image file
   * @returns The updated track with hasArtwork set to true
   */
  async setTrackArtworkAsync(trackId: number, imagePath: string): Promise<Track> {
    return this.setTrackArtwork(trackId, imagePath);
  }

  /**
   * Set artwork for a track from raw image data.
   *
   * Uses libgpod's `itdb_track_set_thumbnails_from_data` to set artwork
   * from a Buffer containing image data. This is useful when artwork
   * is already loaded in memory (e.g., extracted from audio file metadata).
   *
   * @param trackId ID of the track to set artwork for
   * @param imageData Buffer containing image data (JPEG or PNG)
   * @returns The updated track with hasArtwork set to true
   * @throws LibgpodError if setting artwork fails
   *
   * @example
   * ```typescript
   * // Read image data from file
   * const imageData = await fs.readFile('/path/to/artwork.jpg');
   * db.setTrackArtworkFromData(track.id, imageData);
   * await db.save();
   * ```
   */
  setTrackArtworkFromData(trackId: number, imageData: Buffer): Track {
    const native = this.ensureOpen();
    try {
      return native.setTrackThumbnailsFromData(trackId, imageData);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'setTrackArtworkFromData'
      );
    }
  }

  /**
   * Async version of setTrackArtworkFromData.
   *
   * @param trackId ID of the track to set artwork for
   * @param imageData Buffer containing image data
   * @returns The updated track with hasArtwork set to true
   */
  async setTrackArtworkFromDataAsync(trackId: number, imageData: Buffer): Promise<Track> {
    return this.setTrackArtworkFromData(trackId, imageData);
  }

  /**
   * Remove artwork from a track.
   *
   * This removes all thumbnails associated with the track.
   * Changes take effect when save() is called.
   *
   * @param trackId ID of the track to remove artwork from
   * @returns The updated track with hasArtwork set to false
   * @throws LibgpodError if the track is not found
   *
   * @example
   * ```typescript
   * const track = db.getTrackById(trackId);
   * if (track && track.hasArtwork) {
   *   db.removeTrackArtwork(trackId);
   *   await db.save();
   * }
   * ```
   */
  removeTrackArtwork(trackId: number): Track {
    const native = this.ensureOpen();
    try {
      return native.removeTrackThumbnails(trackId);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'removeTrackArtwork'
      );
    }
  }

  /**
   * Check if a track has artwork.
   *
   * This uses libgpod's `itdb_track_has_thumbnails` to check if artwork
   * exists for the track. This is more reliable than checking the
   * hasArtwork property, as it actually checks for thumbnail data.
   *
   * @param trackId ID of the track to check
   * @returns True if the track has artwork
   * @throws LibgpodError if the track is not found
   *
   * @example
   * ```typescript
   * const hasArtwork = db.hasTrackArtwork(track.id);
   * if (!hasArtwork) {
   *   // Set artwork from source file
   *   db.setTrackArtwork(track.id, artworkPath);
   * }
   * ```
   */
  hasTrackArtwork(trackId: number): boolean {
    const native = this.ensureOpen();
    try {
      return native.hasTrackThumbnails(trackId);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'hasTrackArtwork'
      );
    }
  }

  /**
   * Get artwork capability information for the device.
   *
   * Returns information about the device's artwork support, including
   * whether artwork is supported and the device generation/model.
   *
   * Note: The detailed artwork formats are handled internally by libgpod
   * when setting thumbnails. This method provides basic capability info.
   *
   * @returns Artwork capabilities information
   *
   * @example
   * ```typescript
   * const caps = db.getArtworkCapabilities();
   * if (caps.supportsArtwork) {
   *   console.log(`Device ${caps.model} supports artwork`);
   * }
   * ```
   */
  getArtworkCapabilities(): ArtworkCapabilities {
    const native = this.ensureOpen();
    return native.getArtworkFormats();
  }

  /**
   * Write changes to the iPod database.
   *
   * Call this after making modifications (adding/removing tracks, etc.)
   * to persist changes to disk.
   *
   * @throws LibgpodError if writing fails
   */
  async save(): Promise<void> {
    const native = this.ensureOpen();
    try {
      native.write();
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'write'
      );
    }
  }

  /**
   * Synchronous version of save().
   *
   * @throws LibgpodError if writing fails
   */
  saveSync(): void {
    const native = this.ensureOpen();
    try {
      native.write();
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'write'
      );
    }
  }

  /**
   * Close the database and free resources.
   *
   * After calling this, the database instance should not be used.
   */
  close(): void {
    if (this.native && !this._closed) {
      this.native.close();
      this.native = null;
      this._closed = true;
    }
  }

  /**
   * Get unique artwork IDs (mhii_link values) from all tracks.
   *
   * This method collects all unique non-zero mhii_link values from tracks
   * in the database. These IDs reference artwork entries in the ArtworkDB
   * and can be used for artwork deduplication.
   *
   * @returns Array of unique artwork IDs (mhii_link values)
   *
   * @example
   * ```typescript
   * const db = Database.openSync('/media/ipod');
   * const artworkIds = db.getUniqueArtworkIds();
   * console.log(`Found ${artworkIds.length} unique artwork entries`);
   * ```
   */
  getUniqueArtworkIds(): number[] {
    const native = this.ensureOpen();
    return native.getUniqueArtworkIds();
  }

  // ============================================================================
  // Playlist operations
  // ============================================================================

  /**
   * Create a new playlist.
   *
   * @param name Name for the new playlist
   * @returns The created playlist
   * @throws LibgpodError if creation fails
   *
   * @example
   * ```typescript
   * const db = Database.openSync('/media/ipod');
   * const playlist = db.createPlaylist('My Favorites');
   * console.log(`Created playlist with ID: ${playlist.id}`);
   * await db.save();
   * ```
   */
  createPlaylist(name: string): Playlist {
    const native = this.ensureOpen();
    try {
      return native.createPlaylist(name);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'createPlaylist'
      );
    }
  }

  /**
   * Remove a playlist from the database.
   *
   * Note: The master playlist cannot be deleted.
   *
   * @param playlistId ID of the playlist to remove
   * @throws LibgpodError if the playlist is not found or is the master playlist
   *
   * @example
   * ```typescript
   * const playlist = db.getPlaylistByName('Old Playlist');
   * if (playlist) {
   *   db.removePlaylist(playlist.id);
   *   await db.save();
   * }
   * ```
   */
  removePlaylist(playlistId: bigint): void {
    const native = this.ensureOpen();
    try {
      native.removePlaylist(playlistId);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'removePlaylist'
      );
    }
  }

  /**
   * Find a playlist by its ID.
   *
   * @param playlistId Playlist ID (64-bit)
   * @returns Playlist or null if not found
   *
   * @example
   * ```typescript
   * const playlist = db.getPlaylistById(someId);
   * if (playlist) {
   *   console.log(`Found playlist: ${playlist.name}`);
   * }
   * ```
   */
  getPlaylistById(playlistId: bigint): Playlist | null {
    const native = this.ensureOpen();
    return native.getPlaylistById(playlistId);
  }

  /**
   * Find a playlist by name.
   *
   * @param name Playlist name to search for
   * @returns Playlist or null if not found
   *
   * @example
   * ```typescript
   * const favorites = db.getPlaylistByName('Favorites');
   * if (favorites) {
   *   console.log(`Found ${favorites.trackCount} tracks in Favorites`);
   * }
   * ```
   */
  getPlaylistByName(name: string): Playlist | null {
    const native = this.ensureOpen();
    return native.getPlaylistByName(name);
  }

  /**
   * Rename a playlist.
   *
   * @param playlistId ID of the playlist to rename
   * @param newName New name for the playlist
   * @returns The updated playlist
   * @throws LibgpodError if the playlist is not found
   *
   * @example
   * ```typescript
   * const playlist = db.getPlaylistByName('Old Name');
   * if (playlist) {
   *   db.renamePlaylist(playlist.id, 'New Name');
   *   await db.save();
   * }
   * ```
   */
  renamePlaylist(playlistId: bigint, newName: string): Playlist {
    const native = this.ensureOpen();
    try {
      return native.setPlaylistName(playlistId, newName);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'renamePlaylist'
      );
    }
  }

  /**
   * Add a track to a playlist.
   *
   * @param playlistId ID of the playlist
   * @param trackId ID of the track to add
   * @returns The updated playlist
   * @throws LibgpodError if the playlist or track is not found
   *
   * @example
   * ```typescript
   * const playlist = db.getPlaylistByName('Favorites');
   * const track = db.getTracks().find(t => t.title === 'Great Song');
   * if (playlist && track) {
   *   db.addTrackToPlaylist(playlist.id, track.id);
   *   await db.save();
   * }
   * ```
   */
  addTrackToPlaylist(playlistId: bigint, trackId: number): Playlist {
    const native = this.ensureOpen();
    try {
      return native.addTrackToPlaylist(playlistId, trackId);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'addTrackToPlaylist'
      );
    }
  }

  /**
   * Remove a track from a playlist.
   *
   * Note: This only removes the track from the playlist, not from the database.
   *
   * @param playlistId ID of the playlist
   * @param trackId ID of the track to remove
   * @returns The updated playlist
   * @throws LibgpodError if the playlist or track is not found
   *
   * @example
   * ```typescript
   * const playlist = db.getPlaylistByName('Favorites');
   * if (playlist && db.playlistContainsTrack(playlist.id, trackId)) {
   *   db.removeTrackFromPlaylist(playlist.id, trackId);
   *   await db.save();
   * }
   * ```
   */
  removeTrackFromPlaylist(playlistId: bigint, trackId: number): Playlist {
    const native = this.ensureOpen();
    try {
      return native.removeTrackFromPlaylist(playlistId, trackId);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'removeTrackFromPlaylist'
      );
    }
  }

  /**
   * Check if a playlist contains a specific track.
   *
   * @param playlistId ID of the playlist
   * @param trackId ID of the track
   * @returns True if the playlist contains the track
   * @throws LibgpodError if the playlist or track is not found
   *
   * @example
   * ```typescript
   * const playlist = db.getPlaylistByName('Favorites');
   * if (playlist && db.playlistContainsTrack(playlist.id, track.id)) {
   *   console.log('Track is in Favorites');
   * }
   * ```
   */
  playlistContainsTrack(playlistId: bigint, trackId: number): boolean {
    const native = this.ensureOpen();
    try {
      return native.playlistContainsTrack(playlistId, trackId);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'playlistContainsTrack'
      );
    }
  }

  /**
   * Get all tracks in a playlist.
   *
   * @param playlistId ID of the playlist
   * @returns Array of tracks in the playlist
   * @throws LibgpodError if the playlist is not found
   *
   * @example
   * ```typescript
   * const playlist = db.getPlaylistByName('Favorites');
   * if (playlist) {
   *   const tracks = db.getPlaylistTracks(playlist.id);
   *   for (const track of tracks) {
   *     console.log(`${track.artist} - ${track.title}`);
   *   }
   * }
   * ```
   */
  getPlaylistTracks(playlistId: bigint): Track[] {
    const native = this.ensureOpen();
    try {
      return native.getPlaylistTracks(playlistId);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'getPlaylistTracks'
      );
    }
  }

  /**
   * Get the master playlist.
   *
   * The master playlist contains all tracks on the iPod.
   *
   * @returns The master playlist or null if not found (shouldn't happen)
   *
   * @example
   * ```typescript
   * const mpl = db.getMasterPlaylist();
   * if (mpl) {
   *   console.log(`iPod has ${mpl.trackCount} tracks total`);
   * }
   * ```
   */
  getMasterPlaylist(): Playlist | null {
    const playlists = this.getPlaylists();
    return playlists.find((p) => p.isMaster) ?? null;
  }

  /**
   * Ensure the database is closed when garbage collected.
   */
  [Symbol.dispose](): void {
    this.close();
  }
}
