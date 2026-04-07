/**
 * Firmware type definitions for the iPod menu system.
 *
 * The IpodDatabase interface is a minimal contract that the menu system
 * depends on. It will be implemented by IpodReader from @podkit/ipod-db
 * once that package exists (TASK-266).
 */

// ---------------------------------------------------------------------------
// Database types
// ---------------------------------------------------------------------------

export interface Track {
  id: number;
  title: string;
  artist: string;
  album: string;
  genre: string;
  duration: number; // milliseconds
  trackNumber: number;
  ipodPath?: string | null;
}

export interface Album {
  name: string;
  artist: string;
  trackIds: number[];
}

export interface Playlist {
  name: string;
  id: bigint;
  trackCount: number;
}

/**
 * Minimal database interface consumed by the menu system.
 *
 * Implementations must return data synchronously — the expectation is that
 * the database has already been loaded into memory by the StorageProvider.
 */
export interface IpodDatabase {
  getTracks(): Track[];
  getArtists(): string[];
  getAlbums(): Album[];
  getGenres(): string[];
  getPlaylists(): Playlist[];
  getPlaylistTracks(id: bigint): Track[];
  getTracksByArtist(artist: string): Track[];
  getTracksByAlbum(artist: string, album: string): Track[];
  getTracksByGenre(genre: string): Track[];
  getTrackArtwork(trackId: number): { width: number; height: number; data: Uint8Array } | null;
}

// ---------------------------------------------------------------------------
// Menu system types
// ---------------------------------------------------------------------------

export type ScreenId = 'menu' | 'nowPlaying';

export interface MenuItem {
  /** Primary label displayed on the left. */
  label: string;
  /** Optional right-aligned secondary text (e.g. track count). */
  detail?: string;
  /** When true, a chevron (›) is shown to indicate a submenu. */
  hasSubmenu?: boolean;
  /** Fired when the item is selected (center-button press). */
  action?: () => void;
}

export interface MenuLevel {
  /** Title shown in the header bar. */
  title: string;
  /** Returns the list of items to display. Called each time the menu is shown. */
  getItems: () => MenuItem[];
  /** Called when the user selects an item by index. */
  onSelect: (index: number) => void;
}
