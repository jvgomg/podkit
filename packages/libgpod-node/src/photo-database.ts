/**
 * High-level TypeScript wrapper for iPod photo database operations.
 *
 * PhotoDatabase is a SEPARATE database from the music Database.
 * They can be opened and operated on independently.
 *
 * The photo database stores photos that can be synced to iPods with
 * photo display capability (iPod Photo, iPod Video, iPod Classic, etc.).
 */

import {
  parsePhotoDb as nativeParsePhotoDb,
  createPhotoDb as nativeCreatePhotoDb,
  type NativePhotoDatabase,
} from './binding';

import type {
  Photo,
  PhotoAlbum,
  PhotoDatabaseInfo,
  DeviceInfo,
  DeviceCapabilities,
} from './types';

import { LibgpodError, LibgpodErrorCode } from './types';

/**
 * Represents an iPod photo database connection.
 *
 * Use `PhotoDatabase.open()` to parse an existing photo database,
 * or `PhotoDatabase.create()` to create a new one.
 *
 * Note: This is a SEPARATE database from the music database (Database class).
 * Photos are stored in a different location on the iPod and have their own
 * database file.
 *
 * @example
 * ```typescript
 * const photoDb = await PhotoDatabase.open('/media/ipod');
 * console.log(`Found ${photoDb.photoCount} photos`);
 *
 * // Add a photo
 * const photo = photoDb.addPhoto('/path/to/image.jpg');
 * console.log(`Added photo with ID: ${photo.id}`);
 *
 * // Create an album
 * const album = photoDb.createAlbum('Vacation');
 * photoDb.addPhotoToAlbum(album.id, photo.id);
 *
 * await photoDb.save();
 * photoDb.close();
 * ```
 */
export class PhotoDatabase {
  private native: NativePhotoDatabase | null;
  private _mountpoint: string;
  private _closed = false;

  private constructor(native: NativePhotoDatabase, mountpoint: string) {
    this.native = native;
    this._mountpoint = mountpoint;
  }

