import { describe, test, expect } from 'bun:test';
import { createStore } from 'jotai';
import type { Track } from '../firmware/types.js';
import type { StorageProvider } from '../storage/types.js';
import { repeatModeAtom } from './settings.js';
import {
  currentTrackAtom,
  playbackStateAtom,
  positionAtom,
  volumeAtom,
  queueAtom,
  queueIndexAtom,
  audioPlayerAtom,
  storageProviderAtom,
  currentQueuePositionAtom,
  playTrackInContextAtom,
  playPauseAtom,
  nextTrackAtom,
  previousTrackAtom,
  seekAtom,
  setVolumeAtom,
  adjustVolumeAtom,
} from './playback.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

class MockAudioPlayer {
  currentTime = 0;
  paused = true;
  volume = 0.75;
  src = '';
  async play(url: string) {
    this.src = url;
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }
  seek(s: number) {
    this.currentTime = s;
  }
  setVolume(v: number) {
    this.volume = v / 100;
  }
  get duration() {
    return 180;
  }
  onTimeUpdate() {}
  onEnded() {}
  onError() {}
  destroy() {}
}

function mockStorage(): StorageProvider {
  return {
    status: { state: 'ready', database: null as any },
    onStatusChange: () => () => {},
    getAudioUrl: async (path: string) => `blob://${path}`,
    reload: async () => {},
  };
}

function makeTrack(id: number, overrides?: Partial<Track>): Track {
  return {
    id,
    title: `Track ${id}`,
    artist: `Artist ${id}`,
    album: `Album ${id}`,
    genre: 'Rock',
    duration: 180000,
    trackNumber: id,
    ipodPath: `:iPod_Control:Music:F00:track${id}.m4a`,
    ...overrides,
  };
}

