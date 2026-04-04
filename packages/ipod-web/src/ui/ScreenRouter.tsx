import React from 'react';
import { useAtomValue } from 'jotai';
import { screenAtom } from '../store/navigation.js';
import { MenuScreen } from './screens/MenuScreen.js';
import { NowPlaying } from './screens/NowPlaying.js';

export function ScreenRouter() {
  const screen = useAtomValue(screenAtom);

  if (screen === 'nowPlaying') {
    return <NowPlaying />;
  }

  return <MenuScreen />;
}
