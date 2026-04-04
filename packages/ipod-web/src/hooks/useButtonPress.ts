import { useCallback, useEffect, useRef, useState } from 'react';

export type ButtonZone = 'center' | 'top' | 'right' | 'bottom' | 'left';

export interface ButtonPressOptions {
  /** Called when a button is pressed and released (short press). */
  onPress: (zone: ButtonZone) => void;
  /** Called when a button is held past the long-press threshold. */
  onLongPress?: (zone: ButtonZone) => void;
  /** Duration in ms before a press is considered a long press. Default: 500. */
  longPressMs?: number;
}

export interface ButtonPressHandle {
  /** The zone currently being held down, or null. Use for immediate visual feedback. */
  pressedZone: ButtonZone | null;
  /** Register the start of a press. Sets pressedZone and starts any long-press timer. */
  startPress: (zone: ButtonZone) => void;
  /**
   * Commit a press on release. Fires onPress (if not a long press) and clears state.
   * Returns the zone that was committed, or null if no press was active.
   */
  commitPress: () => ButtonZone | null;
  /** Cancel a press without firing any action (e.g. when a scroll drag is detected). */
  cancelPress: () => void;
}

/**
 * Manages button press state for the click wheel.
 *
 * Separates visual feedback (immediate on press-down) from action dispatch
 * (on release), and provides a foundation for long-press handling.
 *
 * Usage:
 *   const { pressedZone, startPress, commitPress, cancelPress } = useButtonPress({ onPress });
 *   // pointerDown  → startPress(zone)    — zone lights up immediately
 *   // pointerUp    → commitPress()       — fires action, returns zone for flash animation
 *   // drag starts  → cancelPress()       — clears visual state, no action fired
 */
export function useButtonPress({
  onPress,
  onLongPress,
  longPressMs = 500,
}: ButtonPressOptions): ButtonPressHandle {
  const [pressedZone, setPressedZone] = useState<ButtonZone | null>(null);

  const stateRef = useRef<{
    zone: ButtonZone;
    longPressTimer: ReturnType<typeof setTimeout> | null;
    longPressTriggered: boolean;
  } | null>(null);

  const clearPressState = useCallback(() => {
    if (stateRef.current?.longPressTimer) {
      clearTimeout(stateRef.current.longPressTimer);
    }
    stateRef.current = null;
    setPressedZone(null);
  }, []);

  const startPress = useCallback(
    (zone: ButtonZone) => {
      clearPressState();

      const longPressTimer = onLongPress
        ? setTimeout(() => {
            const s = stateRef.current;
            if (s) {
              s.longPressTriggered = true;
              onLongPress(zone);
            }
          }, longPressMs)
        : null;

      stateRef.current = { zone, longPressTimer, longPressTriggered: false };
      setPressedZone(zone);
    },
    [clearPressState, onLongPress, longPressMs]
  );

  const commitPress = useCallback((): ButtonZone | null => {
    const state = stateRef.current;
    clearPressState();
    if (state && !state.longPressTriggered) {
      onPress(state.zone);
      return state.zone;
    }
    return null;
  }, [clearPressState, onPress]);

  const cancelPress = clearPressState;

  useEffect(() => {
    return clearPressState;
  }, [clearPressState]);

  return { pressedZone, startPress, commitPress, cancelPress };
}