  /**
   * Open an iPod photo database from a mount point.
   *
   * @param mountpoint Path to the iPod mount point (e.g., "/media/ipod")
   * @returns PhotoDatabase instance
   * @throws LibgpodError if the database cannot be parsed
   */
  static async open(mountpoint: string): Promise<PhotoDatabase> {
    try {
      const native = nativeParsePhotoDb(mountpoint);
      return new PhotoDatabase(native, mountpoint);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.NotFound,
        'parsePhotoDb'
      );
    }
  }

  /**
   * Synchronous version of open() for cases where async is not needed.
   *
   * @param mountpoint Path to the iPod mount point
   * @returns PhotoDatabase instance
   * @throws LibgpodError if the database cannot be parsed
   */
  static openSync(mountpoint: string): PhotoDatabase {
    try {
      const native = nativeParsePhotoDb(mountpoint);
      return new PhotoDatabase(native, mountpoint);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.NotFound,
        'parsePhotoDb'
      );
    }
  }

  /**
   * Create a new empty iPod photo database.
   *
   * Creates a fresh photo database. If mountpoint is provided, the database
   * is associated with that iPod. Otherwise, use `setMountpoint()` later.
   *
   * The Photo Library album is created automatically as the first album.
   *
   * @param mountpoint Optional path to the iPod mount point
   * @returns PhotoDatabase instance
   * @throws LibgpodError if creation fails
   *
   * @example
   * ```typescript
   * // Create with mountpoint
   * const photoDb = PhotoDatabase.create('/media/ipod');
   *
   * // Or create without and set later
   * const photoDb = PhotoDatabase.create();
   * photoDb.setMountpoint('/media/ipod');
   * ```
   */
  static create(mountpoint?: string): PhotoDatabase {
    try {
      const native = nativeCreatePhotoDb(mountpoint);
      return new PhotoDatabase(native, mountpoint ?? '');
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'createPhotoDb'
      );
    }
  }

  /**
   * Ensure the database is open.
   */
  private ensureOpen(): NativePhotoDatabase {
    if (this._closed || !this.native) {
      throw new LibgpodError(
        'PhotoDatabase is closed',
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
   * Set the mountpoint for the database.
   *
   * @param mountpoint Path to the iPod mount point
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
   * Get photo database information.
   */
  getInfo(): PhotoDatabaseInfo {
    const native = this.ensureOpen();
    return native.getInfo();
  }

  /**
   * Number of photos in the database.
   */
  get photoCount(): number {
    return this.getInfo().photoCount;
  }

  /**
   * Number of photo albums in the database.
   */
  get albumCount(): number {
    return this.getInfo().albumCount;
  }

  /**
   * Device information.
   */
  get device(): DeviceInfo | null {
    return this.getInfo().device;
  }

  // ============================================================================
  // Photo operations
  // ============================================================================

  /**
   * Get all photos in the database.
   *
   * @returns Array of photo metadata
   */
  getPhotos(): Photo[] {
    const native = this.ensureOpen();
    return native.getPhotos();
  }

  /**
   * Get a photo by its ID.
   *
   * @param photoId Photo ID
   * @returns Photo or null if not found
   */
  getPhotoById(photoId: number): Photo | null {
    const native = this.ensureOpen();
    return native.getPhotoById(photoId);
  }

  /**
   * Add a photo from a file.
   *
   * The photo is automatically added to the Photo Library album.
   * libgpod handles resizing to appropriate thumbnail sizes for the device.
   *
   * @param imagePath Path to the image file (JPEG, PNG, etc.)
   * @param position Position to insert (-1 to append)
   * @param rotation Rotation angle (0, 90, 180, 270)
   * @returns The added photo metadata
   * @throws LibgpodError if the device doesn't support photos or the image can't be read
   *
   * @example
   * ```typescript
   * const photo = photoDb.addPhoto('/path/to/vacation.jpg');
   * console.log(`Added photo: ${photo.id}`);
   * await photoDb.save();
   * ```
   */
  addPhoto(imagePath: string, position = -1, rotation = 0): Photo {
    const native = this.ensureOpen();
    try {
      return native.addPhoto(imagePath, position, rotation);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'addPhoto'
      );
    }
  }

  /**
   * Add a photo from image data in memory.
   *
   * @param imageData Buffer containing image data
   * @param position Position to insert (-1 to append)
   * @param rotation Rotation angle (0, 90, 180, 270)
   * @returns The added photo metadata
   * @throws LibgpodError if the device doesn't support photos or the image data is invalid
   *
   * @example
   * ```typescript
   * const imageData = await fs.readFile('/path/to/image.jpg');
   * const photo = photoDb.addPhotoFromData(imageData);
   * await photoDb.save();
   * ```
   */
  addPhotoFromData(imageData: Buffer, position = -1, rotation = 0): Photo {
    const native = this.ensureOpen();
    try {
      return native.addPhotoFromData(imageData, position, rotation);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'addPhotoFromData'
      );
    }
  }

  /**
   * Remove a photo from the database.
   *
   * This removes the photo from all albums and deletes it from the database.
   *
   * @param photoId ID of the photo to remove
   * @throws LibgpodError if the photo is not found
   *
   * @example
   * ```typescript
   * photoDb.removePhoto(photoId);
   * await photoDb.save();
   * ```
   */
  removePhoto(photoId: number): void {
    const native = this.ensureOpen();
    try {
      native.removePhoto(photoId);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.NotFound,
        'removePhoto'
      );
    }
  }

  // ============================================================================
  // Photo album operations
  // ============================================================================

  /**
   * Get all photo albums in the database.
   *
   * The first album is always the Photo Library, which contains all photos.
   *
   * @returns Array of photo albums
   */
  getAlbums(): PhotoAlbum[] {
    const native = this.ensureOpen();
    return native.getPhotoAlbums();
  }

  /**
   * Get the Photo Library album.
   *
   * The Photo Library is the master album that contains all photos.
   * It is always the first album and cannot be deleted.
   *
   * @returns The Photo Library album or null if not found (shouldn't happen)
   */
  getPhotoLibrary(): PhotoAlbum | null {
    const native = this.ensureOpen();
    return native.getPhotoAlbumByName(null);
  }

  /**
   * Find a photo album by name.
   *
   * @param name Album name to search for (pass null to get Photo Library)
   * @returns PhotoAlbum or null if not found
   *
   * @example
   * ```typescript
   * const vacation = photoDb.getAlbumByName('Vacation');
   * if (vacation) {
   *   console.log(`Found album with ${vacation.photoCount} photos`);
   * }
   * ```
   */
  getAlbumByName(name: string | null): PhotoAlbum | null {
    const native = this.ensureOpen();
    return native.getPhotoAlbumByName(name);
  }

  /**
   * Create a new photo album.
   *
   * @param name Name for the new album
   * @param position Position to insert (-1 to append)
   * @returns The created album
   * @throws LibgpodError if creation fails
   *
   * @example
   * ```typescript
   * const album = photoDb.createAlbum('Vacation 2024');
   * console.log(`Created album: ${album.name}`);
   * await photoDb.save();
   * ```
   */
  createAlbum(name: string, position = -1): PhotoAlbum {
    const native = this.ensureOpen();
    try {
      return native.createPhotoAlbum(name, position);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'createPhotoAlbum'
      );
    }
  }

  /**
   * Remove a photo album.
   *
   * Note: The Photo Library (first album) cannot be deleted.
   *
   * @param albumId ID of the album to remove
   * @param removePhotos If true, also remove photos from the database (not just the album)
   * @throws LibgpodError if the album is not found or is the Photo Library
   *
   * @example
   * ```typescript
   * // Remove album but keep photos in Photo Library
   * photoDb.removeAlbum(albumId, false);
   *
   * // Remove album and delete all its photos
   * photoDb.removeAlbum(albumId, true);
   *
   * await photoDb.save();
   * ```
   */
  removeAlbum(albumId: number, removePhotos = false): void {
    const native = this.ensureOpen();
    try {
      native.removePhotoAlbum(albumId, removePhotos);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.Unknown,
        'removePhotoAlbum'
      );
    }
  }

  /**
   * Rename a photo album.
   *
   * @param albumId ID of the album to rename
   * @param newName New name for the album
   * @returns The updated album
   * @throws LibgpodError if the album is not found
   *
   * @example
   * ```typescript
   * const album = photoDb.renameAlbum(albumId, 'Summer Vacation 2024');
   * await photoDb.save();
   * ```
   */
  renameAlbum(albumId: number, newName: string): PhotoAlbum {
    const native = this.ensureOpen();
    try {
      return native.setPhotoAlbumName(albumId, newName);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.NotFound,
        'setPhotoAlbumName'
      );
    }
  }

  /**
   * Add a photo to an album.
   *
   * Photos are automatically added to the Photo Library when first added
   * via addPhoto(). Use this method to add them to additional albums.
   *
   * @param albumId ID of the album
   * @param photoId ID of the photo to add
   * @param position Position to insert (-1 to append)
   * @returns The updated album
   * @throws LibgpodError if the album or photo is not found
   *
   * @example
   * ```typescript
   * const album = photoDb.getAlbumByName('Favorites');
   * if (album) {
   *   photoDb.addPhotoToAlbum(album.id, photo.id);
   *   await photoDb.save();
   * }
   * ```
   */
  addPhotoToAlbum(albumId: number, photoId: number, position = -1): PhotoAlbum {
    const native = this.ensureOpen();
    try {
      return native.addPhotoToAlbum(albumId, photoId, position);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.NotFound,
        'addPhotoToAlbum'
      );
    }
  }

  /**
   * Remove a photo from an album.
   *
   * This only removes the photo from the specified album, not from the
   * database. To delete a photo completely, use removePhoto().
   *
   * Note: Removing from the Photo Library removes from all albums.
   *
   * @param albumId ID of the album
   * @param photoId ID of the photo to remove
   * @returns The updated album
   * @throws LibgpodError if the album or photo is not found
   *
   * @example
   * ```typescript
   * const album = photoDb.getAlbumByName('Favorites');
   * if (album) {
   *   photoDb.removePhotoFromAlbum(album.id, photoId);
   *   await photoDb.save();
   * }
   * ```
   */
  removePhotoFromAlbum(albumId: number, photoId: number): PhotoAlbum {
    const native = this.ensureOpen();
    try {
      return native.removePhotoFromAlbum(albumId, photoId);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.NotFound,
        'removePhotoFromAlbum'
      );
    }
  }

  /**
   * Get all photos in an album.
   *
   * @param albumId ID of the album
   * @returns Array of photos in the album
   * @throws LibgpodError if the album is not found
   *
   * @example
   * ```typescript
   * const album = photoDb.getAlbumByName('Vacation');
   * if (album) {
   *   const photos = photoDb.getAlbumPhotos(album.id);
   *   for (const photo of photos) {
   *     console.log(`Photo: ${photo.id}`);
   *   }
   * }
   * ```
   */
  getAlbumPhotos(albumId: number): Photo[] {
    const native = this.ensureOpen();
    try {
      return native.getPhotoAlbumPhotos(albumId);
    } catch (error) {
      throw new LibgpodError(
        error instanceof Error ? error.message : String(error),
        LibgpodErrorCode.NotFound,
        'getPhotoAlbumPhotos'
      );
    }
  }

  // ============================================================================
  // Device capability operations
  // ============================================================================

  /**
   * Get device capability information.
   *
   * Check if the connected iPod supports photos and other features.
   *
   * @returns Device capabilities object
   *
   * @example
   * ```typescript
   * const caps = photoDb.getDeviceCapabilities();
   * if (!caps.supportsPhoto) {
   *   console.log('This iPod does not support photos');
   * }
   * ```
   */
  getDeviceCapabilities(): DeviceCapabilities {
    const native = this.ensureOpen();
    return native.getDeviceCapabilities();
  }

  /**
   * Set a SysInfo field value on the device.
   *
   * This is commonly used to set the model number, which is required
   * for adding photos to an iPod.
   *
   * @param field The SysInfo field name to set
   * @param value The value to set, or null to remove the field
   *
   * @example
   * ```typescript
   * // Set model number (required for photos on some iPods)
   * photoDb.setSysInfo('ModelNumStr', 'MA450');
   * await photoDb.save();
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
  // Database operations
  // ============================================================================

  /**
   * Write changes to the iPod photo database.
   *
   * Call this after making modifications to persist changes to disk.
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
   * Ensure the database is closed when garbage collected.
   */
  [Symbol.dispose](): void {
    this.close();
  }
}
