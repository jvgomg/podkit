import type { Getter, Setter } from 'jotai';
import type { MenuLevel, MenuItem, Track } from './types.js';
import { databaseAtom } from '../store/database.js';
import { shuffleModeAtom, repeatModeAtom } from '../store/settings.js';
import type { ShuffleMode, RepeatMode } from '../store/settings.js';
import { pushMenuAtom, goToNowPlayingAtom, menuVersionAtom } from '../store/navigation.js';
import { currentTrackAtom, playTrackInContextAtom } from '../store/playback.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trackToItem(track: Track): MenuItem {
  return {
    label: track.title,
    detail: formatDuration(track.duration),
  };
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const shuffleLabels: Record<ShuffleMode, string> = {
  off: 'Off',
  songs: 'Songs',
  albums: 'Albums',
};

const repeatLabels: Record<RepeatMode, string> = {
  off: 'Off',
  one: 'One',
  all: 'All',
};

// ---------------------------------------------------------------------------
// Menu builders
// ---------------------------------------------------------------------------

function trackListMenu(title: string, getTracks: () => Track[], set: Setter): MenuLevel {
  return {
    title,
    getItems: () => getTracks().map(trackToItem),
    onSelect: (index) => {
      const tracks = getTracks();
      if (tracks.length === 0) return;
      set(playTrackInContextAtom, { tracks, startIndex: index });
      set(goToNowPlayingAtom);
    },
  };
}

function createPlaylistsMenu(get: Getter, set: Setter): MenuLevel {
  const db = get(databaseAtom);
  return {
    title: 'Playlists',
    getItems: () => {
      if (!db) return [];
      return db.getPlaylists().map((pl) => ({
        label: pl.name,
        detail: String(pl.trackCount),
        hasSubmenu: true,
      }));
    },
    onSelect: (index) => {
      if (!db) return;
      const playlists = db.getPlaylists();
      const pl = playlists[index];
      if (!pl) return;
      set(
        pushMenuAtom,
        trackListMenu(pl.name, () => db.getPlaylistTracks(pl.id), set)
      );
    },
  };
}

function createArtistsMenu(get: Getter, set: Setter): MenuLevel {
  const db = get(databaseAtom);
  return {
    title: 'Artists',
    getItems: () => {
      if (!db) return [];
      return db.getArtists().map((artist) => ({
        label: artist,
        hasSubmenu: true,
      }));
    },
    onSelect: (index) => {
      if (!db) return;
      const artists = db.getArtists();
      const artist = artists[index];
      if (artist === undefined) return;
      set(pushMenuAtom, createArtistAlbumsMenu(get, set, artist));
    },
  };
}

function createArtistAlbumsMenu(get: Getter, set: Setter, artist: string): MenuLevel {
  const db = get(databaseAtom);
  return {
    title: artist,
    getItems: () => {
      if (!db) return [];
      return db
        .getAlbums()
        .filter((a) => a.artist === artist)
        .map((album) => ({
          label: album.name,
          detail: String(album.trackIds.length),
          hasSubmenu: true,
        }));
    },
    onSelect: (index) => {
      if (!db) return;
      const albums = db.getAlbums().filter((a) => a.artist === artist);
      const album = albums[index];
      if (!album) return;
      set(
        pushMenuAtom,
        trackListMenu(album.name, () => db.getTracksByAlbum(artist, album.name), set)
      );
    },
  };
}

function createAlbumsMenu(get: Getter, set: Setter): MenuLevel {
  const db = get(databaseAtom);
  return {
    title: 'Albums',
    getItems: () => {
      if (!db) return [];
      return db.getAlbums().map((album) => ({
        label: album.name,
        detail: album.artist,
        hasSubmenu: true,
      }));
    },
    onSelect: (index) => {
      if (!db) return;
      const albums = db.getAlbums();
      const album = albums[index];
      if (!album) return;
      set(
        pushMenuAtom,
        trackListMenu(album.name, () => db.getTracksByAlbum(album.artist, album.name), set)
      );
    },
  };
}

function createSongsMenu(get: Getter, set: Setter): MenuLevel {
  const db = get(databaseAtom);
  return trackListMenu(
    'Songs',
    () => {
      if (!db) return [];
      return [...db.getTracks()].sort((a, b) => a.title.localeCompare(b.title));
    },
    set
  );
}

