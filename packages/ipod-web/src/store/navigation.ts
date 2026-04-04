import { atom } from 'jotai';
import type { MenuLevel, ScreenId } from '../firmware/types.js';

// ---------------------------------------------------------------------------
// Core state atoms
// ---------------------------------------------------------------------------

/** Which top-level screen is active. */
export const screenAtom = atom<ScreenId>('menu');

/** The menu navigation stack. The last element is the current menu. */
export const menuStackAtom = atom<MenuLevel[]>([]);

/** Index of the highlighted item within the current menu. */
export const selectedIndexAtom = atom<number>(0);

/**
 * Monotonically increasing counter that forces `currentItemsAtom` to
 * recompute. Bump this whenever menu-visible state changes outside the
 * menu stack (e.g. settings toggles).
 */
export const menuVersionAtom = atom(0);

// ---------------------------------------------------------------------------
// Derived (read-only) atoms
// ---------------------------------------------------------------------------

/** The currently visible menu level (top of the stack). */
export const currentMenuAtom = atom((get) => {
  const stack = get(menuStackAtom);
  return stack[stack.length - 1] ?? null;
});

/** Items in the current menu. */
export const currentItemsAtom = atom((get) => {
  get(menuVersionAtom); // subscribe to version changes
  const menu = get(currentMenuAtom);
  return menu?.getItems() ?? [];
});

/** Title of the current menu level. */
export const currentMenuTitleAtom = atom((get) => {
  const menu = get(currentMenuAtom);
  return menu?.title ?? 'iPod';
});

/**
 * Override for the header title. Screen components set this on mount
 * and clear it (to null) on unmount. When null, the header falls back
 * to the menu-derived title.
 */
export const headerTitleOverrideAtom = atom<string | null>(null);

/** The title shown in the header bar. */
export const headerTitleAtom = atom((get) => {
  const override = get(headerTitleOverrideAtom);
  if (override !== null) return override;
  return get(currentMenuTitleAtom);
});

// ---------------------------------------------------------------------------
// Action atoms (write-only)
// ---------------------------------------------------------------------------

/** Scroll the selection up (-1) or down (+1), wrapping at boundaries. */
export const scrollAtom = atom(null, (get, set, direction: 1 | -1) => {
  const items = get(currentItemsAtom);
  if (items.length === 0) return;
  const current = get(selectedIndexAtom);
  const next = (current + direction + items.length) % items.length;
  set(selectedIndexAtom, next);
});

/** Select the currently highlighted item (center-button press). */
export const selectAtom = atom(null, (get, _set) => {
  const menu = get(currentMenuAtom);
  const index = get(selectedIndexAtom);
  if (menu) {
    menu.onSelect(index);
  }
});

/** Go back one menu level. No-op at the root. */
export const menuBackAtom = atom(null, (get, set) => {
  const stack = get(menuStackAtom);
  if (stack.length > 1) {
    set(menuStackAtom, stack.slice(0, -1));
    set(selectedIndexAtom, 0);
  }
});

/** Push a new menu level onto the stack. */
export const pushMenuAtom = atom(null, (get, set, menu: MenuLevel) => {
  set(menuStackAtom, [...get(menuStackAtom), menu]);
  set(selectedIndexAtom, 0);
});

/** Switch to the Now Playing screen. */
export const goToNowPlayingAtom = atom(null, (_get, set) => {
  set(screenAtom, 'nowPlaying');
});

/** Switch back to the menu screen. */
export const goToMenuAtom = atom(null, (_get, set) => {
  set(screenAtom, 'menu');
});
