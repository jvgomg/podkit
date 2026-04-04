import { describe, test, expect, mock } from 'bun:test';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { ClickWheel } from './ClickWheel.js';

function renderWheel(overrides: Partial<React.ComponentProps<typeof ClickWheel>> = {}) {
  const props = {
    onScroll: mock(() => {}),
    onSelect: mock(() => {}),
    onMenu: mock(() => {}),
    onPlayPause: mock(() => {}),
    onPrevious: mock(() => {}),
    onNext: mock(() => {}),
    ...overrides,
  };
  const result = render(<ClickWheel {...props} />);
  const wheel = result.container.querySelector('.click-wheel') as HTMLElement;
  return { ...result, wheel, props };
}

describe('ClickWheel', () => {
  test('renders without crashing', () => {
    const { wheel } = renderWheel();
    expect(wheel).toBeTruthy();
    expect(wheel.querySelector('.click-wheel__center')).toBeTruthy();
  });

  test('component is focusable', () => {
    const { wheel } = renderWheel();
    expect(wheel.getAttribute('tabindex')).toBe('0');
  });

  test('renders button labels', () => {
    const { wheel } = renderWheel();
    expect(wheel.textContent).toContain('MENU');
    // Check for transport symbols
    expect(wheel.querySelectorAll('.click-wheel__label').length).toBe(4);
  });

  test('applies custom className', () => {
    const { wheel } = renderWheel({ className: 'my-custom' });
    expect(wheel.classList.contains('my-custom')).toBe(true);
  });

  describe('keyboard input', () => {
    test('ArrowDown calls onScroll(1)', () => {
      const { wheel, props } = renderWheel();
      fireEvent.keyDown(wheel, { key: 'ArrowDown' });
      expect(props.onScroll).toHaveBeenCalledWith(1);
    });

    test('ArrowUp calls onScroll(-1)', () => {
      const { wheel, props } = renderWheel();
      fireEvent.keyDown(wheel, { key: 'ArrowUp' });
      expect(props.onScroll).toHaveBeenCalledWith(-1);
    });

    test('Enter calls onSelect()', () => {
      const { wheel, props } = renderWheel();
      fireEvent.keyDown(wheel, { key: 'Enter' });
      expect(props.onSelect).toHaveBeenCalled();
    });

    test('ArrowRight calls onSelect()', () => {
      const { wheel, props } = renderWheel();
      fireEvent.keyDown(wheel, { key: 'ArrowRight' });
      expect(props.onSelect).toHaveBeenCalled();
    });

    test('Escape calls onMenu()', () => {
      const { wheel, props } = renderWheel();
      fireEvent.keyDown(wheel, { key: 'Escape' });
      expect(props.onMenu).toHaveBeenCalled();
    });

    test('ArrowLeft calls onMenu()', () => {
      const { wheel, props } = renderWheel();
      fireEvent.keyDown(wheel, { key: 'ArrowLeft' });
      expect(props.onMenu).toHaveBeenCalled();
    });

    test('Space calls onPlayPause()', () => {
      const { wheel, props } = renderWheel();
      fireEvent.keyDown(wheel, { key: ' ' });
      expect(props.onPlayPause).toHaveBeenCalled();
    });
  });

  describe('button zones', () => {
    // Note: Rotational drag testing is impractical in unit tests due to
    // the need for precise pointer coordinates relative to a sized element.
    // Rotation is tested manually via the dev server.

    test('center button click calls onSelect()', () => {
      const { wheel, props } = renderWheel();
      // Mock getBoundingClientRect to simulate a 200x200 wheel at (0,0)
      wheel.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 200,
        bottom: 200,
        width: 200,
        height: 200,
        toJSON: () => {},
      });
      // Click at center (100, 100)
      fireEvent.pointerDown(wheel, { clientX: 100, clientY: 100 });
      fireEvent.pointerUp(wheel, { clientX: 100, clientY: 100 });
      expect(props.onSelect).toHaveBeenCalled();
    });
  });
});
