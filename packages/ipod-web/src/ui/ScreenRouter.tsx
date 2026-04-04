import React from 'react';
import { useAtomValue } from 'jotai';
import { screenAtom } from '../store/navigation.js';
import { connectionStatusAtom } from '../store/connection.js';
import { MenuScreen } from './screens/MenuScreen.js';
import { NowPlaying } from './screens/NowPlaying.js';
import { StatusScreen, SickPodIcon, ConnectedIcon } from './screens/StatusScreen.js';
import sickpodImg from '../assets/sickpod.png';

export function ScreenRouter() {
  const screen = useAtomValue(screenAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);

  switch (connectionStatus.state) {
    case 'connecting':
      return <StatusScreen primary="Connecting…" />;
    case 'server-unreachable':
      return <StatusScreen primary="Not Connected" secondary="Retrying…" />;
    case 'no-storage':
      return <StatusScreen primary="No iPod" />;
    case 'connected-to-host':
      return (
        <StatusScreen icon={<ConnectedIcon />} primary="Connected" secondary="Do not disconnect" />
      );
    case 'database-error':
      return (
        <StatusScreen
          icon={<SickPodIcon src={sickpodImg} />}
          primary="Error"
          secondary={connectionStatus.message}
        />
      );
  }

  if (screen === 'nowPlaying') {
    return <NowPlaying />;
  }

  return <MenuScreen />;
}
