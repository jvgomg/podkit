import { describe, test, expect } from 'bun:test';
import React from 'react';
import { render } from '@testing-library/react';
import { ListView } from './ListView.js';

describe('ListView', () => {
  test('renders items', () => {
    const items = [
      { label: 'Music', hasSubmenu: true },
      { label: 'Settings', hasSubmenu: true },
    ];
    const { container } = render(<ListView items={items} selectedIndex={0} />);
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
    const { container } = render(<ListView items={items} selectedIndex={1} />);
    const rows = container.querySelectorAll('.list-view__row');
    expect(rows[0]?.classList.contains('list-view__row--selected')).toBe(false);
    expect(rows[1]?.classList.contains('list-view__row--selected')).toBe(true);
  });

  test('shows chevron for submenu items', () => {
    const items = [{ label: 'Music', hasSubmenu: true }];
    const { container } = render(<ListView items={items} selectedIndex={0} />);
    const chevron = container.querySelector('.list-view__chevron');
    expect(chevron).toBeTruthy();
    expect(chevron?.textContent).toBe('\u203A');
  });

  test('does not show chevron for non-submenu items', () => {
    const items = [{ label: 'Shuffle Songs' }];
    const { container } = render(<ListView items={items} selectedIndex={0} />);
    expect(container.querySelector('.list-view__chevron')).toBeNull();
  });

  test('shows detail text', () => {
    const items = [{ label: 'Song', detail: 'Artist' }];
    const { getByText } = render(<ListView items={items} selectedIndex={0} />);
    expect(getByText('Artist')).toBeTruthy();
  });

  test('auto-scrolls to keep selected visible', () => {
    const items = Array.from({ length: 15 }, (_, i) => ({ label: `Item ${i}` }));
    const { container, getByText } = render(
      <ListView items={items} selectedIndex={10} maxVisible={7} />
    );
    // Selected item (index 10) should be visible
    expect(getByText('Item 10')).toBeTruthy();
    // Items before the scroll window should not be rendered
    const rows = container.querySelectorAll('.list-view__row');
    expect(rows.length).toBe(7);
    // First visible item should be index 4 (10 - 7 + 1 = 4)
    expect(rows[0]?.textContent).toContain('Item 4');
  });

  test('renders empty list without error', () => {
    const { container } = render(<ListView items={[]} selectedIndex={0} />);
    const rows = container.querySelectorAll('.list-view__row');
    expect(rows.length).toBe(0);
  });

  test('limits rendered items to maxVisible', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ label: `Item ${i}` }));
    const { container } = render(<ListView items={items} selectedIndex={0} maxVisible={5} />);
    const rows = container.querySelectorAll('.list-view__row');
    expect(rows.length).toBe(5);
  });
});
