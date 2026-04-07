import React, { useMemo, useRef } from 'react';
import { useAtomValue } from 'jotai';
import type { MenuItem } from '../../firmware/types.js';
import { scrollDirectionAtom } from '../../store/navigation.js';
import './ListView.css';

export interface ListViewProps {
  items: MenuItem[];
  selectedIndex: number;
}

/** Number of fully visible rows used for scroll offset calculation. */
const PAGE_SIZE = 7;

export function ListView({ items, selectedIndex }: ListViewProps) {
  const scrollDirection = useAtomValue(scrollDirectionAtom);
  const offsetRef = useRef(0);

  const scrollOffset = useMemo(() => {
    let offset = offsetRef.current;

    // Clamp offset so the selected item is always visible.
    // When scrolling down: selected item hits the bottom of the page, then
    // the list starts scrolling (selected pinned to bottom).
    // When scrolling up: selected item hits the top of the page, then
    // the list starts scrolling (selected pinned to top).
    if (scrollDirection === 1) {
      // Scrolling down — keep selected at bottom of visible window
      if (selectedIndex >= offset + PAGE_SIZE) {
        offset = selectedIndex - PAGE_SIZE + 1;
      }
      if (selectedIndex < offset) {
        offset = selectedIndex;
      }
    } else {
      // Scrolling up — keep selected at top of visible window
      if (selectedIndex < offset) {
        offset = selectedIndex;
      }
      if (selectedIndex >= offset + PAGE_SIZE) {
        offset = selectedIndex - PAGE_SIZE + 1;
      }
    }

    // Clamp offset to valid range
    const maxOffset = Math.max(0, items.length - PAGE_SIZE);
    offset = Math.max(0, Math.min(maxOffset, offset));

    offsetRef.current = offset;
    return offset;
  }, [selectedIndex, scrollDirection, items.length]);

  // Render all items from the scroll offset onward — CSS overflow: hidden on
  // the screen container will clip, allowing a partial row to show at the bottom.
  const visibleItems = items.slice(scrollOffset);

  return (
    <div className="list-view">
      {visibleItems.map((item, i) => {
        const actualIndex = scrollOffset + i;
        const isSelected = actualIndex === selectedIndex;
        return (
          <div
            key={`${actualIndex}-${item.label}`}
            className={`list-view__row${isSelected ? ' list-view__row--selected' : ''}`}
          >
            <span className="list-view__label">{item.label}</span>
            {item.detail && <span className="list-view__detail">{item.detail}</span>}
            {item.hasSubmenu && <span className="list-view__chevron">{'\u203A'}</span>}
          </div>
        );
      })}
    </div>
  );
}
