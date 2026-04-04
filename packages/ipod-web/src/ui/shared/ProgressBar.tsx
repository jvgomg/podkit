import React from 'react';
import './ProgressBar.css';

export interface ProgressBarProps {
  progress: number;
  leftLabel?: string;
  rightLabel?: string;
  className?: string;
}

export function ProgressBar({ progress, leftLabel, rightLabel, className }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, progress));
  const pct = clamped * 100;

  return (
    <div className={`progress-bar${className ? ` ${className}` : ''}`}>
      <div className="progress-bar__track">
        <div className="progress-bar__fill" style={{ width: `${pct}%` }} />
        <div className="progress-bar__indicator" style={{ left: `${pct}%` }}>
          {'\u25C6'}
        </div>
      </div>
      {(leftLabel || rightLabel) && (
        <div className="progress-bar__labels">
          <span className="progress-bar__label-left">{leftLabel ?? ''}</span>
          <span className="progress-bar__label-right">{rightLabel ?? ''}</span>
        </div>
      )}
    </div>
  );
}
