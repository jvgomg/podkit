import { describe, test, expect } from 'bun:test';
import React from 'react';
import { render } from '@testing-library/react';
import { Header } from './shared/Header.js';

describe('Header', () => {
  test('shows title', () => {
    const { getByText } = render(<Header title="Music" />);
    expect(getByText('Music')).toBeTruthy();
  });

  test('shows no indicator by default', () => {
    const { container } = render(<Header title="iPod" />);
    const indicator = container.querySelector('.ipod-header__play-indicator');
    expect(indicator?.querySelector('svg')).toBeNull();
  });

  test('shows play icon when playing', () => {
    const { container } = render(<Header title="iPod" playbackIndicator="playing" />);
    const indicator = container.querySelector('.ipod-header__play-indicator');
    expect(indicator?.querySelector('svg')).toBeTruthy();
  });

  test('shows pause icon when paused', () => {
    const { container } = render(<Header title="iPod" playbackIndicator="paused" />);
    const indicator = container.querySelector('.ipod-header__play-indicator');
    expect(indicator?.querySelector('svg')).toBeTruthy();
  });

  test('shows no indicator when none', () => {
    const { container } = render(<Header title="iPod" playbackIndicator="none" />);
    const indicator = container.querySelector('.ipod-header__play-indicator');
    expect(indicator?.querySelector('svg')).toBeNull();
  });

  test('renders battery icon', () => {
    const { container } = render(<Header title="iPod" />);
    expect(container.querySelector('.ipod-header__battery-icon')).toBeTruthy();
  });
});
