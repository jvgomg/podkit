import { describe, test, expect } from 'bun:test';
import { createStore } from 'jotai';
import type { MenuLevel } from '../firmware/types.js';
import {
  screenAtom,
  menuStackAtom,
  selectedIndexAtom,
  currentMenuAtom,
  currentItemsAtom,
  currentMenuTitleAtom,
  scrollAtom,
  selectAtom,
  menuBackAtom,
  pushMenuAtom,
  goToNowPlayingAtom,
  goToMenuAtom,
} from './navigation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMenu(title: string, itemCount: number, onSelect?: (i: number) => void): MenuLevel {
  return {
    title,
    getItems: () =>
      Array.from({ length: itemCount }, (_, i) => ({
        label: `${title} item ${i}`,
      })),
    onSelect: onSelect ?? (() => {}),
  };
}

function storeWithMenu(menu: MenuLevel) {
  const store = createStore();
  store.set(menuStackAtom, [menu]);
  return store;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('navigation atoms', () => {
  // -- Screen ---------------------------------------------------------------

  test('default screen is menu', () => {
    const store = createStore();
    expect(store.get(screenAtom)).toBe('menu');
  });

  test('goToNowPlayingAtom switches screen', () => {
    const store = createStore();
    store.set(goToNowPlayingAtom);
    expect(store.get(screenAtom)).toBe('nowPlaying');
  });

  test('goToMenuAtom switches back to menu', () => {
    const store = createStore();
    store.set(goToNowPlayingAtom);
    store.set(goToMenuAtom);
    expect(store.get(screenAtom)).toBe('menu');
  });

  // -- Current menu ---------------------------------------------------------

  test('currentMenuAtom returns null when stack is empty', () => {
    const store = createStore();
    expect(store.get(currentMenuAtom)).toBeNull();
  });

  test('currentMenuAtom returns top of stack', () => {
    const menu = makeMenu('Root', 2);
    const store = storeWithMenu(menu);
    expect(store.get(currentMenuAtom)).toBe(menu);
  });

  test('currentMenuTitleAtom defaults to iPod when stack is empty', () => {
    const store = createStore();
    expect(store.get(currentMenuTitleAtom)).toBe('iPod');
  });

  test('currentMenuTitleAtom reflects current menu title', () => {
    const store = storeWithMenu(makeMenu('Music', 3));
    expect(store.get(currentMenuTitleAtom)).toBe('Music');
  });

  test('currentItemsAtom returns empty array when stack is empty', () => {
    const store = createStore();
    expect(store.get(currentItemsAtom)).toEqual([]);
  });

  test('currentItemsAtom returns items from current menu', () => {
    const store = storeWithMenu(makeMenu('Test', 2));
    const items = store.get(currentItemsAtom);
    expect(items).toHaveLength(2);
    expect(items[0]!.label).toBe('Test item 0');
  });

  // -- Scroll ---------------------------------------------------------------

  test('scroll down increments selected index', () => {
    const store = storeWithMenu(makeMenu('Test', 5));
    store.set(scrollAtom, 1);
    expect(store.get(selectedIndexAtom)).toBe(1);
    store.set(scrollAtom, 1);
    expect(store.get(selectedIndexAtom)).toBe(2);
  });

  test('scroll up decrements selected index', () => {
    const store = storeWithMenu(makeMenu('Test', 5));
    store.set(selectedIndexAtom, 3);
    store.set(scrollAtom, -1);
    expect(store.get(selectedIndexAtom)).toBe(2);
  });

  test('scroll wraps around forward', () => {
    const store = storeWithMenu(makeMenu('Test', 3));
    store.set(selectedIndexAtom, 2);
    store.set(scrollAtom, 1);
    expect(store.get(selectedIndexAtom)).toBe(0);
  });

  test('scroll wraps around backward', () => {
    const store = storeWithMenu(makeMenu('Test', 3));
    store.set(selectedIndexAtom, 0);
    store.set(scrollAtom, -1);
    expect(store.get(selectedIndexAtom)).toBe(2);
  });

  test('scroll does nothing when menu is empty', () => {
    const store = storeWithMenu(makeMenu('Empty', 0));
    store.set(scrollAtom, 1);
    expect(store.get(selectedIndexAtom)).toBe(0);
  });

  // -- Select ---------------------------------------------------------------

  test('select calls onSelect with current index', () => {
    let selectedIndex = -1;
    const menu = makeMenu('Test', 3, (i) => {
      selectedIndex = i;
    });
    const store = storeWithMenu(menu);
    store.set(selectedIndexAtom, 2);
    store.set(selectAtom);
    expect(selectedIndex).toBe(2);
  });

  test('select does nothing when stack is empty', () => {
    const store = createStore();
    // Should not throw
    store.set(selectAtom);
  });

  // -- Push / Back ----------------------------------------------------------

  test('pushMenuAtom adds to stack and resets index', () => {
    const root = makeMenu('Root', 3);
    const sub = makeMenu('Sub', 5);
    const store = storeWithMenu(root);
    store.set(selectedIndexAtom, 2);
    store.set(pushMenuAtom, sub);
    expect(store.get(menuStackAtom)).toHaveLength(2);
    expect(store.get(currentMenuAtom)).toBe(sub);
    expect(store.get(selectedIndexAtom)).toBe(0);
  });

  test('menuBackAtom pops the stack and resets index', () => {
    const root = makeMenu('Root', 3);
    const sub = makeMenu('Sub', 5);
    const store = createStore();
    store.set(menuStackAtom, [root, sub]);
    store.set(selectedIndexAtom, 4);
    store.set(menuBackAtom);
    expect(store.get(menuStackAtom)).toHaveLength(1);
    expect(store.get(currentMenuAtom)).toBe(root);
    expect(store.get(selectedIndexAtom)).toBe(0);
  });

  test('menuBackAtom does nothing at root', () => {
    const root = makeMenu('Root', 3);
    const store = storeWithMenu(root);
    store.set(menuBackAtom);
    expect(store.get(menuStackAtom)).toHaveLength(1);
    expect(store.get(currentMenuAtom)).toBe(root);
  });

  test('menu stack is immutable (new arrays on push/pop)', () => {
    const root = makeMenu('Root', 1);
    const sub = makeMenu('Sub', 1);
    const store = storeWithMenu(root);

    const stackBefore = store.get(menuStackAtom);
    store.set(pushMenuAtom, sub);
    const stackAfter = store.get(menuStackAtom);
    expect(stackBefore).not.toBe(stackAfter);
    expect(stackBefore).toHaveLength(1); // original unchanged

    const stackBeforePop = store.get(menuStackAtom);
    store.set(menuBackAtom);
    const stackAfterPop = store.get(menuStackAtom);
    expect(stackBeforePop).not.toBe(stackAfterPop);
    expect(stackBeforePop).toHaveLength(2); // original unchanged
  });
});
