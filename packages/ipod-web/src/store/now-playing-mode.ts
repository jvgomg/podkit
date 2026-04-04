import { atom } from 'jotai';
import { adjustVolumeAtom, seekAtom, positionAtom } from './playback.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NowPlayingMode = 'default' | 'scrubbing' | 'artwork';

// ---------------------------------------------------------------------------
// State atoms
// ---------------------------------------------------------------------------

/** The current sub-mode of the Now Playing screen. */
export const nowPlayingModeAtom = atom<NowPlayingMode>('default');

/** Whether the volume overlay is currently visible. */
export const volumeOverlayVisibleAtom = atom(false);

/** Timer ID for auto-hiding the volume overlay. Stored in an atom so it
 *  can be cleared when a new scroll arrives. */
const volumeTimerAtom = atom<ReturnType<typeof setTimeout> | null>(null);

/** How long (ms) the volume overlay stays visible after the last scroll. */
const VOLUME_OVERLAY_TIMEOUT = 2000;

/** How many seconds each scroll tick seeks in scrubbing mode. */
const SCRUB_STEP = 3;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Centre button pressed while on the Now Playing screen. Cycles mode. */
export const nowPlayingSelectAtom = atom(null, (get, set) => {
  const mode = get(nowPlayingModeAtom);
  switch (mode) {
    case 'default':
      set(nowPlayingModeAtom, 'scrubbing');
      break;
    case 'scrubbing':
      set(nowPlayingModeAtom, 'artwork');
      break;
    case 'artwork':
      set(nowPlayingModeAtom, 'default');
      break;
  }
});

/** Scroll while on the Now Playing screen. Behavior depends on mode. */
export const nowPlayingScrollAtom = atom(null, (get, set, direction: 1 | -1) => {
  const mode = get(nowPlayingModeAtom);

  if (mode === 'scrubbing') {
    const pos = get(positionAtom);
    set(seekAtom, Math.max(0, pos + direction * SCRUB_STEP));
    return;
  }

  // default or artwork: adjust volume and show overlay
  set(adjustVolumeAtom, direction * 5);
  set(volumeOverlayVisibleAtom, true);

  // Reset the hide timer
  const existing = get(volumeTimerAtom);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    set(volumeOverlayVisibleAtom, false);
    set(volumeTimerAtom, null);
  }, VOLUME_OVERLAY_TIMEOUT);
  set(volumeTimerAtom, timer);
});

/** Reset Now Playing mode back to default (e.g. when leaving the screen). */
export const resetNowPlayingModeAtom = atom(null, (get, set) => {
  set(nowPlayingModeAtom, 'default');
  set(volumeOverlayVisibleAtom, false);
  const timer = get(volumeTimerAtom);
  if (timer) {
    clearTimeout(timer);
    set(volumeTimerAtom, null);
  }
});
