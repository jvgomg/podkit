import React, { useMemo } from 'react';
import type { MenuItem } from '../../firmware/types.js';
import './ListView.css';

export interface ListViewProps {
  items: MenuItem[];
  selectedIndex: number;
  maxVisible?: number;
}

export function ListView({ items, selectedIndex, maxVisible = 7 }: ListViewProps) {
  const scrollOffset = useMemo(() => {
    let offset = 0;
    if (selectedIndex >= offset + maxVisible) {
      offset = selectedIndex - maxVisible + 1;
    }
    if (selectedIndex < offset) {
      offset = selectedIndex;
    }
    return offset;
  }, [selectedIndex, maxVisible]);

  const visibleItems = items.slice(scrollOffset, scrollOffset + maxVisible);

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
