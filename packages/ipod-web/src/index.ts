export { VirtualIpod } from './ui/VirtualIpod.js';
export type { StorageProvider } from './storage/types.js';
export { BrowserStorage } from './storage/browser.js';
export { RemoteStorage } from './storage/remote.js';

// Firmware types
export type {
  IpodDatabase,
  Track,
  Album,
  Playlist,
  MenuItem,
  MenuLevel,
  ScreenId,
} from './firmware/types.js';

// Menu factory
export { createMainMenu } from './firmware/menu.js';

// Store atoms
export {
  screenAtom,
  menuStackAtom,
  selectedIndexAtom,
  menuVersionAtom,
  currentMenuAtom,
  currentItemsAtom,
  currentTitleAtom,
  scrollAtom,
  selectAtom,
  menuBackAtom,
  pushMenuAtom,
  goToNowPlayingAtom,
  goToMenuAtom,
} from './store/navigation.js';
export { databaseAtom } from './store/database.js';
export {
  shuffleModeAtom,
  repeatModeAtom,
  toggleShuffleAtom,
  toggleRepeatAtom,
} from './store/settings.js';
export type { ShuffleMode, RepeatMode } from './store/settings.js';

// Playback
export type { PlaybackState, QueueContext } from './firmware/playback.js';
export { AudioPlayer } from './audio/player.js';
export {
  currentTrackAtom,
  playbackStateAtom,
  positionAtom,
  durationAtom,
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
} from './store/playback.js';
