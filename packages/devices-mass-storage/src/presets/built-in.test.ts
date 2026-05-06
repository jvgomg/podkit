/**
 * Tests for built-in mass-storage device presets.
 *
 * Migrated from packages/podkit-core/src/device/presets.test.ts — covers the
 * static preset data that moved into this package. Tests for runtime functions
 * (resolveDeviceCapabilities, getDevicePreset) remain in podkit-core until the
 * shim is replaced in TASK-294.12.
 */

import { describe, expect, it } from 'bun:test';
import { BUILT_IN_PRESETS } from './built-in.js';
import { BUILT_IN_PRESET_IDS } from './types.js';

// Sentinel: verify the public import surface works end-to-end.
describe('import @podkit/devices-mass-storage (via relative paths)', () => {
  it('exports BUILT_IN_PRESETS', () => {
    expect(BUILT_IN_PRESETS).toBeDefined();
  });

  it('exports BUILT_IN_PRESET_IDS', () => {
    expect(BUILT_IN_PRESET_IDS).toEqual(['echo-mini', 'rockbox', 'generic']);
  });
});

describe('BUILT_IN_PRESETS', () => {
  it('contains all three built-in presets', () => {
    expect(Object.keys(BUILT_IN_PRESETS)).toEqual(['echo-mini', 'rockbox', 'generic']);
  });

  it('echo-mini supports Album Artist browsing', () => {
    expect(BUILT_IN_PRESETS['echo-mini'].supportsAlbumArtistBrowsing).toBe(true);
  });

  it('rockbox supports Album Artist browsing', () => {
    expect(BUILT_IN_PRESETS.rockbox.supportsAlbumArtistBrowsing).toBe(true);
  });

  it('generic supports Album Artist browsing', () => {
    expect(BUILT_IN_PRESETS.generic.supportsAlbumArtistBrowsing).toBe(true);
  });

  it('echo-mini has root musicDir (empty string)', () => {
    expect(BUILT_IN_PRESETS['echo-mini'].contentPaths.musicDir).toBe('');
  });

  it('echo-mini has explicit Video/Movies and Video/Shows paths', () => {
    expect(BUILT_IN_PRESETS['echo-mini'].contentPaths.moviesDir).toBe('Video/Movies');
    expect(BUILT_IN_PRESETS['echo-mini'].contentPaths.tvShowsDir).toBe('Video/Shows');
  });

  it('rockbox uses default content paths', () => {
    expect(BUILT_IN_PRESETS.rockbox.contentPaths).toEqual({
      musicDir: 'Music',
      moviesDir: 'Video/Movies',
      tvShowsDir: 'Video/Shows',
    });
  });

  it('generic uses default content paths', () => {
    expect(BUILT_IN_PRESETS.generic.contentPaths).toEqual({
      musicDir: 'Music',
      moviesDir: 'Video/Movies',
      tvShowsDir: 'Video/Shows',
    });
  });

  it('all presets have contentPaths with string fields', () => {
    for (const [, preset] of Object.entries(BUILT_IN_PRESETS)) {
      expect(preset.contentPaths).toBeDefined();
      expect(typeof preset.contentPaths.musicDir).toBe('string');
      expect(typeof preset.contentPaths.moviesDir).toBe('string');
      expect(typeof preset.contentPaths.tvShowsDir).toBe('string');
    }
  });

  it('rockbox supports replaygain normalization', () => {
    expect(BUILT_IN_PRESETS.rockbox.audioNormalization).toBe('replaygain');
  });

  it('echo-mini and generic have no audio normalization', () => {
    expect(BUILT_IN_PRESETS['echo-mini'].audioNormalization).toBe('none');
    expect(BUILT_IN_PRESETS.generic.audioNormalization).toBe('none');
  });

  it('rockbox supports more codecs than generic', () => {
    expect(BUILT_IN_PRESETS.rockbox.supportedAudioCodecs.length).toBeGreaterThan(
      BUILT_IN_PRESETS.generic.supportedAudioCodecs.length
    );
  });

  it('rockbox supports opus codec', () => {
    expect(BUILT_IN_PRESETS.rockbox.supportedAudioCodecs).toContain('opus');
  });

  it('echo-mini has lower max artwork resolution than generic', () => {
    const echoMini = BUILT_IN_PRESETS['echo-mini'].artworkMaxResolution;
    const generic = BUILT_IN_PRESETS.generic.artworkMaxResolution;
    expect(echoMini).not.toBeNull();
    expect(generic).not.toBeNull();
    expect(echoMini!).toBeLessThan(generic!);
  });

  it('rockbox supports sidecar artwork', () => {
    expect(BUILT_IN_PRESETS.rockbox.artworkSources).toContain('sidecar');
  });

  it('none of the built-in presets support video', () => {
    for (const [, preset] of Object.entries(BUILT_IN_PRESETS)) {
      expect(preset.supportsVideo).toBe(false);
    }
  });
});