function createGenresMenu(get: Getter, set: Setter): MenuLevel {
  const db = get(databaseAtom);
  return {
    title: 'Genres',
    getItems: () => {
      if (!db) return [];
      return db.getGenres().map((genre) => ({
        label: genre,
        hasSubmenu: true,
      }));
    },
    onSelect: (index) => {
      if (!db) return;
      const genres = db.getGenres();
      const genre = genres[index];
      if (genre === undefined) return;
      set(
        pushMenuAtom,
        trackListMenu(genre, () => db.getTracksByGenre(genre), set)
      );
    },
  };
}

function createMusicMenu(get: Getter, set: Setter): MenuLevel {
  return {
    title: 'Music',
    getItems: () => {
      const items: MenuItem[] = [
        { label: 'Playlists', hasSubmenu: true },
        { label: 'Artists', hasSubmenu: true },
        { label: 'Albums', hasSubmenu: true },
        { label: 'Songs', hasSubmenu: true },
        { label: 'Genres', hasSubmenu: true },
      ];
      if (get(currentTrackAtom)) {
        items.push({ label: 'Now Playing' });
      }
      return items;
    },
    onSelect: (index) => {
      const submenus = [
        () => set(pushMenuAtom, createPlaylistsMenu(get, set)),
        () => set(pushMenuAtom, createArtistsMenu(get, set)),
        () => set(pushMenuAtom, createAlbumsMenu(get, set)),
        () => set(pushMenuAtom, createSongsMenu(get, set)),
        () => set(pushMenuAtom, createGenresMenu(get, set)),
      ];
      if (index < submenus.length) {
        submenus[index]!();
      } else {
        // "Now Playing" (only present when a track is loaded)
        set(goToNowPlayingAtom);
      }
    },
  };
}

function createSettingsMenu(get: Getter, set: Setter): MenuLevel {
  return {
    title: 'Settings',
    getItems: () => [
      { label: 'Shuffle', detail: shuffleLabels[get(shuffleModeAtom)] },
      { label: 'Repeat', detail: repeatLabels[get(repeatModeAtom)] },
      { label: 'About', hasSubmenu: true },
    ],
    onSelect: (index) => {
      switch (index) {
        case 0: {
          const modes: ShuffleMode[] = ['off', 'songs', 'albums'];
          const current = modes.indexOf(get(shuffleModeAtom));
          set(shuffleModeAtom, modes[(current + 1) % modes.length]!);
          set(menuVersionAtom, get(menuVersionAtom) + 1);
          break;
        }
        case 1: {
          const modes: RepeatMode[] = ['off', 'one', 'all'];
          const current = modes.indexOf(get(repeatModeAtom));
          set(repeatModeAtom, modes[(current + 1) % modes.length]!);
          set(menuVersionAtom, get(menuVersionAtom) + 1);
          break;
        }
        case 2:
          // About screen — future task
          break;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Main menu (public entry point)
// ---------------------------------------------------------------------------

/**
 * Creates the root menu level for the iPod 5th-generation interface.
 *
 * The returned `MenuLevel` is the top of the menu stack. Dynamic submenus
 * (artists, albums, etc.) lazily query the database when entered.
 */
export function createMainMenu(get: Getter, set: Setter): MenuLevel {
  return {
    title: 'iPod',
    getItems: () => {
      const items: MenuItem[] = [
        { label: 'Music', hasSubmenu: true },
        { label: 'Shuffle Songs' },
        { label: 'Settings', hasSubmenu: true },
      ];
      if (get(currentTrackAtom)) {
        items.push({ label: 'Now Playing' });
      }
      return items;
    },
    onSelect: (index) => {
      switch (index) {
        case 0:
          set(pushMenuAtom, createMusicMenu(get, set));
          break;
        case 1:
          // Shuffle all songs — playback not implemented yet
          break;
        case 2:
          set(pushMenuAtom, createSettingsMenu(get, set));
          break;
        case 3:
          // "Now Playing" (only present when a track is loaded)
          set(goToNowPlayingAtom);
          break;
      }
    },
  };
}
