/**
 * Implementation of the IpodPlaylist interface.
 *
 * This class wraps libgpod-node's playlist operations and provides
 * fluent methods for playlist manipulation.
 */

import type { Playlist } from '@podkit/libgpod-node';
import type { IpodPlaylist, IpodTrack } from './types.js';
import { IpodError } from './errors.js';

/**
 * Internal interface for IpodDatabase playlist operations.
 *
 * This interface defines the methods that IpodPlaylistImpl needs from
 * the parent database. It's used to avoid circular dependencies between
 * the playlist and database modules.
 */
export interface PlaylistDatabaseInternal {
  renamePlaylist(playlist: IpodPlaylist, newName: string): IpodPlaylist;
  removePlaylist(playlist: IpodPlaylist): void;
  getPlaylistTracks(playlist: IpodPlaylist): IpodTrack[];
  addTrackToPlaylist(playlist: IpodPlaylist, track: IpodTrack): IpodPlaylist;
  removeTrackFromPlaylist(playlist: IpodPlaylist, track: IpodTrack): IpodPlaylist;
  playlistContainsTrack(playlist: IpodPlaylist, track: IpodTrack): boolean;
}

/**
 * Implementation of IpodPlaylist that wraps libgpod-node's playlist operations.
 *
 * Playlist objects are **snapshots** of playlist data at the time they were
 * retrieved. Operations that modify the playlist return a new IpodPlaylistImpl
 * snapshot reflecting the changes.
 *
 * Methods delegate to the parent IpodDatabase for actual operations, maintaining
 * a clean separation of concerns.
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
export class IpodPlaylistImpl implements IpodPlaylist {
  // Internal state
  private readonly _db: PlaylistDatabaseInternal;
  private readonly _playlistId: bigint;
  private _removed: boolean = false;

  // Read-only properties from Playlist snapshot
  readonly name: string;
  readonly trackCount: number;
  readonly isMaster: boolean;
  readonly isSmart: boolean;
  readonly isPodcasts: boolean;
  readonly timestamp: number;

  /**
   * Creates a new IpodPlaylistImpl instance.
   *
   * @param db The parent database instance
   * @param playlistId The playlist ID (bigint)
   * @param data Playlist data snapshot from libgpod-node
   */
  constructor(db: PlaylistDatabaseInternal, playlistId: bigint, data: Playlist) {
    this._db = db;
    this._playlistId = playlistId;
    // Copy all fields from Playlist, using empty string for null name
    this.name = data.name ?? '';
    this.trackCount = data.trackCount;
    this.isMaster = data.isMaster;
    this.isSmart = data.isSmart;
    this.isPodcasts = data.isPodcasts;
    this.timestamp = data.timestamp;
  }

  /**
   * Asserts that the playlist has not been removed.
   *
   * @throws {IpodError} If the playlist has been removed (code: PLAYLIST_REMOVED)
   */
  private assertNotRemoved(): void {
    if (this._removed) {
      throw new IpodError('Playlist has been removed', 'PLAYLIST_REMOVED');
    }
  }

  /**
   * Gets the internal playlist ID.
   *
   * This is used by IpodDatabase to identify which playlist to operate on.
   */
  get _internalId(): bigint {
    return this._playlistId;
  }

  /**
   * Marks the playlist as removed.
   *
   * This is called by IpodDatabase.removePlaylist() after the playlist
   * has been removed from the database.
   */
  _markRemoved(): void {
    this._removed = true;
  }

  /**
   * Renames the playlist.
   *
   * @param newName New name for the playlist
   * @returns A new IpodPlaylist snapshot with the updated name
   * @throws {IpodError} If the playlist is the master playlist (code: PLAYLIST_REMOVED)
   * @throws {IpodError} If the playlist has been removed (code: PLAYLIST_REMOVED)
   */
  rename(newName: string): IpodPlaylist {
    this.assertNotRemoved();
    if (this.isMaster) {
      throw new IpodError('Cannot rename master playlist', 'PLAYLIST_REMOVED');
    }
    return this._db.renamePlaylist(this, newName);
  }

  /**
   * Removes the playlist from the iPod.
   *
   * After calling this method, subsequent operations on this playlist
   * object will throw an IpodError.
   *
   * @throws {IpodError} If this is the master playlist (code: PLAYLIST_REMOVED)
   * @throws {IpodError} If the playlist has already been removed (code: PLAYLIST_REMOVED)
   */
  remove(): void {
    this.assertNotRemoved();
    if (this.isMaster) {
      throw new IpodError('Cannot remove master playlist', 'PLAYLIST_REMOVED');
    }
    this._db.removePlaylist(this);
  }

  /**
   * Gets all tracks in this playlist.
   *
   * @returns Array of tracks in playlist order
   * @throws {IpodError} If the playlist has been removed (code: PLAYLIST_REMOVED)
   */
  getTracks(): IpodTrack[] {
    this.assertNotRemoved();
    return this._db.getPlaylistTracks(this);
  }

  /**
   * Adds a track to the playlist.
   *
   * @param track Track to add
   * @returns A new IpodPlaylist snapshot with the track added
   * @throws {IpodError} If the playlist or track has been removed
   */
  addTrack(track: IpodTrack): IpodPlaylist {
    this.assertNotRemoved();
    return this._db.addTrackToPlaylist(this, track);
  }

  /**
   * Removes a track from the playlist.
   *
   * Note: This only removes the track from this playlist, not from the iPod.
   *
   * @param track Track to remove
   * @returns A new IpodPlaylist snapshot with the track removed
   * @throws {IpodError} If the playlist has been removed (code: PLAYLIST_REMOVED)
   */
  removeTrack(track: IpodTrack): IpodPlaylist {
    this.assertNotRemoved();
    return this._db.removeTrackFromPlaylist(this, track);
  }

  /**
   * Checks if a track is in this playlist.
   *
   * @param track Track to check
   * @returns true if the track is in the playlist
   * @throws {IpodError} If the playlist has been removed (code: PLAYLIST_REMOVED)
   */
  containsTrack(track: IpodTrack): boolean {
    this.assertNotRemoved();
    return this._db.playlistContainsTrack(this, track);
  }
}
