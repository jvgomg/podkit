/**
 * Tests for the default-collection state classifier + formatter.
 *
 * The classifier is the *display* counterpart to `resolveEffectiveCollections`:
 * where the sync resolver drops the `false` ("none") and missing-name cases,
 * this surfaces the full tri-state so `device info` / `device list` can render
 * provenance. These tests pin all five states for both content types, plus the
 * formatter's state → string mapping.
 */

import { describe, it, expect } from 'bun:test';
import {
  classifyDeviceDefault,
  formatDefaultCollection,
  type DefaultCollectionState,
} from './default-collection-state.js';
import type { PodkitConfig, DeviceConfig } from '../config/types.js';
import { DEFAULT_TRANSFORMS_CONFIG, DEFAULT_VIDEO_TRANSFORMS_CONFIG } from '../config/types.js';

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

function makeDevice(defaults?: DeviceConfig['defaults']): DeviceConfig {
  return { volumeName: 'TERAPOD', ...(defaults ? { defaults } : {}) };
}

describe('classifyDeviceDefault — music', () => {
  it('name: device default that exists', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' }, workout: { path: '/music/workout' } },
      defaults: { music: 'main' },
    });
    const state = classifyDeviceDefault(config, makeDevice({ music: 'workout' }), 'music');
    expect(state).toEqual({ kind: 'name', name: 'workout', source: 'device' });
  });

  it('missing: device default that is not in config (no global fallback)', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' } },
      defaults: { music: 'main' },
    });
    const state = classifyDeviceDefault(config, makeDevice({ music: 'ghost' }), 'music');
    expect(state).toEqual({ kind: 'missing', name: 'ghost', source: 'device' });
  });

  it('inherited: device unset → existing global default', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' } },
      defaults: { music: 'main' },
    });
    const state = classifyDeviceDefault(config, makeDevice(), 'music');
    expect(state).toEqual({ kind: 'inherited', name: 'main', source: 'global' });
  });

  it('none: device false', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' } },
      defaults: { music: 'main' },
    });
    const state = classifyDeviceDefault(config, makeDevice({ music: false }), 'music');
    expect(state).toEqual({ kind: 'none', source: 'device' });
  });

  it('empty: nothing set and no global default', () => {
    const config = makeConfig({ music: { main: { path: '/music/main' } } });
    const state = classifyDeviceDefault(config, makeDevice(), 'music');
    expect(state).toEqual({ kind: 'empty' });
  });

  it('empty: device unset with a ghost global default (set but missing)', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' } },
      defaults: { music: 'ghost' },
    });
    const state = classifyDeviceDefault(config, makeDevice(), 'music');
    expect(state).toEqual({ kind: 'empty' });
  });

  it('empty: undefined device config behaves like no per-device layer', () => {
    const config = makeConfig({ music: { main: { path: '/music/main' } } });
    const state = classifyDeviceDefault(config, undefined, 'music');
    expect(state).toEqual({ kind: 'empty' });
  });
});

describe('classifyDeviceDefault — video', () => {
  it('name: device default that exists', () => {
    const config = makeConfig({
      video: { movies: { path: '/video/movies' }, shows: { path: '/video/shows' } },
      defaults: { video: 'movies' },
    });
    const state = classifyDeviceDefault(config, makeDevice({ video: 'shows' }), 'video');
    expect(state).toEqual({ kind: 'name', name: 'shows', source: 'device' });
  });

  it('missing: device default that is not in config', () => {
    const config = makeConfig({ video: { movies: { path: '/video/movies' } } });
    const state = classifyDeviceDefault(config, makeDevice({ video: 'ghost' }), 'video');
    expect(state).toEqual({ kind: 'missing', name: 'ghost', source: 'device' });
  });

  it('inherited: device unset → existing global default', () => {
    const config = makeConfig({
      video: { movies: { path: '/video/movies' } },
      defaults: { video: 'movies' },
    });
    const state = classifyDeviceDefault(config, makeDevice(), 'video');
    expect(state).toEqual({ kind: 'inherited', name: 'movies', source: 'global' });
  });

  it('none: device false', () => {
    const config = makeConfig({
      video: { movies: { path: '/video/movies' } },
      defaults: { video: 'movies' },
    });
    const state = classifyDeviceDefault(config, makeDevice({ video: false }), 'video');
    expect(state).toEqual({ kind: 'none', source: 'device' });
  });

  it('empty: nothing set and no global default', () => {
    const config = makeConfig({ video: { movies: { path: '/video/movies' } } });
    const state = classifyDeviceDefault(config, makeDevice(), 'video');
    expect(state).toEqual({ kind: 'empty' });
  });

  it('resolves music and video independently on the same device', () => {
    const config = makeConfig({
      music: { main: { path: '/music/main' } },
      video: { movies: { path: '/video/movies' }, shows: { path: '/video/shows' } },
      defaults: { music: 'main', video: 'movies' },
    });
    const device = makeDevice({ video: 'shows' });
    expect(classifyDeviceDefault(config, device, 'music')).toEqual({
      kind: 'inherited',
      name: 'main',
      source: 'global',
    });
    expect(classifyDeviceDefault(config, device, 'video')).toEqual({
      kind: 'name',
      name: 'shows',
      source: 'device',
    });
  });
});

describe('formatDefaultCollection', () => {
  const cases: Array<[DefaultCollectionState, string]> = [
    [{ kind: 'name', name: 'main', source: 'device' }, 'main'],
    [{ kind: 'inherited', name: 'shows', source: 'global' }, '[shows]'],
    [{ kind: 'none', source: 'device' }, 'none'],
    [{ kind: 'missing', name: 'ghost', source: 'device' }, 'ghost (not found)'],
    [{ kind: 'empty' }, '—'],
  ];

  for (const [state, expected] of cases) {
    it(`renders ${state.kind} as "${expected}"`, () => {
      expect(formatDefaultCollection(state)).toBe(expected);
    });
  }
});
