import { describe, test, expect } from 'bun:test';
import { createStore } from 'jotai';
import type { IpodDatabase, Track } from './types.js';
import { createMainMenu } from './menu.js';
import { databaseAtom } from '../store/database.js';
import {
  menuStackAtom,
  currentMenuAtom,
  currentItemsAtom,
  selectedIndexAtom,
} from '../store/navigation.js';

// ---------------------------------------------------------------------------
// Mock database
// ---------------------------------------------------------------------------

const mockTracks: Track[] = [
  {
    id: 1,
    title: 'Alpha',
    artist: 'Artist A',
    album: 'Album X',
    genre: 'Rock',
    duration: 180_000,
    trackNumber: 1,
  },
  {
    id: 2,
    title: 'Beta',
    artist: 'Artist A',
    album: 'Album X',
    genre: 'Rock',
    duration: 240_000,
    trackNumber: 2,
  },
  {
    id: 3,
    title: 'Gamma',
    artist: 'Artist B',
    album: 'Album Y',
    genre: 'Jazz',
    duration: 300_000,
    trackNumber: 1,
  },
  {
    id: 4,
    title: 'Delta',
    artist: 'Artist B',
    album: 'Album Z',
    genre: 'Jazz',
    duration: 200_000,
    trackNumber: 1,
  },
];

