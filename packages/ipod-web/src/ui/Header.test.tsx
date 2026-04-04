import { describe, test, expect } from 'bun:test';
import React from 'react';
import { render } from '@testing-library/react';
import { Header } from './shared/Header.js';

describe('Header', () => {
  test('shows title', () => {
    const { getByText } = render(<Header title="Music" />);
    expect(getByText('Music')).toBeTruthy();
  });

  test('hides play indicator by default', () => {
    const { container } = render(<Header title="iPod" />);
    const indicator = container.querySelector('.ipod-header__play-indicator');
    expect(indicator?.textContent).toBe('');
  });

  test('shows play indicator when enabled', () => {
    const { container } = render(<Header title="iPod" showPlayIndicator />);
    const indicator = container.querySelector('.ipod-header__play-indicator');
    expect(indicator?.textContent).toBe('\u25B6');
  });

  test('renders battery icon', () => {
    const { container } = render(<Header title="iPod" />);
    expect(container.querySelector('.ipod-header__battery-icon')).toBeTruthy();
  });
});
