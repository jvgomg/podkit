import React from 'react';
import './Screen.css';

export interface ScreenProps {
  children: React.ReactNode;
}

export function Screen({ children }: ScreenProps) {
  return (
    <div className="ipod-screen__bezel">
      <div className="ipod-screen">{children}</div>
    </div>
  );
}
