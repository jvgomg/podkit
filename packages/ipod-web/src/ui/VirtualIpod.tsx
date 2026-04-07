import React, { useEffect } from 'react';
import { Provider, useAtomValue, useSetAtom, useStore } from 'jotai';
import '@fontsource-variable/source-sans-3';
import type { StorageProvider } from '../storage/types.js';
import { Shell } from './Shell.js';
import { Screen } from './Screen.js';
import { Header } from './shared/Header.js';
import { ClickWheel } from './ClickWheel.js';
import { ScreenRouter } from './ScreenRouter.js';
import {
  headerTitleAtom,
  screenAtom,
  scrollAtom,
  selectAtom,
  menuBackAtom,
  goToMenuAtom,
  menuStackAtom,
  selectedIndexAtom,
} from '../store/navigation.js';
import {
  playbackStateAtom,
  currentTrackAtom,
  playPauseAtom,
  nextTrackAtom,
  previousTrackAtom,
  adjustVolumeAtom,
  storageProviderAtom,
  audioPlayerAtom,
  positionAtom,
  durationAtom,
  queueAtom,
  queueIndexAtom,
} from '../store/playback.js';
import { connectionStatusAtom } from '../store/connection.js';
import { databaseAtom } from '../store/database.js';
import {
  nowPlayingSelectAtom,
  nowPlayingScrollAtom,
  resetNowPlayingModeAtom,
} from '../store/now-playing-mode.js';
import { createMainMenu } from '../firmware/menu.js';
import { AudioPlayer } from '../audio/player.js';

export interface VirtualIpodProps {
  storage?: StorageProvider;
  variant?: 'white' | 'black';
}

export function VirtualIpod({ storage, variant = 'white' }: VirtualIpodProps) {
  return (
    <Provider>
      <VirtualIpodInner storage={storage} variant={variant} />
    </Provider>
  );
}

function VirtualIpodInner({ storage, variant = 'white' }: VirtualIpodProps) {
  const store = useStore();
  const title = useAtomValue(headerTitleAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const currentTrack = useAtomValue(currentTrackAtom);
  const screen = useAtomValue(screenAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const scroll = useSetAtom(scrollAtom);
  const select = useSetAtom(selectAtom);
  const menuBack = useSetAtom(menuBackAtom);
  const goToMenu = useSetAtom(goToMenuAtom);
  const playPause = useSetAtom(playPauseAtom);
  const next = useSetAtom(nextTrackAtom);
  const prev = useSetAtom(previousTrackAtom);
  const npSelect = useSetAtom(nowPlayingSelectAtom);
  const npScroll = useSetAtom(nowPlayingScrollAtom);
  const resetNpMode = useSetAtom(resetNowPlayingModeAtom);

  // Global keyboard shortcuts for volume (=, +, -, _)
  useEffect(() => {
    const handleVolumeKey = (e: KeyboardEvent) => {
      const delta = e.key === '=' || e.key === '+' ? 5 : e.key === '-' || e.key === '_' ? -5 : 0;
      if (delta === 0) return;
      e.preventDefault();
      if (store.get(screenAtom) === 'nowPlaying') {
        store.set(nowPlayingScrollAtom, delta > 0 ? 1 : -1);
      } else {
        store.set(adjustVolumeAtom, delta);
      }
    };
    window.addEventListener('keydown', handleVolumeKey);
    return () => window.removeEventListener('keydown', handleVolumeKey);
  }, [store]);

  // Initialize menu stack with the main menu on mount
  useEffect(() => {
    const mainMenu = createMainMenu(
      (atom) => store.get(atom),
      (atom, ...args) => store.set(atom, ...args)
    );
    store.set(menuStackAtom, [mainMenu]);
  }, [store]);

  // Initialize audio player on mount
  useEffect(() => {
    const player = new AudioPlayer();
    store.set(audioPlayerAtom, player);

    player.onTimeUpdate(() => {
      store.set(positionAtom, player.currentTime);
      store.set(durationAtom, player.duration);
    });

    player.onEnded(() => {
      store.set(nextTrackAtom);
    });

    return () => {
      player.destroy();
      store.set(audioPlayerAtom, null);
    };
  }, [store]);

  // Wire storage provider to connection status and database atoms
  useEffect(() => {
    if (!storage) {
      store.set(storageProviderAtom, null);
      store.set(connectionStatusAtom, { state: 'ready' });
      return;
    }

    store.set(storageProviderAtom, storage);
    store.set(connectionStatusAtom, storage.status);

    if (storage.status.state === 'ready') {
      store.set(databaseAtom, storage.status.database ?? null);
    }

    const unsubscribe = storage.onStatusChange((status) => {
      store.set(connectionStatusAtom, status);
      if (status.state === 'ready') {
        store.set(databaseAtom, status.database ?? null);

        // Reset UI to home screen when a device connects
        const mainMenu = createMainMenu(
          (atom) => store.get(atom),
          (atom, ...args) => store.set(atom, ...args)
        );
        store.set(menuStackAtom, [mainMenu]);
        store.set(selectedIndexAtom, 0);
        store.set(screenAtom, 'menu');

        // Stop any active playback
        const player = store.get(audioPlayerAtom);
        if (player) player.pause();
        store.set(playbackStateAtom, 'stopped');
        store.set(currentTrackAtom, null);
        store.set(queueAtom, []);
        store.set(queueIndexAtom, 0);
        store.set(positionAtom, 0);
        store.set(durationAtom, 0);
        store.set(resetNowPlayingModeAtom);
      } else {
        store.set(databaseAtom, null);

        // Stop any active playback when leaving ready state
        const player = store.get(audioPlayerAtom);
        if (player) player.pause();
        store.set(playbackStateAtom, 'stopped');
        store.set(currentTrackAtom, null);
        store.set(queueAtom, []);
        store.set(queueIndexAtom, 0);
        store.set(positionAtom, 0);
        store.set(durationAtom, 0);
        store.set(resetNowPlayingModeAtom);
      }
    });

    return unsubscribe;
  }, [storage, store]);

  const handleScroll = (dir: 1 | -1) => {
    if (screen === 'nowPlaying') {
      npScroll(dir);
    } else {
      scroll(dir);
    }
  };

  const handleSelect = () => {
    if (screen === 'nowPlaying') {
      npSelect();
    } else {
      select();
    }
  };

  const handleMenu = () => {
    if (screen === 'nowPlaying') {
      resetNpMode();
      goToMenu();
    } else {
      menuBack();
    }
  };

  return (
    <Shell variant={variant}>
      <div className="ipod-shell__screen-area">
        <Screen>
          {connectionStatus.state === 'ready' && (
            <Header
              title={title}
              playbackIndicator={
                currentTrack === null ? 'none' : playbackState === 'playing' ? 'playing' : 'paused'
              }
            />
          )}
          <ScreenRouter />
        </Screen>
      </div>
      <div className="ipod-shell__wheel-area">
        <ClickWheel
          onScroll={handleScroll}
          onSelect={handleSelect}
          onMenu={handleMenu}
          onPlayPause={() => playPause()}
          onNext={() => next()}
          onPrevious={() => prev()}
        />
      </div>
    </Shell>
  );
}
