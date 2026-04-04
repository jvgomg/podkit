import React from 'react';
import { useAtomValue } from 'jotai';
import { screenAtom } from '../store/navigation.js';
import { connectionStatusAtom } from '../store/connection.js';
import { MenuScreen } from './screens/MenuScreen.js';
import { NowPlaying } from './screens/NowPlaying.js';
import { StatusScreen } from './screens/StatusScreen.js';
import { SickPodScreen } from './screens/SickPodScreen.js';

export function ScreenRouter() {
  const screen = useAtomValue(screenAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);

  switch (connectionStatus.state) {
    case 'connecting':
      return <StatusScreen primary="Connecting…" />;
    case 'server-unreachable':
      return <StatusScreen primary="Not Connected" secondary="Retrying…" />;
    case 'no-device':
      return <StatusScreen primary="No iPod Connected" />;
    case 'database-error':
      return <SickPodScreen message={connectionStatus.message} />;
  }

  if (screen === 'nowPlaying') {
    return <NowPlaying />;
  }

  return <MenuScreen />;
}
