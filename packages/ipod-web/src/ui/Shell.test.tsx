import { afterEach, describe, test, expect } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import { Shell } from './Shell.js';

afterEach(cleanup);

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
});
