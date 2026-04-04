import { describe, test, expect } from 'bun:test';
import React from 'react';
import { render } from '@testing-library/react';
import { VirtualIpod } from './VirtualIpod.js';

describe('VirtualIpod', () => {
  test('renders without crashing', () => {
    const { container } = render(<VirtualIpod />);
    expect(container.firstChild).toBeTruthy();
  });

  test('renders with white variant by default', () => {
    const { container } = render(<VirtualIpod />);
    expect(container.querySelector('[data-variant="white"]')).toBeTruthy();
  });

  test('renders with black variant', () => {
    const { container } = render(<VirtualIpod variant="black" />);
    expect(container.querySelector('[data-variant="black"]')).toBeTruthy();
  });

  test('contains screen and wheel areas', () => {
    const { container } = render(<VirtualIpod />);
    expect(container.querySelector('.ipod-shell__screen-area')).toBeTruthy();
    expect(container.querySelector('.ipod-shell__wheel-area')).toBeTruthy();
  });
});