function setupStore() {
  const store = createStore();
  const player = new MockAudioPlayer();
  // Cast to any because MockAudioPlayer satisfies the shape but isn't the real class
  store.set(audioPlayerAtom, player as any);
  store.set(storageProviderAtom, mockStorage());
  return { store, player };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('playback atoms', () => {
  // -- Initial state --------------------------------------------------------

  test('initial state is stopped with no track', () => {
    const store = createStore();
    expect(store.get(playbackStateAtom)).toBe('stopped');
    expect(store.get(currentTrackAtom)).toBeNull();
    expect(store.get(volumeAtom)).toBe(75);
  });

  // -- Play/Pause -----------------------------------------------------------

  test('playPause toggles between playing and paused', async () => {
    const { store, player } = setupStore();
    const tracks = [makeTrack(1)];
    await store.set(playTrackInContextAtom, { tracks, startIndex: 0 });

    expect(store.get(playbackStateAtom)).toBe('playing');

    await store.set(playPauseAtom);
    expect(store.get(playbackStateAtom)).toBe('paused');
    expect(player.paused).toBe(true);

    await store.set(playPauseAtom);
    expect(store.get(playbackStateAtom)).toBe('playing');
    expect(player.paused).toBe(false);
  });

  test('playPause does nothing when stopped', async () => {
    const { store } = setupStore();
    await store.set(playPauseAtom);
    expect(store.get(playbackStateAtom)).toBe('stopped');
  });

  // -- Next track -----------------------------------------------------------

  test('nextTrack advances queue index', async () => {
    const { store } = setupStore();
    const tracks = [makeTrack(1), makeTrack(2), makeTrack(3)];
    await store.set(playTrackInContextAtom, { tracks, startIndex: 0 });

    await store.set(nextTrackAtom);
    expect(store.get(queueIndexAtom)).toBe(1);
    expect(store.get(currentTrackAtom)?.id).toBe(2);
    expect(store.get(playbackStateAtom)).toBe('playing');
  });

  test('nextTrack with repeat=one restarts current', async () => {
    const { store, player } = setupStore();
    const tracks = [makeTrack(1), makeTrack(2)];
    await store.set(playTrackInContextAtom, { tracks, startIndex: 0 });

    store.set(repeatModeAtom, 'one');
    player.currentTime = 60;

    await store.set(nextTrackAtom);
    expect(store.get(queueIndexAtom)).toBe(0);
    expect(player.currentTime).toBe(0);
  });

  test('nextTrack with repeat=all wraps to beginning', async () => {
    const { store } = setupStore();
    const tracks = [makeTrack(1), makeTrack(2)];
    await store.set(playTrackInContextAtom, { tracks, startIndex: 1 });

    store.set(repeatModeAtom, 'all');
    await store.set(nextTrackAtom);
    expect(store.get(queueIndexAtom)).toBe(0);
    expect(store.get(currentTrackAtom)?.id).toBe(1);
    expect(store.get(playbackStateAtom)).toBe('playing');
  });

  test('nextTrack with repeat=off stops at end', async () => {
    const { store } = setupStore();
    const tracks = [makeTrack(1), makeTrack(2)];
    await store.set(playTrackInContextAtom, { tracks, startIndex: 1 });

    store.set(repeatModeAtom, 'off');
    await store.set(nextTrackAtom);
    expect(store.get(playbackStateAtom)).toBe('stopped');
  });

  // -- Previous track -------------------------------------------------------

  test('previousTrack restarts if >3s in', async () => {
    const { store, player } = setupStore();
    const tracks = [makeTrack(1), makeTrack(2)];
    await store.set(playTrackInContextAtom, { tracks, startIndex: 1 });

    player.currentTime = 10;

    await store.set(previousTrackAtom);
    expect(player.currentTime).toBe(0);
    // Should stay on same track
    expect(store.get(queueIndexAtom)).toBe(1);
  });

  test('previousTrack goes to previous if <3s in', async () => {
    const { store, player } = setupStore();
    const tracks = [makeTrack(1), makeTrack(2), makeTrack(3)];
    await store.set(playTrackInContextAtom, { tracks, startIndex: 2 });

    player.currentTime = 1;

    await store.set(previousTrackAtom);
    expect(store.get(queueIndexAtom)).toBe(1);
    expect(store.get(currentTrackAtom)?.id).toBe(2);
    expect(store.get(playbackStateAtom)).toBe('playing');
  });

  test('previousTrack stays at first track when already at beginning', async () => {
    const { store, player } = setupStore();
    const tracks = [makeTrack(1), makeTrack(2)];
    await store.set(playTrackInContextAtom, { tracks, startIndex: 0 });

    player.currentTime = 1;

    await store.set(previousTrackAtom);
    expect(store.get(queueIndexAtom)).toBe(0);
    expect(store.get(currentTrackAtom)?.id).toBe(1);
  });

  // -- Volume ---------------------------------------------------------------

  test('volume clamped to 0-100', () => {
    const { store } = setupStore();

    store.set(setVolumeAtom, 150);
    expect(store.get(volumeAtom)).toBe(100);

    store.set(setVolumeAtom, -20);
    expect(store.get(volumeAtom)).toBe(0);
  });

  test('adjustVolume adds delta to current volume', () => {
    const { store } = setupStore();
    expect(store.get(volumeAtom)).toBe(75);

    store.set(adjustVolumeAtom, 10);
    expect(store.get(volumeAtom)).toBe(85);

    store.set(adjustVolumeAtom, -20);
    expect(store.get(volumeAtom)).toBe(65);
  });

  test('adjustVolume clamps at boundaries', () => {
    const { store } = setupStore();

    store.set(adjustVolumeAtom, 50);
    expect(store.get(volumeAtom)).toBe(100);

    store.set(adjustVolumeAtom, -200);
    expect(store.get(volumeAtom)).toBe(0);
  });

  // -- Seek -----------------------------------------------------------------

  test('seek updates position and player', () => {
    const { store, player } = setupStore();

    store.set(seekAtom, 42);
    expect(store.get(positionAtom)).toBe(42);
    expect(player.currentTime).toBe(42);
  });

  // -- Queue position -------------------------------------------------------

  test('queue position derived correctly', async () => {
    const { store } = setupStore();
    const tracks = [makeTrack(1), makeTrack(2), makeTrack(3)];
    await store.set(playTrackInContextAtom, { tracks, startIndex: 1 });

    const pos = store.get(currentQueuePositionAtom);
    expect(pos.current).toBe(2);
    expect(pos.total).toBe(3);
  });

  test('queue position with empty queue', () => {
    const store = createStore();
    const pos = store.get(currentQueuePositionAtom);
    expect(pos.current).toBe(1);
    expect(pos.total).toBe(0);
  });

  // -- Play track in context ------------------------------------------------

  test('playTrackInContextAtom sets up queue and plays', async () => {
    const { store, player } = setupStore();
    const tracks = [makeTrack(1), makeTrack(2), makeTrack(3)];

    await store.set(playTrackInContextAtom, { tracks, startIndex: 1 });

    expect(store.get(queueAtom)).toEqual(tracks);
    expect(store.get(queueIndexAtom)).toBe(1);
    expect(store.get(currentTrackAtom)?.id).toBe(2);
    expect(store.get(playbackStateAtom)).toBe('playing');
    expect(player.src).toBe('blob://:iPod_Control:Music:F00:track2.m4a');
  });

  test('playTrackInContextAtom does nothing without storage', async () => {
    const store = createStore();
    const player = new MockAudioPlayer();
    store.set(audioPlayerAtom, player as any);
    // No storage provider set

    const tracks = [makeTrack(1)];
    await store.set(playTrackInContextAtom, { tracks, startIndex: 0 });

    expect(store.get(playbackStateAtom)).toBe('stopped');
    expect(store.get(currentTrackAtom)).toBeNull();
  });
});
