import React from 'react';
import './Header.css';

export interface HeaderProps {
  title: string;
  showPlayIndicator?: boolean;
}

export function Header({ title, showPlayIndicator = false }: HeaderProps) {
  return (
    <div className="ipod-header">
      <span className="ipod-header__play-indicator">{showPlayIndicator ? '\u25B6' : ''}</span>
      <span className="ipod-header__title">{title}</span>
      <span className="ipod-header__battery">
        <span className="ipod-header__battery-icon">
          <span className="ipod-header__battery-fill" />
        </span>
      </span>
    </div>
  );
}
