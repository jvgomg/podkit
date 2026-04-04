import React from 'react';
import './Shell.css';

export interface ShellProps {
  variant?: 'white' | 'black';
  children: React.ReactNode;
}

export function Shell({ variant = 'white', children }: ShellProps) {
  return (
    <div className="ipod-shell" data-variant={variant}>
      <div className="ipod-shell__drag-top" data-tauri-drag-region />
      <div className="ipod-shell__drag-left" data-tauri-drag-region />
      <div className="ipod-shell__drag-right" data-tauri-drag-region />
      {children}
    </div>
  );
}
