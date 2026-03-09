/**
 * High-level TypeScript wrapper for iPod database operations.
 *
 * This module provides a clean async API around the native bindings,
 * with proper TypeScript types and error handling.
 */

import {
  parse as nativeParse,
  parseFile as nativeParseFile,
  create as nativeCreate,
  initIpod as nativeInitIpod,
  type NativeDatabase,
} from './binding';

import type {
  Track,
  TrackHandle,
  Playlist,
  DatabaseInfo,
  TrackInput,
  DeviceInfo,
  ArtworkCapabilities,
  DeviceCapabilities,
  SmartPlaylist,
  SPLRule,
  SPLPreferences,
  SmartPlaylistInput,
  Chapter,
  ChapterInput,
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
   * Create a new empty iPod database.
   *
   * Creates a fresh database that is not associated with any mountpoint.
   * The database has reasonable defaults (version 0x13, random ID).
   *
   * To use the database with an iPod, call `setMountpoint()` to associate
   * it with an iPod mount point before saving.
   *
   * @returns Database instance
   * @throws LibgpodError if creation fails
   *
   * @example
   * ```typescript
   * // Create a new empty database
   * const db = Database.create();
   *
   * // Associate with an iPod
   * db.setMountpoint('/media/ipod');
   *
   * // Add tracks
   * db.addTrack({ title: 'Test', artist: 'Artist' });
   *
   * // Save to iPod
   * await db.save();
   * db.close();
   * ```
   */
  static create(): Database {
    try {
      const native = nativeCreate();
      return new Database(native, '');
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'create'
      );
    }
  }

  /**
   * Options for initializing an iPod database.
   */
  static readonly IpodModels = {
    // iPod Video (5th gen)
    /** iPod Video 30GB (5th gen) - supports artwork and video */
    VIDEO_30GB: 'MA002',
    /** iPod Video 60GB (5th gen) - default, supports artwork and video */
    VIDEO_60GB: 'MA147',

    // iPod Classic
    /** iPod Classic 80GB (6th gen, 1st Classic) */
    CLASSIC_80GB: 'MB029',
    /** iPod Classic 120GB (6th gen, 2nd Classic) */
    CLASSIC_120GB: 'MB565',
    /** iPod Classic 160GB (6th gen, 3rd Classic) - largest capacity */
    CLASSIC_160GB: 'MC293',

    // iPod Nano
    /** iPod Nano 2GB (2nd gen) */
    NANO_2GB: 'MA477',
    /** iPod Nano 4GB (3rd gen) - first video-capable nano */
    NANO_4GB_3G: 'MA978',
    /** iPod Nano 8GB (4th gen) - vertical form factor */
    NANO_8GB_4G: 'MB598',
    /** iPod Nano 8GB (5th gen) - with camera */
    NANO_8GB_5G: 'MC027',
    /** iPod Nano 8GB (6th gen) - multi-touch, clip form */
    NANO_8GB_6G: 'MC525',

    // iPod Touch (note: requires additional signing for sync)
    /** iPod Touch 8GB (1st gen) */
    TOUCH_8GB_1G: 'MA623',
    /** iPod Touch 32GB (1st gen) */
    TOUCH_32GB_1G: 'MB376',
  } as const;

  /**
   * Initialize a new iPod database on a mountpoint.
   *
   * Creates the full iPod directory structure (iPod_Control/iTunes, etc.),
   * SysInfo file with device model information, and an empty iTunesDB.
   * This is what you use to set up an iPod that has no existing database
   * (e.g., a freshly formatted device or one with a corrupted database).
   *
   * The directory will be created if it doesn't exist.
   *
   * @param mountpoint Path to the iPod mount point
   * @param options Optional initialization options
   * @returns Database instance ready for use
   * @throws LibgpodError if initialization fails
   *
   * @example
   * ```typescript
   * // Initialize a new iPod with default settings (iPod Video 60GB)
   * const db = await Database.initializeIpod('/Volumes/IPOD');
   *
   * // Initialize with specific model
   * const db = await Database.initializeIpod('/Volumes/IPOD', {
   *   model: Database.IpodModels.CLASSIC_120GB,
   *   name: 'My iPod Classic'
   * });
   *
   * // Add tracks and save
   * db.addTrack({ title: 'First Song', artist: 'Artist' });
   * await db.save();
   * db.close();
   * ```
   */
  static async initializeIpod(
    mountpoint: string,
    options?: {
      /** iPod model number (e.g., "MA147"). See Database.IpodModels for common values. */
      model?: string;
      /** Name for the iPod (default: "iPod") */
      name?: string;
    }
  ): Promise<Database> {
    try {
      const native = nativeInitIpod(mountpoint, options?.model, options?.name);
      return new Database(native, mountpoint);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'initializeIpod'
      );
    }
  }

  /**
   * Synchronous version of initializeIpod().
   *
   * @param mountpoint Path to the iPod mount point
   * @param options Optional initialization options
   * @returns Database instance ready for use
   * @throws LibgpodError if initialization fails
   */
  static initializeIpodSync(
    mountpoint: string,
    options?: {
      model?: string;
      name?: string;
    }
  ): Database {
    try {
      const native = nativeInitIpod(mountpoint, options?.model, options?.name);
      return new Database(native, mountpoint);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'initializeIpod'
      );
    }
  }

  /**
   * Open an iPod database from a specific file path.
   *
   * Unlike `open()` and `openSync()`, this reads a database file directly
   * without requiring a full iPod mount point structure. This is useful
   * for reading local repository backups or database files that have been
   * copied from an iPod.
   *
   * **Note:** The database will have no mountpoint set, so track file
   * operations like `copyTrackToDevice()` and `getTrackFilePath()` may
   * not work correctly. Use `setMountpoint()` if you need these features.
   *
   * @param filename Path to the iTunesDB file
   * @returns Database instance
   * @throws LibgpodError if parsing fails
   *
   * @example
   * ```typescript
   * // Open a backup of an iPod database
   * const db = Database.openFile('/backups/iTunesDB');
   *
   * // Read tracks
   * for (const track of db.getTracks()) {
   *   console.log(`${track.artist} - ${track.title}`);
   * }
   *
   * db.close();
   * ```
   */
  static openFile(filename: string): Database {
    try {
      const native = nativeParseFile(filename);
      return new Database(native, '');
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Corrupt,
        'parseFile'
      );
    }
  }

  /**
   * Async version of openFile for consistency with other async methods.
   *
   * @param filename Path to the iTunesDB file
   * @returns Database instance
   * @throws LibgpodError if parsing fails
   */
  static async openFileAsync(filename: string): Promise<Database> {
    return Database.openFile(filename);
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
   * Create a TrackHandle from a native index.
   */
  private createHandle(index: number): TrackHandle {
    return { __brand: 'TrackHandle', index } as TrackHandle;
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
   * Set the mountpoint for the database.
   *
   * This is useful when you create a new database with `Database.create()`
   * or open a database file with `Database.openFile()` and need to
   * associate it with an iPod mount point.
   *
   * **Warning:** Calling this function removes any artwork in the database
   * that was read from the previous iPod, as it may no longer be valid.
   *
   * @param mountpoint Path to the iPod mount point
   *
   * @example
   * ```typescript
   * const db = Database.create();
   * db.setMountpoint('/media/ipod');
   * // Now you can add tracks and save to the iPod
   * ```
   */
  setMountpoint(mountpoint: string): void {
    const native = this.ensureOpen();
    try {
      native.setMountpoint(mountpoint);
      this._mountpoint = mountpoint;
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'setMountpoint'
      );
    }
  }

  /**
   * Get the filename of the database file.
   *
   * This returns the path to the iTunesDB file that was used when
   * opening the database with `Database.openFile()`, or the path
   * that was determined when opening with `Database.open()`.
   *
   * @returns The database file path, or null if not set
   *
   * @example
   * ```typescript
   * const db = Database.openFile('/backups/iTunesDB');
   * console.log(db.getFilename()); // '/backups/iTunesDB'
   * ```
   */
  getFilename(): string | null {
    const native = this.ensureOpen();
    try {
      return native.getFilename();
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'getFilename'
      );
    }
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
   * Returns handles that can be used to access track data and perform
   * operations. Use `getTrack(handle)` to get the track metadata.
   *
   * @returns Array of track handles
   *
   * @example
   * ```typescript
   * for (const handle of db.getTracks()) {
   *   const track = db.getTrack(handle);
   *   console.log(`${track.artist} - ${track.title}`);
   * }
   * ```
   */
  getTracks(): TrackHandle[] {
    const native = this.ensureOpen();
    return native.getTracks().map((index) => this.createHandle(index));
  }

  /**
   * Get track metadata from a handle.
   *
   * Returns a point-in-time snapshot of the track's metadata. Changes
   * made to the track will not be reflected until you call this again.
   *
   * @param handle Track handle from getTracks() or addTrack()
   * @returns Track metadata snapshot
   * @throws LibgpodError if the handle is invalid
   *
   * @example
   * ```typescript
   * const handle = db.addTrack({ title: 'Song', artist: 'Artist' });
   * const track = db.getTrack(handle);
   * console.log(`Added: ${track.title}`);
   * ```
   */
  getTrack(handle: TrackHandle): Track {
    const native = this.ensureOpen();
    try {
      return native.getTrackData(handle.index);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.NotFound,
        'getTrack'
      );
    }
  }

  /**
   * Get a track handle by its database ID (dbid).
   *
   * The dbid is a 64-bit unique identifier that persists across database
   * operations. This is useful for finding a track after the database
   * has been saved and reopened.
   *
   * @param dbid Database ID (64-bit BigInt)
   * @returns Track handle or null if not found
   *
   * @example
   * ```typescript
   * const handle = db.getTracks()[0];
   * const track = db.getTrack(handle);
   * const dbid = track.dbid;
   *
   * // Later, look up by dbid
   * const found = db.getTrackByDbId(dbid);
   * if (found) {
   *   const trackData = db.getTrack(found);
   * }
   * ```
   */
  getTrackByDbId(dbid: bigint): TrackHandle | null {
    const native = this.ensureOpen();
    const index = native.getTrackByDbId(dbid);
    if (index === null || index < 0) {
      return null;
    }
    return this.createHandle(index);
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
   * @returns Handle to the created track
   *
   * @example
   * ```typescript
   * const handle = db.addTrack({ title: 'Song', artist: 'Artist' });
   * db.copyTrackToDevice(handle, '/path/to/song.mp3');
   * await db.save();
   * ```
   */
  addTrack(input: TrackInput): TrackHandle {
    const native = this.ensureOpen();
    const index = native.addTrack(input);
    return this.createHandle(index);
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
   * @param handle Handle of the track to copy file for
   * @param sourcePath Path to the source audio file
   * @returns The updated track metadata with ipod_path set
   * @throws LibgpodError if copying fails (disk full, file not found, etc.)
   *
   * @example
   * ```typescript
   * const handle = db.addTrack({ title: 'Song', artist: 'Artist' });
   * const track = db.copyTrackToDevice(handle, '/path/to/song.mp3');
   * console.log(track.ipodPath); // :iPod_Control:Music:F00:...
   * await db.save();
   * ```
   */
  copyTrackToDevice(handle: TrackHandle, sourcePath: string): Track {
    const native = this.ensureOpen();
    try {
      return native.copyTrackToDevice(handle.index, sourcePath);
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
   * @param handle Handle of the track to copy file for
   * @param sourcePath Path to the source audio file
   * @returns The updated track metadata with ipod_path set
   */
  async copyTrackToDeviceAsync(
    handle: TrackHandle,
    sourcePath: string
  ): Promise<Track> {
    return this.copyTrackToDevice(handle, sourcePath);
  }

  /**
   * Remove a track from the database.
   *
   * Note: This does not delete the file from the iPod.
   * After calling this, the handle is no longer valid.
   *
   * @param handle Handle of the track to remove
   */
  removeTrack(handle: TrackHandle): void {
    const native = this.ensureOpen();
    native.removeTrack(handle.index);
  }

  /**
   * Update an existing track's metadata.
   *
   * Only the fields provided in the input object will be updated.
   * Other fields will retain their current values.
   *
   * @param handle Handle of the track to update
   * @param fields Partial track input with fields to update
   * @returns The updated track metadata
   * @throws LibgpodError if the handle is invalid
   *
   * @example
   * ```typescript
   * // Update just the title and artist
   * const track = db.updateTrack(handle, {
   *   title: 'New Title',
   *   artist: 'New Artist'
   * });
   *
   * // Update rating and play count
   * db.updateTrack(handle, {
   *   rating: 80,  // 4 stars
   *   playCount: 10
   * });
   *
   * await db.save();
   * ```
   */
  updateTrack(handle: TrackHandle, fields: Partial<TrackInput>): Track {
    const native = this.ensureOpen();
    try {
      return native.updateTrack(handle.index, fields);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'updateTrack'
      );
    }
  }

  /**
   * Get the full filesystem path for a track on the iPod.
   *
   * This uses libgpod's `itdb_filename_on_ipod()` to construct the
   * full path by combining the mountpoint with the track's ipod_path.
   *
   * @param handle Handle of the track
   * @returns Full filesystem path or null if track has no file
   * @throws LibgpodError if the handle is invalid
   *
   * @example
   * ```typescript
   * const handle = db.getTracks()[0];
   * const filePath = db.getTrackFilePath(handle);
   * if (filePath) {
   *   console.log(`Track file: ${filePath}`);
   *   // e.g., "/media/ipod/iPod_Control/Music/F00/ABCD.mp3"
   * }
   * ```
   */
  getTrackFilePath(handle: TrackHandle): string | null {
    const native = this.ensureOpen();
    try {
      return native.getTrackFilePath(handle.index);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'getTrackFilePath'
      );
    }
  }

  /**
   * Duplicate an existing track.
   *
   * Creates a copy of the track's metadata. The duplicate will have:
   * - A new database ID (dbid)
   * - ipodPath set to null (no file association)
   * - transferred set to false
   * - time_added set to now
   *
   * The duplicate is automatically added to the database and master playlist.
   *
   * To also copy the audio file, call `copyTrackToDevice()` on the
   * duplicate with a source file path.
   *
   * @param handle Handle of the track to duplicate
   * @returns Handle to the newly created duplicate track
   * @throws LibgpodError if the handle is invalid
   *
   * @example
   * ```typescript
   * // Duplicate a track
   * const original = db.getTrack(handle);
   * const copyHandle = db.duplicateTrack(handle);
   *
   * // Optionally modify the copy
   * db.updateTrack(copyHandle, { title: `${original.title} (Copy)` });
   *
   * // Optionally copy the audio file
   * const originalPath = db.getTrackFilePath(handle);
   * if (originalPath) {
   *   db.copyTrackToDevice(copyHandle, originalPath);
   * }
   *
   * await db.save();
   * ```
   */
  duplicateTrack(handle: TrackHandle): TrackHandle {
    const native = this.ensureOpen();
    try {
      const index = native.duplicateTrack(handle.index);
      return this.createHandle(index);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'duplicateTrack'
      );
    }
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
   * @param handle Handle of the track to set artwork for
   * @param imagePath Path to the image file (JPEG or PNG recommended)
   * @returns The updated track metadata with hasArtwork set to true
   * @throws LibgpodError if setting artwork fails (invalid handle, invalid image, etc.)
   *
   * @example
   * ```typescript
   * // Extract artwork from source file and apply to iPod track
   * const artworkPath = await extractAndSaveArtwork('/path/to/song.flac');
   * if (artworkPath) {
   *   db.setTrackArtwork(handle, artworkPath);
   * }
   * await db.save();
   * // Clean up temp artwork file after save
   * await cleanupTempArtwork(artworkPath);
   * ```
   */
  setTrackArtwork(handle: TrackHandle, imagePath: string): Track {
    const native = this.ensureOpen();
    try {
      return native.setTrackThumbnails(handle.index, imagePath);
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
   * @param handle Handle of the track to set artwork for
   * @param imagePath Path to the image file
   * @returns The updated track metadata with hasArtwork set to true
   */
  async setTrackArtworkAsync(handle: TrackHandle, imagePath: string): Promise<Track> {
    return this.setTrackArtwork(handle, imagePath);
  }

  /**
   * Set artwork for a track from raw image data.
   *
   * Uses libgpod's `itdb_track_set_thumbnails_from_data` to set artwork
   * from a Buffer containing image data. This is useful when artwork
   * is already loaded in memory (e.g., extracted from audio file metadata).
   *
   * @param handle Handle of the track to set artwork for
   * @param imageData Buffer containing image data (JPEG or PNG)
   * @returns The updated track metadata with hasArtwork set to true
   * @throws LibgpodError if setting artwork fails
   *
   * @example
   * ```typescript
   * // Read image data from file
   * const imageData = await fs.readFile('/path/to/artwork.jpg');
   * db.setTrackArtworkFromData(handle, imageData);
   * await db.save();
   * ```
   */
  setTrackArtworkFromData(handle: TrackHandle, imageData: Buffer): Track {
    const native = this.ensureOpen();
    try {
      return native.setTrackThumbnailsFromData(handle.index, imageData);
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
   * @param handle Handle of the track to set artwork for
   * @param imageData Buffer containing image data
   * @returns The updated track metadata with hasArtwork set to true
   */
  async setTrackArtworkFromDataAsync(handle: TrackHandle, imageData: Buffer): Promise<Track> {
    return this.setTrackArtworkFromData(handle, imageData);
  }

  /**
   * Remove artwork from a track.
   *
   * This removes all thumbnails associated with the track.
   * Changes take effect when save() is called.
   *
   * @param handle Handle of the track to remove artwork from
   * @returns The updated track metadata with hasArtwork set to false
   * @throws LibgpodError if the handle is invalid
   *
   * @example
   * ```typescript
   * const track = db.getTrack(handle);
   * if (track.hasArtwork) {
   *   db.removeTrackArtwork(handle);
   *   await db.save();
   * }
   * ```
   */
  removeTrackArtwork(handle: TrackHandle): Track {
    const native = this.ensureOpen();
    try {
      return native.removeTrackThumbnails(handle.index);
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
   * @param handle Handle of the track to check
   * @returns True if the track has artwork
   * @throws LibgpodError if the handle is invalid
   *
   * @example
   * ```typescript
   * const hasArtwork = db.hasTrackArtwork(handle);
   * if (!hasArtwork) {
   *   // Set artwork from source file
   *   db.setTrackArtwork(handle, artworkPath);
   * }
   * ```
   */
  hasTrackArtwork(handle: TrackHandle): boolean {
    const native = this.ensureOpen();
    try {
      return native.hasTrackThumbnails(handle.index);
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
   * @param track Handle of the track to add
   * @returns The updated playlist
   * @throws LibgpodError if the playlist is not found or handle is invalid
   *
   * @example
   * ```typescript
   * const playlist = db.getPlaylistByName('Favorites');
   * const handles = db.getTracks();
   * const handle = handles.find(h => db.getTrack(h).title === 'Great Song');
   * if (playlist && handle) {
   *   db.addTrackToPlaylist(playlist.id, handle);
   *   await db.save();
   * }
   * ```
   */
  addTrackToPlaylist(playlistId: bigint, track: TrackHandle): Playlist {
    const native = this.ensureOpen();
    try {
      return native.addTrackToPlaylist(playlistId, track.index);
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
   * @param track Handle of the track to remove
   * @returns The updated playlist
   * @throws LibgpodError if the playlist is not found or handle is invalid
   *
   * @example
   * ```typescript
   * const playlist = db.getPlaylistByName('Favorites');
   * if (playlist && db.playlistContainsTrack(playlist.id, handle)) {
   *   db.removeTrackFromPlaylist(playlist.id, handle);
   *   await db.save();
   * }
   * ```
   */
  removeTrackFromPlaylist(playlistId: bigint, track: TrackHandle): Playlist {
    const native = this.ensureOpen();
    try {
      return native.removeTrackFromPlaylist(playlistId, track.index);
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
   * @param track Handle of the track
   * @returns True if the playlist contains the track
   * @throws LibgpodError if the playlist is not found or handle is invalid
   *
   * @example
   * ```typescript
   * const playlist = db.getPlaylistByName('Favorites');
   * if (playlist && db.playlistContainsTrack(playlist.id, handle)) {
   *   console.log('Track is in Favorites');
   * }
   * ```
   */
  playlistContainsTrack(playlistId: bigint, track: TrackHandle): boolean {
    const native = this.ensureOpen();
    try {
      return native.playlistContainsTrack(playlistId, track.index);
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
   * @returns Array of track handles in the playlist
   * @throws LibgpodError if the playlist is not found
   *
   * @example
   * ```typescript
   * const playlist = db.getPlaylistByName('Favorites');
   * if (playlist) {
   *   const handles = db.getPlaylistTracks(playlist.id);
   *   for (const handle of handles) {
   *     const track = db.getTrack(handle);
   *     console.log(`${track.artist} - ${track.title}`);
   *   }
   * }
   * ```
   */
  getPlaylistTracks(playlistId: bigint): TrackHandle[] {
    const native = this.ensureOpen();
    try {
      return native.getPlaylistTracks(playlistId).map((index) => this.createHandle(index));
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

  // ============================================================================
  // Smart playlist operations
  // ============================================================================

  /**
   * Create a new smart playlist.
   *
   * Smart playlists use rules to automatically include tracks that match
   * certain criteria (e.g., "all songs by Artist X" or "songs rated 4+ stars").
   *
   * Note: The iPod firmware evaluates smart playlist rules at playback time.
   * The `evaluateSmartPlaylist()` method can be used to preview which tracks
   * would match the rules.
   *
   * @param input Smart playlist configuration
   * @returns The created smart playlist
   * @throws LibgpodError if creation fails
   *
   * @example
   * ```typescript
   * import { SPLField, SPLAction, SPLMatch } from '@podkit/libgpod-node';
   *
   * // Create a smart playlist for all rock songs
   * const rockPlaylist = db.createSmartPlaylist({
   *   name: 'Rock Music',
   *   match: SPLMatch.And,
   *   rules: [
   *     { field: SPLField.Genre, action: SPLAction.Contains, string: 'Rock' }
   *   ]
   * });
   *
   * // Create a smart playlist for highly rated songs
   * const topRated = db.createSmartPlaylist({
   *   name: 'Top Rated',
   *   rules: [
   *     { field: SPLField.Rating, action: SPLAction.IsGreaterThan, fromValue: 80 }
   *   ],
   *   preferences: {
   *     liveUpdate: true,
   *     checkLimits: true,
   *     limitType: SPLLimitType.Songs,
   *     limitValue: 50
   *   }
   * });
   *
   * await db.save();
   * ```
   */
  createSmartPlaylist(input: SmartPlaylistInput): SmartPlaylist {
    const native = this.ensureOpen();
    try {
      return native.createSmartPlaylist(input.name, {
        match: input.match,
        rules: input.rules,
        preferences: input.preferences,
      });
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'createSmartPlaylist'
      );
    }
  }

  /**
   * Get the rules of a smart playlist.
   *
   * @param playlistId ID of the smart playlist
   * @returns Array of rules
   * @throws LibgpodError if the playlist is not found or is not a smart playlist
   *
   * @example
   * ```typescript
   * const playlist = db.getPlaylistByName('Rock Music');
   * if (playlist && playlist.isSmart) {
   *   const rules = db.getSmartPlaylistRules(playlist.id);
   *   console.log(`Playlist has ${rules.length} rules`);
   * }
   * ```
   */
  getSmartPlaylistRules(playlistId: bigint): SPLRule[] {
    const native = this.ensureOpen();
    try {
      return native.getSmartPlaylistRules(playlistId);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'getSmartPlaylistRules'
      );
    }
  }

  /**
   * Add a rule to a smart playlist.
   *
   * @param playlistId ID of the smart playlist
   * @param rule Rule to add
   * @returns The updated smart playlist
   * @throws LibgpodError if the playlist is not found or is not a smart playlist
   *
   * @example
   * ```typescript
   * import { SPLField, SPLAction } from '@podkit/libgpod-node';
   *
   * const playlist = db.getPlaylistByName('My Smart Playlist');
   * if (playlist && playlist.isSmart) {
   *   db.addSmartPlaylistRule(playlist.id, {
   *     field: SPLField.Artist,
   *     action: SPLAction.Contains,
   *     string: 'Beatles'
   *   });
   *   await db.save();
   * }
   * ```
   */
  addSmartPlaylistRule(playlistId: bigint, rule: SPLRule): SmartPlaylist {
    const native = this.ensureOpen();
    try {
      return native.addSmartPlaylistRule(playlistId, rule);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'addSmartPlaylistRule'
      );
    }
  }

  /**
   * Remove a rule from a smart playlist by index.
   *
   * @param playlistId ID of the smart playlist
   * @param ruleIndex Index of the rule to remove (0-based)
   * @returns The updated smart playlist
   * @throws LibgpodError if the playlist is not found, is not a smart playlist,
   *         or the rule index is out of range
   *
   * @example
   * ```typescript
   * const playlist = db.getPlaylistByName('My Smart Playlist');
   * if (playlist && playlist.isSmart) {
   *   // Remove the first rule
   *   db.removeSmartPlaylistRule(playlist.id, 0);
   *   await db.save();
   * }
   * ```
   */
  removeSmartPlaylistRule(playlistId: bigint, ruleIndex: number): SmartPlaylist {
    const native = this.ensureOpen();
    try {
      return native.removeSmartPlaylistRule(playlistId, ruleIndex);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'removeSmartPlaylistRule'
      );
    }
  }

  /**
   * Remove all rules from a smart playlist.
   *
   * @param playlistId ID of the smart playlist
   * @returns The updated smart playlist
   * @throws LibgpodError if the playlist is not found or is not a smart playlist
   *
   * @example
   * ```typescript
   * const playlist = db.getPlaylistByName('My Smart Playlist');
   * if (playlist && playlist.isSmart) {
   *   db.clearSmartPlaylistRules(playlist.id);
   *   await db.save();
   * }
   * ```
   */
  clearSmartPlaylistRules(playlistId: bigint): SmartPlaylist {
    const native = this.ensureOpen();
    try {
      return native.clearSmartPlaylistRules(playlistId);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'clearSmartPlaylistRules'
      );
    }
  }

  /**
   * Get the preferences of a smart playlist.
   *
   * @param playlistId ID of the smart playlist
   * @returns Smart playlist preferences
   * @throws LibgpodError if the playlist is not found or is not a smart playlist
   *
   * @example
   * ```typescript
   * const playlist = db.getPlaylistByName('My Smart Playlist');
   * if (playlist && playlist.isSmart) {
   *   const prefs = db.getSmartPlaylistPreferences(playlist.id);
   *   console.log(`Live update: ${prefs.liveUpdate}`);
   * }
   * ```
   */
  getSmartPlaylistPreferences(playlistId: bigint): SPLPreferences {
    const native = this.ensureOpen();
    try {
      return native.getSmartPlaylistPreferences(playlistId);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'getSmartPlaylistPreferences'
      );
    }
  }

  /**
   * Set the preferences of a smart playlist.
   *
   * @param playlistId ID of the smart playlist
   * @param preferences Preferences to set (partial update)
   * @returns The updated smart playlist
   * @throws LibgpodError if the playlist is not found or is not a smart playlist
   *
   * @example
   * ```typescript
   * import { SPLLimitType, SPLLimitSort } from '@podkit/libgpod-node';
   *
   * const playlist = db.getPlaylistByName('My Smart Playlist');
   * if (playlist && playlist.isSmart) {
   *   db.setSmartPlaylistPreferences(playlist.id, {
   *     checkLimits: true,
   *     limitType: SPLLimitType.Songs,
   *     limitValue: 100,
   *     limitSort: SPLLimitSort.Random
   *   });
   *   await db.save();
   * }
   * ```
   */
  setSmartPlaylistPreferences(
    playlistId: bigint,
    preferences: Partial<SPLPreferences>
  ): SmartPlaylist {
    const native = this.ensureOpen();
    try {
      return native.setSmartPlaylistPreferences(playlistId, preferences);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'setSmartPlaylistPreferences'
      );
    }
  }

  /**
   * Evaluate a smart playlist's rules against all tracks in the database.
   *
   * This method simulates what the iPod does at playback time by evaluating
   * the smart playlist rules against all tracks and returning those that match.
   *
   * Note: This is a preview/testing feature. On the actual iPod, the firmware
   * evaluates rules dynamically.
   *
   * @param playlistId ID of the smart playlist
   * @returns Array of track handles that match the rules
   * @throws LibgpodError if the playlist is not found or is not a smart playlist
   *
   * @example
   * ```typescript
   * const playlist = db.getPlaylistByName('Rock Music');
   * if (playlist && playlist.isSmart) {
   *   const matchingHandles = db.evaluateSmartPlaylist(playlist.id);
   *   console.log(`${matchingHandles.length} tracks match the rules`);
   *   for (const handle of matchingHandles) {
   *     const track = db.getTrack(handle);
   *     console.log(`  - ${track.artist} - ${track.title}`);
   *   }
   * }
   * ```
   */
  evaluateSmartPlaylist(playlistId: bigint): TrackHandle[] {
    const native = this.ensureOpen();
    try {
      return native.evaluateSmartPlaylist(playlistId).map((index) => this.createHandle(index));
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'evaluateSmartPlaylist'
      );
    }
  }

  /**
   * Get all smart playlists in the database.
   *
   * @returns Array of smart playlists
   *
   * @example
   * ```typescript
   * const smartPlaylists = db.getSmartPlaylists();
   * for (const pl of smartPlaylists) {
   *   console.log(`${pl.name}: ${pl.rules.length} rules`);
   * }
   * ```
   */
  getSmartPlaylists(): Playlist[] {
    return this.getPlaylists().filter((p) => p.isSmart);
  }

  // ============================================================================
  // Device capability operations
  // ============================================================================

  /**
   * Get detailed device capability information.
   *
   * Returns information about what features the connected iPod supports,
   * including artwork, video, photo, podcast, and chapter image support.
   * Also includes device identification information.
   *
   * This method exposes libgpod's device capability checking APIs:
   * - `itdb_device_supports_artwork()`
   * - `itdb_device_supports_video()`
   * - `itdb_device_supports_photo()`
   * - `itdb_device_supports_podcast()`
   * - `itdb_device_supports_chapter_image()`
   *
   * @returns Device capabilities object
   *
   * @example
   * ```typescript
   * const db = Database.openSync('/media/ipod');
   * const caps = db.getDeviceCapabilities();
   *
   * if (caps.supportsVideo) {
   *   console.log('This iPod can play videos');
   * }
   *
   * if (caps.supportsPodcast) {
   *   console.log('This iPod supports podcasts');
   * }
   *
   * console.log(`Device: ${caps.modelName} (${caps.generation})`);
   * ```
   */
  getDeviceCapabilities(): DeviceCapabilities {
    const native = this.ensureOpen();
    return native.getDeviceCapabilities();
  }

  /**
   * Get a SysInfo field value from the device.
   *
   * The SysInfo file on the iPod contains key-value pairs with device
   * information. Common fields include:
   * - `ModelNumStr` - Device model number (e.g., "MA147")
   * - `FirewireGuid` - Device unique identifier
   * - `buildID` - Firmware build ID
   * - `visibleBuildID` - Visible firmware version
   * - `BoardHwName` - Hardware board name
   * - `RegionCode` - Device region
   * - `PolicyFlags` - Policy settings
   *
   * @param field The SysInfo field name to retrieve
   * @returns The field value, or null if the field doesn't exist
   *
   * @example
   * ```typescript
   * const db = Database.openSync('/media/ipod');
   *
   * const modelNum = db.getSysInfo('ModelNumStr');
   * console.log(`Model number: ${modelNum}`);
   *
   * const firewireId = db.getSysInfo('FirewireGuid');
   * console.log(`Firewire GUID: ${firewireId}`);
   * ```
   */
  getSysInfo(field: string): string | null {
    const native = this.ensureOpen();
    try {
      return native.getSysInfo(field);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'getSysInfo'
      );
    }
  }

  /**
   * Set a SysInfo field value on the device.
   *
   * This modifies the in-memory SysInfo data. The changes are written
   * to the iPod's SysInfo file when the database is saved with `save()`.
   *
   * **Warning:** Modifying SysInfo can affect device behavior and compatibility.
   * Only modify fields if you understand their purpose. The most common
   * safe use case is setting `ModelNumStr` for device identification.
   *
   * Pass `null` as the value to remove a field from SysInfo.
   *
   * @param field The SysInfo field name to set
   * @param value The value to set, or null to remove the field
   *
   * @example
   * ```typescript
   * const db = Database.openSync('/media/ipod');
   *
   * // Set model number (commonly done for device identification)
   * db.setSysInfo('ModelNumStr', 'MA147');
   *
   * // Remove a field
   * db.setSysInfo('SomeField', null);
   *
   * // Save changes to write SysInfo to device
   * await db.save();
   * ```
   */
  setSysInfo(field: string, value: string | null): void {
    const native = this.ensureOpen();
    try {
      native.setSysInfo(field, value);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'setSysInfo'
      );
    }
  }

  // ============================================================================
  // Chapter data operations (for podcasts and audiobooks)
  // ============================================================================

  /**
   * Get chapter markers for a track.
   *
   * Chapters provide navigation points within a track, commonly used for
   * podcasts (mediaType = 4) and audiobooks (mediaType = 8).
   *
   * @param handle Handle of the track
   * @returns Array of chapters, or empty array if no chapters exist
   * @throws LibgpodError if the handle is invalid
   *
   * @example
   * ```typescript
   * import { MediaType } from '@podkit/libgpod-node';
   *
   * const track = db.getTrack(handle);
   * if (track.mediaType & MediaType.Podcast) {
   *   const chapters = db.getTrackChapters(handle);
   *   for (const chapter of chapters) {
   *     console.log(`${chapter.startPos}ms: ${chapter.title}`);
   *   }
   * }
   * ```
   */
  getTrackChapters(handle: TrackHandle): Chapter[] {
    const native = this.ensureOpen();
    try {
      return native.getTrackChapters(handle.index);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'getTrackChapters'
      );
    }
  }

  /**
   * Set all chapters for a track, replacing any existing chapters.
   *
   * This is typically used when importing a podcast or audiobook that
   * already has chapter data embedded in its metadata.
   *
   * Note: The first chapter's startPos should be 0 (will be converted to 1
   * by libgpod, as that's the minimum valid start position).
   *
   * @param handle Handle of the track
   * @param chapters Array of chapter definitions
   * @returns The chapters as stored (startPos may be adjusted)
   * @throws LibgpodError if the handle is invalid
   *
   * @example
   * ```typescript
   * import { MediaType } from '@podkit/libgpod-node';
   *
   * // Add a podcast episode with chapters
   * const handle = db.addTrack({
   *   title: 'Podcast Episode 1',
   *   mediaType: MediaType.Podcast,
   * });
   *
   * db.setTrackChapters(handle, [
   *   { startPos: 0, title: 'Introduction' },
   *   { startPos: 60000, title: 'Topic 1' },
   *   { startPos: 300000, title: 'Topic 2' },
   *   { startPos: 600000, title: 'Conclusion' },
   * ]);
   *
   * await db.save();
   * ```
   */
  setTrackChapters(handle: TrackHandle, chapters: ChapterInput[]): Chapter[] {
    const native = this.ensureOpen();
    try {
      return native.setTrackChapters(handle.index, chapters);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'setTrackChapters'
      );
    }
  }

  /**
   * Add a single chapter to a track.
   *
   * Chapters are appended to the existing chapter list. For best results,
   * add chapters in chronological order (ascending start times).
   *
   * @param handle Handle of the track
   * @param startPos Start position in milliseconds (0 will be converted to 1)
   * @param title Chapter title
   * @returns All chapters after adding the new one
   * @throws LibgpodError if the handle is invalid
   *
   * @example
   * ```typescript
   * // Add chapters one by one
   * db.addTrackChapter(handle, 0, 'Introduction');
   * db.addTrackChapter(handle, 120000, 'Chapter 1');
   * db.addTrackChapter(handle, 360000, 'Chapter 2');
   *
   * await db.save();
   * ```
   */
  addTrackChapter(handle: TrackHandle, startPos: number, title: string): Chapter[] {
    const native = this.ensureOpen();
    try {
      return native.addTrackChapter(handle.index, startPos, title);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'addTrackChapter'
      );
    }
  }

  /**
   * Remove all chapters from a track.
   *
   * @param handle Handle of the track
   * @throws LibgpodError if the handle is invalid
   *
   * @example
   * ```typescript
   * // Remove chapters from a track
   * db.clearTrackChapters(handle);
   * await db.save();
   * ```
   */
  clearTrackChapters(handle: TrackHandle): void {
    const native = this.ensureOpen();
    try {
      native.clearTrackChapters(handle.index);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'clearTrackChapters'
      );
    }
  }

  /**
   * Ensure the database is closed when garbage collected.
   */
  [Symbol.dispose](): void {
    this.close();
  }
}
