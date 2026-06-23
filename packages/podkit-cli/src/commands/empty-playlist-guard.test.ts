import { describe, expect, it } from 'bun:test';
import { decideEmptyPlaylist } from './empty-playlist-guard.js';

describe('decideEmptyPlaylist', () => {
  describe('non-empty playlist', () => {
    it('proceeds regardless of interactivity or override', () => {
      for (const interactive of [true, false]) {
        for (const allowEmpty of [true, false]) {
          expect(decideEmptyPlaylist(1, { interactive, allowEmpty })).toBe('proceed');
        }
      }
    });

    it('proceeds for a large count', () => {
      expect(decideEmptyPlaylist(500, { interactive: false, allowEmpty: false })).toBe('proceed');
    });
  });

  describe('empty playlist', () => {
    it('confirms when interactive and not overridden', () => {
      expect(decideEmptyPlaylist(0, { interactive: true, allowEmpty: false })).toBe('confirm');
    });

    it('aborts when headless and not overridden', () => {
      expect(decideEmptyPlaylist(0, { interactive: false, allowEmpty: false })).toBe('abort');
    });

    it('proceeds when overridden, interactive', () => {
      // --yes / allowEmptyPlaylist short-circuits the confirm prompt.
      expect(decideEmptyPlaylist(0, { interactive: true, allowEmpty: true })).toBe('proceed');
    });

    it('proceeds when overridden, headless', () => {
      // Daemon path: allowEmptyPlaylist lets a headless run through.
      expect(decideEmptyPlaylist(0, { interactive: false, allowEmpty: true })).toBe('proceed');
    });
  });
});
