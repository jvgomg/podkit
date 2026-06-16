/**
 * Resolve effective content paths for a mass-storage device.
 *
 * Override precedence (low → high):
 *   1. Preset defaults (from `presets[deviceConfig.type].contentPaths`,
 *      where `presets` is the merged built-in + user-defined registry)
 *   2. Global `deviceDefaults` (from env vars / config file)
 *   3. Per-device `deviceConfig.{musicDir,moviesDir,tvShowsDir}`
 *
 * Always returns a fully-normalised `ContentPaths`. The previous inline copy
 * in `commands/open-device.ts` returned `undefined` when no overrides AND no
 * preset defaults applied; callers passed that `undefined` to
 * `MassStorageAdapter`, which then ran `normalizeContentPaths({})` internally
 * to produce the same `DEFAULT_CONTENT_PATHS` value. Returning the normalised
 * form unconditionally here collapses two equivalent paths into one and lets
 * the consumer treat the result as `ContentPaths` without a null-check.
 *
 * Pass `mergedPresets(config)` from `../config/preset-registry.js` to make
 * user-defined `[presets.X]` content-path overrides effective for
 * user-preset-typed devices. When omitted, only built-ins are consulted.
 */

import { normalizeContentPaths, type ContentPaths } from '@podkit/core';
import type { MassStoragePreset } from '@podkit/devices-mass-storage';
import type { DeviceConfig, PodkitConfig } from '../config/types.js';

export function resolveDeviceContentPaths(
  deviceConfig: DeviceConfig | undefined,
  deviceDefaults: PodkitConfig['deviceDefaults'] | undefined,
  presets: Record<string, MassStoragePreset>
): ContentPaths {
  const presetId = deviceConfig?.type ?? 'generic';
  const presetDefaults = presets[presetId]?.contentPaths ?? presets['generic']?.contentPaths;

  const overrides: Partial<ContentPaths> = {};
  if (deviceDefaults?.musicDir !== undefined) overrides.musicDir = deviceDefaults.musicDir;
  if (deviceDefaults?.moviesDir !== undefined) overrides.moviesDir = deviceDefaults.moviesDir;
  if (deviceDefaults?.tvShowsDir !== undefined) overrides.tvShowsDir = deviceDefaults.tvShowsDir;
  if (deviceConfig?.musicDir !== undefined) overrides.musicDir = deviceConfig.musicDir;
  if (deviceConfig?.moviesDir !== undefined) overrides.moviesDir = deviceConfig.moviesDir;
  if (deviceConfig?.tvShowsDir !== undefined) overrides.tvShowsDir = deviceConfig.tvShowsDir;

  return normalizeContentPaths(overrides, presetDefaults);
}
