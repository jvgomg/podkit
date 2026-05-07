import { describe, expect, it } from 'bun:test';
import { BUILT_IN_PRESETS } from '@podkit/devices-mass-storage';
import { DEFAULT_CONTENT_PATHS } from '@podkit/devices-mass-storage';
import { resolveCapabilities } from './resolve-capabilities.js';

describe('BUILT_IN_PRESETS', () => {
  it('echo-mini supports Album Artist browsing', () => {
    expect(BUILT_IN_PRESETS['echo-mini'].supportsAlbumArtistBrowsing).toBe(true);
  });

  it('rockbox supports Album Artist browsing', () => {
    expect(BUILT_IN_PRESETS.rockbox.supportsAlbumArtistBrowsing).toBe(true);
  });

  it('generic supports Album Artist browsing', () => {
    expect(BUILT_IN_PRESETS.generic.supportsAlbumArtistBrowsing).toBe(true);
  });

  it('echo-mini has root musicDir', () => {
    expect(BUILT_IN_PRESETS['echo-mini'].contentPaths.musicDir).toBe('');
  });

  it('rockbox uses default content paths', () => {
    expect(BUILT_IN_PRESETS.rockbox.contentPaths).toEqual(DEFAULT_CONTENT_PATHS);
  });

  it('generic uses default content paths', () => {
    expect(BUILT_IN_PRESETS.generic.contentPaths).toEqual(DEFAULT_CONTENT_PATHS);
  });

  it('all presets have contentPaths', () => {
    for (const [, preset] of Object.entries(BUILT_IN_PRESETS)) {
      expect(preset.contentPaths).toBeDefined();
      expect(typeof preset.contentPaths.musicDir).toBe('string');
      expect(typeof preset.contentPaths.moviesDir).toBe('string');
      expect(typeof preset.contentPaths.tvShowsDir).toBe('string');
    }
  });
});

describe('resolveCapabilities (mass-storage path)', () => {
  it('returns preset capabilities as-is when no overrides', () => {
    const caps = resolveCapabilities({ kind: 'mass-storage', presetId: 'rockbox' });
    const { contentPaths: _omit, ...expected } = BUILT_IN_PRESETS.rockbox;
    expect(caps).toEqual(expected);
  });

  it('throws for unknown device type', () => {
    expect(() =>
      resolveCapabilities({ kind: 'mass-storage', presetId: 'unknown-device' })
    ).toThrow();
  });

  it('merges supportsAlbumArtistBrowsing override', () => {
    const caps = resolveCapabilities(
      { kind: 'mass-storage', presetId: 'generic' },
      { overrides: { supportsAlbumArtistBrowsing: false } }
    );
    expect(caps.supportsAlbumArtistBrowsing).toBe(false);
    expect(caps.supportedAudioCodecs).toEqual(BUILT_IN_PRESETS.generic.supportedAudioCodecs);
  });

  it('merges artworkMaxResolution override while keeping other fields', () => {
    const caps = resolveCapabilities(
      { kind: 'mass-storage', presetId: 'rockbox' },
      { overrides: { artworkMaxResolution: 100 } }
    );
    expect(caps.supportsAlbumArtistBrowsing).toBe(true);
    expect(caps.artworkMaxResolution).toBe(100);
  });
});

describe('BUILT_IN_PRESETS direct lookup', () => {
  it('returns preset for known types', () => {
    expect(BUILT_IN_PRESETS['echo-mini']).toBeDefined();
    expect(BUILT_IN_PRESETS.rockbox).toBeDefined();
    expect(BUILT_IN_PRESETS.generic).toBeDefined();
  });

  it('ipod is not a built-in mass-storage preset', () => {
    expect((BUILT_IN_PRESETS as Record<string, unknown>)['ipod']).toBeUndefined();
  });

  it('includes contentPaths in echo-mini preset', () => {
    const preset = BUILT_IN_PRESETS['echo-mini'];
    expect(preset.contentPaths.musicDir).toBe('');
    expect(preset.contentPaths.moviesDir).toBe('Video/Movies');
    expect(preset.contentPaths.tvShowsDir).toBe('Video/Shows');
  });
});
