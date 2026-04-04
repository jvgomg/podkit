import React, { useCallback, useEffect, useRef, useState } from 'react';
import './ClickWheel.css';

export interface ClickWheelProps {
  onScroll: (direction: 1 | -1) => void;
  onSelect: () => void;
  onMenu: () => void;
  onPlayPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  className?: string;
}

type ActiveZone = 'center' | 'top' | 'right' | 'bottom' | 'left' | null;

/** Threshold in radians (~18 degrees) before emitting a scroll tick. */
const SCROLL_THRESHOLD = Math.PI / 10;

/** Fraction of radius below which pointer is in the center button zone. */
const CENTER_ZONE = 0.4;

export function ClickWheel({
  onScroll,
  onSelect,
  onMenu,
  onPlayPause,
  onPrevious,
  onNext,
  className,
}: ClickWheelProps) {
  const wheelRef = useRef<HTMLDivElement>(null);
  const trackingRef = useRef<{
    lastAngle: number;
    accumulated: number;
    hasDragged: boolean;
  } | null>(null);
  const [activeZone, setActiveZone] = useState<ActiveZone>(null);
  const activeZoneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-focus on mount
  useEffect(() => {
    wheelRef.current?.focus();
  }, []);

  const getAngleAndDistance = useCallback(
    (
      clientX: number,
      clientY: number
    ): { angle: number; distance: number; radius: number } | null => {
      const el = wheelRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const radius = rect.width / 2;
      return {
        angle: Math.atan2(dy, dx),
        distance: Math.sqrt(dx * dx + dy * dy),
        radius,
      };
    },
    []
  );

  const flashZone = useCallback((zone: ActiveZone) => {
    if (activeZoneTimer.current) clearTimeout(activeZoneTimer.current);
    setActiveZone(zone);
    activeZoneTimer.current = setTimeout(() => setActiveZone(null), 150);
  }, []);

  const classifyZone = useCallback(
    (angle: number, distance: number, radius: number): ActiveZone => {
      if (distance < radius * CENTER_ZONE) return 'center';
      // Convert angle to degrees for easier zone classification
      const deg = (angle * 180) / Math.PI;
      if (deg >= -135 && deg < -45) return 'top';
      if (deg >= -45 && deg < 45) return 'right';
      if (deg >= 45 && deg < 135) return 'bottom';
      // left: >= 135 or < -135
      return 'left';
    },
    []
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const info = getAngleAndDistance(e.clientX, e.clientY);
      if (!info) return;

      e.currentTarget.setPointerCapture(e.pointerId);

      // Don't track rotation if pointer is in the center button area
      if (info.distance < info.radius * CENTER_ZONE) {
        trackingRef.current = { lastAngle: info.angle, accumulated: 0, hasDragged: false };
        return;
      }

      trackingRef.current = {
        lastAngle: info.angle,
        accumulated: 0,
        hasDragged: false,
      };
    },
    [getAngleAndDistance]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const tracking = trackingRef.current;
      if (!tracking) return;

      const info = getAngleAndDistance(e.clientX, e.clientY);
      if (!info) return;

      // Don't track rotation when in the center zone
      if (info.distance < info.radius * CENTER_ZONE) return;

      let delta = info.angle - tracking.lastAngle;

      // Handle wrap-around at +/- PI
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;

      tracking.accumulated += delta;
      tracking.lastAngle = info.angle;

      if (Math.abs(tracking.accumulated) >= SCROLL_THRESHOLD) {
        const direction = tracking.accumulated > 0 ? 1 : -1;
        onScroll(direction);
        tracking.accumulated = 0;
        tracking.hasDragged = true;
      }
    },
    [getAngleAndDistance, onScroll]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const tracking = trackingRef.current;
      trackingRef.current = null;

      if (!tracking) return;

      // If the user dragged, this was a scroll, not a click
      if (tracking.hasDragged) return;

      const info = getAngleAndDistance(e.clientX, e.clientY);
      if (!info) return;

      const zone = classifyZone(info.angle, info.distance, info.radius);
      flashZone(zone);

      switch (zone) {
        case 'center':
          onSelect();
          break;
        case 'top':
          onMenu();
          break;
        case 'right':
          onNext();
          break;
        case 'bottom':
          onPlayPause();
          break;
        case 'left':
          onPrevious();
          break;
      }
    },
    [
      getAngleAndDistance,
      classifyZone,
      flashZone,
      onSelect,
      onMenu,
      onNext,
      onPlayPause,
      onPrevious,
    ]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          onScroll(-1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          onScroll(1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          onSelect();
          break;
        case 'Enter':
          e.preventDefault();
          onSelect();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          onMenu();
          break;
        case 'Escape':
          e.preventDefault();
          onMenu();
          break;
        case ' ':
          e.preventDefault();
          onPlayPause();
          break;
      }
    },
    [onScroll, onSelect, onMenu, onPlayPause]
  );

  const zoneClass = activeZone ? ` click-wheel--zone-active-${activeZone}` : '';

  return (
    <div
      ref={wheelRef}
      className={`click-wheel${zoneClass}${className ? ` ${className}` : ''}`}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      <span className="click-wheel__label click-wheel__label--top">MENU</span>
      <span className="click-wheel__label click-wheel__label--right">{'\u25B6\u25B6|'}</span>
      <span className="click-wheel__label click-wheel__label--bottom">{'\u25B6||'}</span>
      <span className="click-wheel__label click-wheel__label--left">{'|\u25C0\u25C0'}</span>
      <div className="click-wheel__center" />
    </div>
  );
}
