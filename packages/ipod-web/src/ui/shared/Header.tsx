import React from 'react';
import { BsPlayFill, BsPauseFill } from 'react-icons/bs';
import './Header.css';

export type PlaybackIndicator = 'none' | 'playing' | 'paused';

export interface HeaderProps {
  title: string;
  playbackIndicator?: PlaybackIndicator;
}

export function Header({ title, playbackIndicator = 'none' }: HeaderProps) {
  return (
    <div className="ipod-header">
      <span className="ipod-header__play-indicator">
        {playbackIndicator === 'playing' && <BsPlayFill size={16} />}
        {playbackIndicator === 'paused' && <BsPauseFill size={16} />}
      </span>
      <span className="ipod-header__title">{title}</span>
      <span className="ipod-header__battery">
        <span className="ipod-header__battery-icon">
          <span className="ipod-header__battery-fill" />
        </span>
      </span>
    </div>
  );
}
