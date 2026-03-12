import { describe, expect, it } from 'bun:test';
import { colorize, needsContrastOutline, ALL_COLORS, getColorLabel } from './colors.js';
import type { AvatarColor } from './types.js';

describe('colorize', () => {
  it('applies ANSI background color', () => {
    const result = colorize('test', 'red');
    expect(result).toContain('\x1b[48;5;196m');
    expect(result).toContain('test');
    expect(result).toEndWith('\x1b[0m');
  });

  it('returns plain text when noColor is true', () => {
    const result = colorize('test', 'red', true);
    expect(result).toBe('test');
  });
});

describe('needsContrastOutline', () => {
  it('returns true for black on dark', () => {
    expect(needsContrastOutline('black', 'dark')).toBe(true);
  });

  it('returns true for white on light', () => {
    expect(needsContrastOutline('white', 'light')).toBe(true);
  });

  it('returns false for silver on dark', () => {
    expect(needsContrastOutline('silver', 'dark')).toBe(false);
  });

  it('returns false for black on light', () => {
    expect(needsContrastOutline('black', 'light')).toBe(false);
  });
});

describe('ALL_COLORS', () => {
  it('contains 11 colors', () => {
    expect(ALL_COLORS).toHaveLength(11);
  });

  it('has labels for all colors', () => {
    for (const color of ALL_COLORS) {
      expect(getColorLabel(color)).toBeTruthy();
    }
  });
});
