import { describe, test, expect } from 'bun:test';
import React from 'react';
import { render } from '@testing-library/react';
import { Screen } from './Screen.js';

describe('Screen', () => {
  test('renders children', () => {
    const { getByText } = render(
      <Screen>
        <div>screen content</div>
      </Screen>
    );
    expect(getByText('screen content')).toBeTruthy();
  });

  test('renders bezel wrapper', () => {
    const { container } = render(
      <Screen>
        <div />
      </Screen>
    );
    expect(container.querySelector('.ipod-screen__bezel')).toBeTruthy();
  });
});
