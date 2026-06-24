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
 *
 * It also pins the per-device default cascade wired in on top of that resolver:
 *   - device string default (exists) → that collection, `source: 'device'`,
 *     overriding the global default
 *   - device string default (missing) → empty for that type (NO global fallback)
 *   - device `false` → empty for that type, suppressing the global default
 *   - device default absent → global fallback (`source: 'global'`)
 *   - the two content types resolve independently
 *   - the `-c` flag is a wholesale override (device defaults ignored under flag)
 *   - `device === undefined` is byte-identical to the global-only path
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

// Helper: a device with the given per-type defaults.
function makeDevice(defaults?: DeviceConfig['defaults']): {
  name: string;
  config: DeviceConfig;
} {
  return {
    name: 'terapod',
    config: { volumeName: 'TERAPOD', ...(defaults ? { defaults } : {}) },
  };
}

describe('resolveEffectiveCollections — per-device default (no-flag branch)', () => {
  it('device string default (exists) overrides a different global default (source: device)', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' }, workout: { path: '/music/workout' } },
      defaults: { music: 'main' },
    });
    const device = makeDevice({ music: 'workout' });

    const { collections } = resolveEffectiveCollections({ config, device });

    expect(collections).toEqual([
      { name: 'workout', type: 'music', config: { path: '/music/workout' }, source: 'device' },
    ]);
  });

  it('device string default that names a missing collection yields empty (no global fallback)', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' } },
      defaults: { music: 'main' },
    });
    const device = makeDevice({ music: 'ghost' });

    const { collections } = resolveEffectiveCollections({ config, device });

    // Device made an explicit choice that does not exist → nothing.
    // It must NOT fall back to the global default 'main'.
    expect(collections).toEqual([]);
  });

  it('device false suppresses the type even when a global default exists', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' } },
      defaults: { music: 'main' },
    });
    const device = makeDevice({ music: false });

    const { collections } = resolveEffectiveCollections({ config, device });

    expect(collections).toEqual([]);
  });

  it('device default absent for a type falls back to the global default (source: global)', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' } },
      defaults: { music: 'main' },
    });
    // Device sets only video; music is absent → global.
    const device = makeDevice({ video: false });

    const { collections } = resolveEffectiveCollections({ config, device });

    expect(collections).toEqual([
      { name: 'main', type: 'music', config: { path: '/music/main' }, source: 'global' },
    ]);
  });

  it('device string default equal to the global default still reports source: device', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' } },
      defaults: { music: 'main' },
    });
    // Device explicitly names the same collection the global default points at.
    const device = makeDevice({ music: 'main' });

    const { collections } = resolveEffectiveCollections({ config, device });

    expect(collections).toEqual([
      { name: 'main', type: 'music', config: { path: '/music/main' }, source: 'device' },
    ]);
  });

  it('device false on both types yields empty even with both global defaults set', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' } },
      video: { movies: { path: '/video/movies' } },
      defaults: { music: 'main', video: 'movies' },
    });
    const device = makeDevice({ music: false, video: false });

    const { collections } = resolveEffectiveCollections({ config, device });

    expect(collections).toEqual([]);
  });

  it('resolves the two content types independently (music device, video global)', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' }, workout: { path: '/music/workout' } },
      video: { movies: { path: '/video/movies' } },
      defaults: { music: 'main', video: 'movies' },
    });
    // Device overrides music, leaves video unset.
    const device = makeDevice({ music: 'workout' });

    const { collections } = resolveEffectiveCollections({ config, device });

    expect(collections).toEqual([
      { name: 'workout', type: 'music', config: { path: '/music/workout' }, source: 'device' },
      { name: 'movies', type: 'video', config: { path: '/video/movies' }, source: 'global' },
    ]);
  });

  it('device music false + device video string → music empty, video device', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' } },
      video: { movies: { path: '/video/movies' }, shows: { path: '/video/shows' } },
      defaults: { music: 'main', video: 'movies' },
    });
    const device = makeDevice({ music: false, video: 'shows' });

    const { collections } = resolveEffectiveCollections({ config, device });

    expect(collections).toEqual([
      { name: 'shows', type: 'video', config: { path: '/video/shows' }, source: 'device' },
    ]);
  });

  it('applies the type filter to the per-device cascade', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' }, workout: { path: '/music/workout' } },
      video: { movies: { path: '/video/movies' } },
      defaults: { video: 'movies' },
    });
    const device = makeDevice({ music: 'workout', video: false });

    // type=music: only music resolves; video false is irrelevant under the filter.
    const music = resolveEffectiveCollections({ config, device, type: 'music' });
    expect(music.collections).toEqual([
      { name: 'workout', type: 'music', config: { path: '/music/workout' }, source: 'device' },
    ]);

    // type=video: device video false suppresses the global video default.
    const video = resolveEffectiveCollections({ config, device, type: 'video' });
    expect(video.collections).toEqual([]);
  });
});

describe('resolveEffectiveCollections — flag is a wholesale override', () => {
  it('flag wins over a device false (source: flag, device ignored)', () => {
    const config = makeConfig({
      video: { shows: { path: '/video/shows' } },
      defaults: { video: 'movies' },
    });
    // Device opted out of video, but an explicit `-c shows` must override it.
    const device = makeDevice({ video: false });

    const { collections } = resolveEffectiveCollections({ config, flag: 'shows', device });

    expect(collections).toEqual([
      { name: 'shows', type: 'video', config: { path: '/video/shows' }, source: 'flag' },
    ]);
  });

  it('flag ignores a device string default that names a different collection', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' }, workout: { path: '/music/workout' } },
    });
    const device = makeDevice({ music: 'workout' });

    const { collections } = resolveEffectiveCollections({ config, flag: 'main', device });

    expect(collections).toEqual([
      { name: 'main', type: 'music', config: { path: '/music/main' }, source: 'flag' },
    ]);
  });
});

describe('resolveEffectiveCollections — device undefined is the global-only path', () => {
  const device = makeDevice();

  it('a device with no defaults does not change the flag result', () => {
    const config = makeConfig({ music: { main: { path: '/music/main' } } });

    const withoutDevice = resolveEffectiveCollections({ config, flag: 'main' });
    const withDevice = resolveEffectiveCollections({ config, flag: 'main', device });

    expect(withDevice.collections).toEqual(withoutDevice.collections);
  });

  it('device === undefined is byte-identical to the global-defaults result', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' } },
      video: { movies: { path: '/video/movies' } },
      defaults: { music: 'main', video: 'movies' },
    });

    const withoutDevice = resolveEffectiveCollections({ config });
    // A device whose config carries no `defaults` key → no per-device layer.
    const withDevice = resolveEffectiveCollections({ config, device });

    expect(withDevice.collections).toEqual(withoutDevice.collections);
    expect(withDevice.collections.every((c) => c.source === 'global')).toBe(true);
  });
});
