import { describe, test, expect } from 'bun:test';
import React from 'react';
import { Provider, createStore } from 'jotai';
import { render } from '@testing-library/react';
import { ListView } from './ListView.js';
import { scrollDirectionAtom } from '../../store/navigation.js';

function renderWithStore(ui: React.ReactElement, opts?: { scrollDirection?: 1 | -1 }) {
  const store = createStore();
  if (opts?.scrollDirection) {
    store.set(scrollDirectionAtom, opts.scrollDirection);
  }
  return render(<Provider store={store}>{ui}</Provider>);
}

describe('ListView', () => {
  test('renders items', () => {
    const items = [
      { label: 'Music', hasSubmenu: true },
      { label: 'Settings', hasSubmenu: true },
    ];
    const { container } = renderWithStore(<ListView items={items} selectedIndex={0} />);
    const labels = container.querySelectorAll('.list-view__label');
    expect(labels.length).toBe(2);
    expect(labels[0]?.textContent).toBe('Music');
    expect(labels[1]?.textContent).toBe('Settings');
  });

  test('highlights selected item', () => {
    const items = [
      { label: 'Music', hasSubmenu: true },
      { label: 'Settings', hasSubmenu: true },
    ];
    const { container } = renderWithStore(<ListView items={items} selectedIndex={1} />);
    const rows = container.querySelectorAll('.list-view__row');
    expect(rows[0]?.classList.contains('list-view__row--selected')).toBe(false);
    expect(rows[1]?.classList.contains('list-view__row--selected')).toBe(true);
  });

  test('shows chevron for submenu items', () => {
    const items = [{ label: 'Music', hasSubmenu: true }];
    const { container } = renderWithStore(<ListView items={items} selectedIndex={0} />);
    const chevron = container.querySelector('.list-view__chevron');
    expect(chevron).toBeTruthy();
    expect(chevron?.textContent).toBe('\u203A');
  });

  test('does not show chevron for non-submenu items', () => {
    const items = [{ label: 'Shuffle Songs' }];
    const { container } = renderWithStore(<ListView items={items} selectedIndex={0} />);
    expect(container.querySelector('.list-view__chevron')).toBeNull();
  });

  test('shows detail text', () => {
    const items = [{ label: 'Song', detail: 'Artist' }];
    const { getByText } = renderWithStore(<ListView items={items} selectedIndex={0} />);
    expect(getByText('Artist')).toBeTruthy();
  });

  test('scrolling down anchors selected to bottom of window', () => {
    const items = Array.from({ length: 15 }, (_, i) => ({ label: `Item ${i}` }));
    const { container, getByText } = renderWithStore(
      <ListView items={items} selectedIndex={10} />,
      { scrollDirection: 1 }
    );
    expect(getByText('Item 10')).toBeTruthy();
    // Offset = 10 - 7 + 1 = 4, so first visible is Item 4
    const rows = container.querySelectorAll('.list-view__row');
    expect(rows[0]?.textContent).toContain('Item 4');
  });

  test('scrolling up anchors selected to top of window', () => {
    const items = Array.from({ length: 15 }, (_, i) => ({ label: `Item ${i}` }));
    // First render scrolled down to index 10 — offset becomes 4
    const store = createStore();
    store.set(scrollDirectionAtom, 1);
    const { container, rerender } = render(
      <Provider store={store}>
        <ListView items={items} selectedIndex={10} />
      </Provider>
    );
    let rows = container.querySelectorAll('.list-view__row');
    expect(rows[0]?.textContent).toContain('Item 4'); // offset = 4

    // Now scroll up — direction changes, selected moves to 3 (above offset 4)
    store.set(scrollDirectionAtom, -1);
    rerender(
      <Provider store={store}>
        <ListView items={items} selectedIndex={3} />
      </Provider>
    );
    rows = container.querySelectorAll('.list-view__row');
    // Scrolling up: selected pinned to top, offset = selectedIndex = 3
    expect(rows[0]?.textContent).toContain('Item 3');
  });

  test('renders empty list without error', () => {
    const { container } = renderWithStore(<ListView items={[]} selectedIndex={0} />);
    const rows = container.querySelectorAll('.list-view__row');
    expect(rows.length).toBe(0);
  });

  test('renders all items from scroll offset onward', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ label: `Item ${i}` }));
    const { container } = renderWithStore(<ListView items={items} selectedIndex={0} />);
    const rows = container.querySelectorAll('.list-view__row');
    expect(rows.length).toBe(20);
  });
});
