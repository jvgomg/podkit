import { atom } from 'jotai';
import type { Track } from '../firmware/types.js';
import type { PlaybackState, QueueContext } from '../firmware/playback.js';
import type { AudioPlayer } from '../audio/player.js';
import type { StorageProvider } from '../storage/types.js';
import { repeatModeAtom } from './settings.js';

// ---------------------------------------------------------------------------
// Core state atoms
// ---------------------------------------------------------------------------

/** The currently playing track, or null if nothing is loaded. */
export const currentTrackAtom = atom<Track | null>(null);

/** Current playback state. */
export const playbackStateAtom = atom<PlaybackState>('stopped');

/** Current position in seconds. */
export const positionAtom = atom<number>(0);

/** Duration of the current track in seconds. */
export const durationAtom = atom<number>(0);

/** Volume level, 0-100. */
export const volumeAtom = atom<number>(75);

/** The current playback queue. */
export const queueAtom = atom<Track[]>([]);

/** Index of the current track within the queue. */
export const queueIndexAtom = atom<number>(0);

/** The audio player instance (stored in atom for access across the app). */
export const audioPlayerAtom = atom<AudioPlayer | null>(null);

/** The storage provider (needed to get audio URLs). */
export const storageProviderAtom = atom<StorageProvider | null>(null);

// ---------------------------------------------------------------------------
// Derived atoms
// ---------------------------------------------------------------------------

/** Human-friendly queue position: { current: 1-based index, total: queue length }. */
export const currentQueuePositionAtom = atom((get) => {
  const queue = get(queueAtom);
  const index = get(queueIndexAtom);
  return { current: index + 1, total: queue.length };
});

// ---------------------------------------------------------------------------
// Action atoms
// ---------------------------------------------------------------------------

/** Play a track in context (builds queue from the provided tracks). */
export const playTrackInContextAtom = atom(null, async (get, set, context: QueueContext) => {
  const storage = get(storageProviderAtom);
  const player = get(audioPlayerAtom);
  if (!storage || !player) return;

  const { tracks, startIndex } = context;
  set(queueAtom, tracks);
  set(queueIndexAtom, startIndex);

  const track = tracks[startIndex]!;
  set(currentTrackAtom, track);

  try {
    const url = await storage.getAudioUrl(track.ipodPath ?? '');
    await player.play(url);
    set(playbackStateAtom, 'playing');
  } catch (e) {
    console.error('[playback] failed to play track', track.title, e);
    set(playbackStateAtom, 'stopped');
  }
});

/** Toggle between playing and paused. No-op when stopped. */
export const playPauseAtom = atom(null, async (get, set) => {
  const player = get(audioPlayerAtom);
  const state = get(playbackStateAtom);
  if (!player) return;

  if (state === 'playing') {
    player.pause();
    set(playbackStateAtom, 'paused');
  } else if (state === 'paused') {
    try {
      player.resume();
      set(playbackStateAtom, 'playing');
    } catch (e) {
      console.error('[playback] failed to resume', e);
      set(playbackStateAtom, 'stopped');
    }
  }
});

/** Advance to the next track, respecting repeat mode. */
export const nextTrackAtom = atom(null, async (get, set) => {
  const queue = get(queueAtom);
  const index = get(queueIndexAtom);
  const repeat = get(repeatModeAtom);

  if (repeat === 'one') {
    const player = get(audioPlayerAtom);
    player?.seek(0);
    return;
  }

  let nextIndex = index + 1;
  if (nextIndex >= queue.length) {
    if (repeat === 'all') {
      nextIndex = 0;
    } else {
      // End of queue, stop playback
      set(playbackStateAtom, 'stopped');
      return;
    }
  }

  set(queueIndexAtom, nextIndex);
  const track = queue[nextIndex]!;
  set(currentTrackAtom, track);

  const storage = get(storageProviderAtom);
  const player = get(audioPlayerAtom);
  if (storage && player) {
    try {
      const url = await storage.getAudioUrl(track.ipodPath ?? '');
      await player.play(url);
      set(playbackStateAtom, 'playing');
    } catch (e) {
      console.error('[playback] failed to play next track', track.title, e);
      set(playbackStateAtom, 'stopped');
    }
  }
});

/** Go to the previous track, or restart current if more than 3 seconds in. */
export const previousTrackAtom = atom(null, async (get, set) => {
  const player = get(audioPlayerAtom);
  if (!player) return;

  // If more than 3 seconds in, restart current track
  if (player.currentTime > 3) {
    player.seek(0);
    return;
  }

  const queue = get(queueAtom);
  const index = get(queueIndexAtom);

  let prevIndex = index - 1;
  if (prevIndex < 0) {
    prevIndex = 0; // stay at first track
  }

  set(queueIndexAtom, prevIndex);
  const track = queue[prevIndex]!;
  set(currentTrackAtom, track);

  const storage = get(storageProviderAtom);
  if (storage) {
    try {
      const url = await storage.getAudioUrl(track.ipodPath ?? '');
      await player.play(url);
      set(playbackStateAtom, 'playing');
    } catch (e) {
      console.error('[playback] failed to play previous track', track.title, e);
      set(playbackStateAtom, 'stopped');
    }
  }
});

/** Seek to a position in seconds. */
export const seekAtom = atom(null, (_get, set, seconds: number) => {
  const player = _get(audioPlayerAtom);
  player?.seek(seconds);
  set(positionAtom, seconds);
});

/** Set volume to an absolute level (0-100, clamped). */
export const setVolumeAtom = atom(null, (get, set, level: number) => {
  const player = get(audioPlayerAtom);
  const clamped = Math.max(0, Math.min(100, level));
  set(volumeAtom, clamped);
  player?.setVolume(clamped);
});

/** Adjust volume by a delta (e.g. scroll wheel on Now Playing). */
export const adjustVolumeAtom = atom(null, (get, set, delta: number) => {
  const current = get(volumeAtom);
  set(setVolumeAtom, current + delta);
});