function createMockDb(): IpodDatabase {
  return {
    getTracks: () => mockTracks,
    getArtists: () => ['Artist A', 'Artist B'],
    getAlbums: () => [
      { name: 'Album X', artist: 'Artist A', trackIds: [1, 2] },
      { name: 'Album Y', artist: 'Artist B', trackIds: [3] },
      { name: 'Album Z', artist: 'Artist B', trackIds: [4] },
    ],
    getGenres: () => ['Rock', 'Jazz'],
    getPlaylists: () => [{ name: 'Favourites', id: 1n, trackCount: 2 }],
    getPlaylistTracks: (id: bigint) => {
      if (id === 1n) return [mockTracks[0]!, mockTracks[2]!];
      return [];
    },
    getTracksByArtist: (artist: string) => mockTracks.filter((t) => t.artist === artist),
    getTracksByAlbum: (_artist: string, album: string) =>
      mockTracks.filter((t) => t.album === album),
    getTracksByGenre: (genre: string) => mockTracks.filter((t) => t.genre === genre),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestStore(db: IpodDatabase | null = createMockDb()) {
  const store = createStore();
  if (db) store.set(databaseAtom, db);

  const mainMenu = createMainMenu(store.get.bind(store), store.set.bind(store));
  store.set(menuStackAtom, [mainMenu]);
  return store;
}

function selectItemByLabel(store: ReturnType<typeof createStore>, label: string) {
  const items = store.get(currentItemsAtom);
  const index = items.findIndex((item) => item.label === label);
  if (index === -1)
    throw new Error(`No item "${label}" in menu. Items: ${items.map((i) => i.label).join(', ')}`);
  store.set(selectedIndexAtom, index);
  const menu = store.get(currentMenuAtom);
  menu!.onSelect(index);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('menu tree', () => {
  test('main menu has Music, Shuffle Songs, Settings', () => {
    const store = createTestStore();
    const items = store.get(currentItemsAtom);
    const labels = items.map((i) => i.label);
    expect(labels).toEqual(['Music', 'Shuffle Songs', 'Settings']);
  });

  test('Music has submenu indicator', () => {
    const store = createTestStore();
    const items = store.get(currentItemsAtom);
    const music = items.find((i) => i.label === 'Music');
    expect(music?.hasSubmenu).toBe(true);
  });

  test('Settings has submenu indicator', () => {
    const store = createTestStore();
    const items = store.get(currentItemsAtom);
    const settings = items.find((i) => i.label === 'Settings');
    expect(settings?.hasSubmenu).toBe(true);
  });

  test('Shuffle Songs has no submenu indicator', () => {
    const store = createTestStore();
    const items = store.get(currentItemsAtom);
    const shuffle = items.find((i) => i.label === 'Shuffle Songs');
    expect(shuffle?.hasSubmenu).toBeFalsy();
  });
});

describe('music menu', () => {
  test('has Playlists, Artists, Albums, Songs, Genres, Now Playing', () => {
    const store = createTestStore();
    selectItemByLabel(store, 'Music');
    const items = store.get(currentItemsAtom);
    const labels = items.map((i) => i.label);
    expect(labels).toEqual(['Playlists', 'Artists', 'Albums', 'Songs', 'Genres', 'Now Playing']);
  });

  test('Playlists shows playlist names from database', () => {
    const store = createTestStore();
    selectItemByLabel(store, 'Music');
    selectItemByLabel(store, 'Playlists');
    const items = store.get(currentItemsAtom);
    expect(items).toHaveLength(1);
    expect(items[0]!.label).toBe('Favourites');
    expect(items[0]!.detail).toBe('2');
  });

  test('selecting a playlist shows its tracks', () => {
    const store = createTestStore();
    selectItemByLabel(store, 'Music');
    selectItemByLabel(store, 'Playlists');
    selectItemByLabel(store, 'Favourites');
    const items = store.get(currentItemsAtom);
    expect(items).toHaveLength(2);
    expect(items[0]!.label).toBe('Alpha');
    expect(items[1]!.label).toBe('Gamma');
  });

  test('Artists shows artist names from database', () => {
    const store = createTestStore();
    selectItemByLabel(store, 'Music');
    selectItemByLabel(store, 'Artists');
    const items = store.get(currentItemsAtom);
    const labels = items.map((i) => i.label);
    expect(labels).toEqual(['Artist A', 'Artist B']);
  });

  test('selecting an artist shows their albums', () => {
    const store = createTestStore();
    selectItemByLabel(store, 'Music');
    selectItemByLabel(store, 'Artists');
    selectItemByLabel(store, 'Artist B');
    const items = store.get(currentItemsAtom);
    const labels = items.map((i) => i.label);
    expect(labels).toEqual(['Album Y', 'Album Z']);
  });

  test('selecting an album from artist view shows tracks', () => {
    const store = createTestStore();
    selectItemByLabel(store, 'Music');
    selectItemByLabel(store, 'Artists');
    selectItemByLabel(store, 'Artist A');
    selectItemByLabel(store, 'Album X');
    const items = store.get(currentItemsAtom);
    expect(items).toHaveLength(2);
    expect(items[0]!.label).toBe('Alpha');
    expect(items[1]!.label).toBe('Beta');
  });

  test('Albums shows all albums', () => {
    const store = createTestStore();
    selectItemByLabel(store, 'Music');
    selectItemByLabel(store, 'Albums');
    const items = store.get(currentItemsAtom);
    expect(items).toHaveLength(3);
    expect(items[0]!.label).toBe('Album X');
    expect(items[0]!.detail).toBe('Artist A');
  });

  test('Songs shows all tracks alphabetically', () => {
    const store = createTestStore();
    selectItemByLabel(store, 'Music');
    selectItemByLabel(store, 'Songs');
    const items = store.get(currentItemsAtom);
    const labels = items.map((i) => i.label);
    expect(labels).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma']);
  });

  test('Songs shows duration as detail', () => {
    const store = createTestStore();
    selectItemByLabel(store, 'Music');
    selectItemByLabel(store, 'Songs');
    const items = store.get(currentItemsAtom);
    // Alpha: 180000ms = 3:00
    expect(items[0]!.detail).toBe('3:00');
    // Beta: 240000ms = 4:00
    expect(items[1]!.detail).toBe('4:00');
  });

  test('Genres shows genre names from database', () => {
    const store = createTestStore();
    selectItemByLabel(store, 'Music');
    selectItemByLabel(store, 'Genres');
    const items = store.get(currentItemsAtom);
    const labels = items.map((i) => i.label);
    expect(labels).toEqual(['Rock', 'Jazz']);
  });

  test('selecting a genre shows its tracks', () => {
    const store = createTestStore();
    selectItemByLabel(store, 'Music');
    selectItemByLabel(store, 'Genres');
    selectItemByLabel(store, 'Jazz');
    const items = store.get(currentItemsAtom);
    expect(items).toHaveLength(2);
    expect(items[0]!.label).toBe('Gamma');
    expect(items[1]!.label).toBe('Delta');
  });
});

describe('settings menu', () => {
  test('shows Shuffle, Repeat, About', () => {
    const store = createTestStore();
    selectItemByLabel(store, 'Settings');
    const items = store.get(currentItemsAtom);
    const labels = items.map((i) => i.label);
    expect(labels).toEqual(['Shuffle', 'Repeat', 'About']);
  });

  test('Shuffle shows current mode and cycles on select', () => {
    const store = createTestStore();
    selectItemByLabel(store, 'Settings');

    // Initial: Off
    let items = store.get(currentItemsAtom);
    expect(items[0]!.detail).toBe('Off');

    // Select to cycle to Songs
    const menu = store.get(currentMenuAtom)!;
    menu.onSelect(0);
    items = store.get(currentItemsAtom);
    expect(items[0]!.detail).toBe('Songs');

    // Cycle to Albums
    menu.onSelect(0);
    items = store.get(currentItemsAtom);
    expect(items[0]!.detail).toBe('Albums');

    // Cycle back to Off
    menu.onSelect(0);
    items = store.get(currentItemsAtom);
    expect(items[0]!.detail).toBe('Off');
  });

  test('Repeat shows current mode and cycles on select', () => {
    const store = createTestStore();
    selectItemByLabel(store, 'Settings');

    let items = store.get(currentItemsAtom);
    expect(items[1]!.detail).toBe('Off');

    const menu = store.get(currentMenuAtom)!;
    menu.onSelect(1);
    items = store.get(currentItemsAtom);
    expect(items[1]!.detail).toBe('One');

    menu.onSelect(1);
    items = store.get(currentItemsAtom);
    expect(items[1]!.detail).toBe('All');

    menu.onSelect(1);
    items = store.get(currentItemsAtom);
    expect(items[1]!.detail).toBe('Off');
  });
});

describe('null database handling', () => {
  test('main menu still shows static items with no database', () => {
    const store = createTestStore(null);
    const items = store.get(currentItemsAtom);
    const labels = items.map((i) => i.label);
    expect(labels).toEqual(['Music', 'Shuffle Songs', 'Settings']);
  });

  test('dynamic menus return empty items with no database', () => {
    const store = createTestStore(null);
    selectItemByLabel(store, 'Music');
    selectItemByLabel(store, 'Artists');
    const items = store.get(currentItemsAtom);
    expect(items).toEqual([]);
  });

  test('Playlists returns empty with no database', () => {
    const store = createTestStore(null);
    selectItemByLabel(store, 'Music');
    selectItemByLabel(store, 'Playlists');
    expect(store.get(currentItemsAtom)).toEqual([]);
  });

  test('Songs returns empty with no database', () => {
    const store = createTestStore(null);
    selectItemByLabel(store, 'Music');
    selectItemByLabel(store, 'Songs');
    expect(store.get(currentItemsAtom)).toEqual([]);
  });

  test('Genres returns empty with no database', () => {
    const store = createTestStore(null);
    selectItemByLabel(store, 'Music');
    selectItemByLabel(store, 'Genres');
    expect(store.get(currentItemsAtom)).toEqual([]);
  });
});
