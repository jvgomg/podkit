import React from 'react';
import './Shell.css';

/** iPod shell dimensions in logical pixels */
export const IPOD_WIDTH = 380;
export const IPOD_HEIGHT = 637;

export interface ShellProps {
  variant?: 'white' | 'black';
  children: React.ReactNode;
}

export function Shell({ variant = 'white', children }: ShellProps) {
  return (
    <div className="ipod-shell" data-variant={variant}>
      {children}
    </div>
  );
}
