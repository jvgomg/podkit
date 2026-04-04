import { describe, test, expect } from 'bun:test';
import React from 'react';
import { render } from '@testing-library/react';
import { Shell } from './Shell.js';

describe('Shell', () => {
  test('renders children', () => {
    const { getByText } = render(
      <Shell>
        <div>content</div>
      </Shell>
    );
    expect(getByText('content')).toBeTruthy();
  });

  test('applies white variant by default', () => {
    const { container } = render(
      <Shell>
        <div />
      </Shell>
    );
    expect(container.querySelector('[data-variant="white"]')).toBeTruthy();
  });

  test('applies black variant when specified', () => {
    const { container } = render(
      <Shell variant="black">
        <div />
      </Shell>
    );
    expect(container.querySelector('[data-variant="black"]')).toBeTruthy();
  });

  test('includes drag regions', () => {
    const { container } = render(
      <Shell>
        <div />
      </Shell>
    );
    const dragRegions = container.querySelectorAll('[data-tauri-drag-region]');
    expect(dragRegions.length).toBeGreaterThanOrEqual(1);
  });
});
