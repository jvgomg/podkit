/**
 * Tests for the effective (multi-type, provenance-carrying) collection resolver.
 *
 * This is the extracted+unified replacement for the inline cascade that used
 * to live in the sync command. These tests pin the behaviour that must stay
 * identical to that inline resolver:
 *   - `-c <name>` matching a music name, a video name, or BOTH
 *   - the `-t` type filter
 *   - global-defaults fallback when no flag
 *   - empty result (no throw) when a flag matches nothing / no default exists
 *   - the `source` provenance label on every result
 *   - the `device` input being accepted but ignored this slice
 */

import { describe, it, expect } from 'bun:test';
import { resolveEffectiveCollections } from './effective-collections.js';
import type { PodkitConfig, DeviceConfig } from '../config/types.js';
import { DEFAULT_TRANSFORMS_CONFIG, DEFAULT_VIDEO_TRANSFORMS_CONFIG } from '../config/types.js';

// Minimal config for testing.
function makeConfig(overrides: Partial<PodkitConfig> = {}): PodkitConfig {
  return {
    quality: 'high',
    artwork: true,
    tips: true,
    transforms: DEFAULT_TRANSFORMS_CONFIG,
    videoTransforms: DEFAULT_VIDEO_TRANSFORMS_CONFIG,
    ...overrides,
  };
}

describe('resolveEffectiveCollections — flag branch', () => {
  it('resolves a flag that matches a music name (source: flag)', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' } },
      video: { movies: { path: '/video/movies' } },
    });

    const { collections } = resolveEffectiveCollections({ config, flag: 'main' });

    expect(collections).toEqual([
      { name: 'main', type: 'music', config: { path: '/music/main' }, source: 'flag' },
    ]);
  });

  it('resolves a flag that matches a video name (source: flag)', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' } },
      video: { movies: { path: '/video/movies' } },
    });

    const { collections } = resolveEffectiveCollections({ config, flag: 'movies' });

    expect(collections).toEqual([
      { name: 'movies', type: 'video', config: { path: '/video/movies' }, source: 'flag' },
    ]);
  });

  it('resolves a flag present in BOTH namespaces to both collections', () => {
    const config = makeConfig({
      music: { shared: { path: '/music/shared' } },
      video: { shared: { path: '/video/shared' } },
    });

    const { collections } = resolveEffectiveCollections({ config, flag: 'shared' });

    expect(collections).toHaveLength(2);
    expect(collections).toEqual([
      { name: 'shared', type: 'music', config: { path: '/music/shared' }, source: 'flag' },
      { name: 'shared', type: 'video', config: { path: '/video/shared' }, source: 'flag' },
    ]);
  });

  it('returns an empty result (no throw) when a flag matches nothing', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' } },
      video: { movies: { path: '/video/movies' } },
    });

    const { collections } = resolveEffectiveCollections({ config, flag: 'nonexistent' });

    expect(collections).toEqual([]);
  });
});

describe('resolveEffectiveCollections — type filter', () => {
  const config = makeConfig({
    music: { shared: { path: '/music/shared' } },
    video: { shared: { path: '/video/shared' } },
  });

  it('type=music with a both-namespace flag yields only the music collection', () => {
    const { collections } = resolveEffectiveCollections({ config, flag: 'shared', type: 'music' });
    expect(collections).toEqual([
      { name: 'shared', type: 'music', config: { path: '/music/shared' }, source: 'flag' },
    ]);
  });

  it('type=video with a both-namespace flag yields only the video collection', () => {
    const { collections } = resolveEffectiveCollections({ config, flag: 'shared', type: 'video' });
    expect(collections).toEqual([
      { name: 'shared', type: 'video', config: { path: '/video/shared' }, source: 'flag' },
    ]);
  });

  it('type=music suppresses a video-only flag match (empty)', () => {
    const videoOnly = makeConfig({ video: { movies: { path: '/video/movies' } } });
    const { collections } = resolveEffectiveCollections({
      config: videoOnly,
      flag: 'movies',
      type: 'music',
    });
    expect(collections).toEqual([]);
  });
});

describe('resolveEffectiveCollections — global defaults fallback', () => {
  it('falls back to defaults.music + defaults.video when no flag (source: global)', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' }, other: { path: '/music/other' } },
      video: { movies: { path: '/video/movies' } },
      defaults: { music: 'main', video: 'movies' },
    });

    const { collections } = resolveEffectiveCollections({ config });

    expect(collections).toEqual([
      { name: 'main', type: 'music', config: { path: '/music/main' }, source: 'global' },
      { name: 'movies', type: 'video', config: { path: '/video/movies' }, source: 'global' },
    ]);
  });

  it('applies the type filter to the defaults fallback', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' } },
      video: { movies: { path: '/video/movies' } },
      defaults: { music: 'main', video: 'movies' },
    });

    const { collections } = resolveEffectiveCollections({ config, type: 'music' });

    expect(collections).toEqual([
      { name: 'main', type: 'music', config: { path: '/music/main' }, source: 'global' },
    ]);
  });

  it('type=video with only a music default yields empty', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' } },
      defaults: { music: 'main' },
    });

    const { collections } = resolveEffectiveCollections({ config, type: 'video' });

    expect(collections).toEqual([]);
  });

  it('omits a default that points at a non-existent collection (no throw)', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' } },
      defaults: { music: 'ghost' },
    });

    const { collections } = resolveEffectiveCollections({ config });

    expect(collections).toEqual([]);
  });

  it('returns empty when no flag and no defaults are configured', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' } },
      video: { movies: { path: '/video/movies' } },
    });

    const { collections } = resolveEffectiveCollections({ config });

    expect(collections).toEqual([]);
  });

  it('returns empty for an entirely empty config', () => {
    const { collections } = resolveEffectiveCollections({ config: makeConfig() });
    expect(collections).toEqual([]);
  });
});

describe('resolveEffectiveCollections — device input is ignored this slice', () => {
  const device: { name: string; config: DeviceConfig } = {
    name: 'terapod',
    config: { volumeName: 'TERAPOD' },
  };

  it('passing a device does not change the flag result', () => {
    const config = makeConfig({ music: { main: { path: '/music/main' } } });

    const withoutDevice = resolveEffectiveCollections({ config, flag: 'main' });
    const withDevice = resolveEffectiveCollections({ config, flag: 'main', device });

    expect(withDevice.collections).toEqual(withoutDevice.collections);
  });

  it('passing a device does not change the global-defaults result', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' } },
      defaults: { music: 'main' },
    });

    const withoutDevice = resolveEffectiveCollections({ config });
    const withDevice = resolveEffectiveCollections({ config, device });

    expect(withDevice.collections).toEqual(withoutDevice.collections);
    // Still 'global' — not 'device' — because the per-device layer is not wired yet.
    expect(withDevice.collections[0]?.source).toBe('global');
  });
});
