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
  currentTitleAtom,
  screenAtom,
  scrollAtom,
  selectAtom,
  menuBackAtom,
  menuStackAtom,
} from '../store/navigation.js';
import {
  playbackStateAtom,
  playPauseAtom,
  nextTrackAtom,
  previousTrackAtom,
  adjustVolumeAtom,
} from '../store/playback.js';
import { createMainMenu } from '../firmware/menu.js';

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

function VirtualIpodInner({ storage: _storage, variant = 'white' }: VirtualIpodProps) {
  const store = useStore();
  const title = useAtomValue(currentTitleAtom);
  const playbackState = useAtomValue(playbackStateAtom);
  const screen = useAtomValue(screenAtom);
  const scroll = useSetAtom(scrollAtom);
  const select = useSetAtom(selectAtom);
  const menuBack = useSetAtom(menuBackAtom);
  const playPause = useSetAtom(playPauseAtom);
  const next = useSetAtom(nextTrackAtom);
  const prev = useSetAtom(previousTrackAtom);
  const adjustVolume = useSetAtom(adjustVolumeAtom);

  // Initialize menu stack with the main menu on mount
  useEffect(() => {
    const mainMenu = createMainMenu(
      (atom) => store.get(atom),
      (atom, ...args) => store.set(atom, ...args)
    );
    store.set(menuStackAtom, [mainMenu]);
  }, [store]);

  const handleScroll = (dir: 1 | -1) => {
    if (screen === 'nowPlaying') {
      adjustVolume(dir * 5);
    } else {
      scroll(dir);
    }
  };

  return (
    <Shell variant={variant}>
      <div className="ipod-shell__screen-area">
        <Screen>
          <Header title={title} showPlayIndicator={playbackState === 'playing'} />
          <ScreenRouter />
        </Screen>
      </div>
      <div className="ipod-shell__wheel-area">
        <ClickWheel
          onScroll={handleScroll}
          onSelect={() => select()}
          onMenu={() => menuBack()}
          onPlayPause={() => playPause()}
          onNext={() => next()}
          onPrevious={() => prev()}
        />
      </div>
    </Shell>
  );
}
