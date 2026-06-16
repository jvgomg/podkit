/**
 * Tests for resolveDeviceContentPaths — preset < deviceDefaults < deviceConfig cascade.
 */

import { describe, it, expect } from 'bun:test';
import { BUILT_IN_PRESETS } from '@podkit/devices-mass-storage';
import { resolveDeviceContentPaths as _resolveDeviceContentPaths } from './content-paths.js';
import type { DeviceConfig, PodkitConfig } from '../config/types.js';

// These tests pin the built-in preset content-path baseline. The resolver
// now requires an explicit registry; bind to BUILT_IN_PRESETS so the
// assertions read the same as before the registry threading landed.
function resolveDeviceContentPaths(
  deviceConfig: DeviceConfig | undefined,
  deviceDefaults: PodkitConfig['deviceDefaults'] | undefined
) {
  return _resolveDeviceContentPaths(deviceConfig, deviceDefaults, BUILT_IN_PRESETS);
}

describe('resolveDeviceContentPaths', () => {
  it('returns DEFAULT_CONTENT_PATHS when given no config and no defaults', () => {
    const result = resolveDeviceContentPaths(undefined, undefined);
    // generic preset has no contentPaths override, so the default sourced
    // from normalizeContentPaths is what surfaces.
    expect(result).toEqual({
      musicDir: 'Music',
      moviesDir: 'Video/Movies',
      tvShowsDir: 'Video/Shows',
    });
  });

  it('uses preset contentPaths when device.type maps to a preset with overrides', () => {
    const echoMiniPreset = BUILT_IN_PRESETS['echo-mini'];
    expect(echoMiniPreset).toBeDefined();
    const result = resolveDeviceContentPaths({ type: 'echo-mini', path: '/x' }, undefined);
    expect(result.musicDir).toBe(echoMiniPreset!.contentPaths!.musicDir);
  });

  it('lets global deviceDefaults override preset defaults', () => {
    const defaults: PodkitConfig['deviceDefaults'] = { musicDir: 'CustomMusic' };
    const result = resolveDeviceContentPaths({ type: 'echo-mini', path: '/x' }, defaults);
    expect(result.musicDir).toBe('CustomMusic');
  });

  it('lets per-device config override global deviceDefaults', () => {
    const cfg: DeviceConfig = { type: 'echo-mini', path: '/x', musicDir: 'PerDeviceMusic' };
    const defaults: PodkitConfig['deviceDefaults'] = { musicDir: 'GlobalMusic' };
    const result = resolveDeviceContentPaths(cfg, defaults);
    expect(result.musicDir).toBe('PerDeviceMusic');
  });

  it('applies per-key precedence independently', () => {
    const cfg: DeviceConfig = { type: 'generic', path: '/x', musicDir: 'CfgMusic' };
    const defaults: PodkitConfig['deviceDefaults'] = { moviesDir: 'DefMovies' };
    const result = resolveDeviceContentPaths(cfg, defaults);
    expect(result.musicDir).toBe('CfgMusic');
    expect(result.moviesDir).toBe('DefMovies');
    expect(result.tvShowsDir).toBe('Video/Shows');
  });

  it('normalises trailing/leading slashes in caller-supplied paths', () => {
    const cfg: DeviceConfig = { type: 'generic', path: '/x', musicDir: '/Music/' };
    const result = resolveDeviceContentPaths(cfg, undefined);
    expect(result.musicDir).toBe('Music');
  });

  it('defaults preset lookup to "generic" when deviceConfig is undefined', () => {
    const result = resolveDeviceContentPaths(undefined, { musicDir: 'X' });
    expect(result.musicDir).toBe('X');
  });

  it('returns a fully-shaped ContentPaths object (all three keys present)', () => {
    const result = resolveDeviceContentPaths(undefined, undefined);
    expect(Object.keys(result).sort()).toEqual(['moviesDir', 'musicDir', 'tvShowsDir']);
  });
});
