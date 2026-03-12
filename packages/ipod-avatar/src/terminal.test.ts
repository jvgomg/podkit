import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { detectTheme, shouldShowAvatar } from './terminal.js';

describe('detectTheme', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns override when not auto', () => {
    expect(detectTheme('dark')).toBe('dark');
    expect(detectTheme('light')).toBe('light');
  });

  it('detects dark from COLORFGBG', () => {
    process.env['COLORFGBG'] = '15;0';
    expect(detectTheme('auto')).toBe('dark');
  });

  it('detects light from COLORFGBG', () => {
    process.env['COLORFGBG'] = '0;15';
    expect(detectTheme('auto')).toBe('light');
  });

  it('falls back to dark when no env hints', () => {
    delete process.env['COLORFGBG'];
    delete process.env['TERM_PROGRAM'];
    expect(detectTheme('auto')).toBe('dark');
  });
});

describe('shouldShowAvatar', () => {
  it('returns false when noAvatar is set', () => {
    expect(shouldShowAvatar({ noAvatar: true })).toBe(false);
  });

  it('returns false when json is set', () => {
    expect(shouldShowAvatar({ json: true })).toBe(false);
  });

  it('returns false when quiet is set', () => {
    expect(shouldShowAvatar({ quiet: true })).toBe(false);
  });

  it('returns false when config disabled', () => {
    expect(shouldShowAvatar({ configEnabled: false })).toBe(false);
  });
});
