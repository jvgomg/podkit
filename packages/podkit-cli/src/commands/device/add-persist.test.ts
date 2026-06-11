import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceConfig } from '../../config/types.js';
import { CliError } from '../../errors.js';
import {
  applyCommonDeviceConfigOptions,
  persistDeviceConfig,
  resolveIsFirstDeviceAndConfigPath,
} from './add-persist.js';

describe('applyCommonDeviceConfigOptions', () => {
  it('applies all five common fields when provided', () => {
    const cfg: DeviceConfig = {};
    applyCommonDeviceConfigOptions(cfg, {
      quality: 'high',
      audioQuality: 'medium',
      videoQuality: 'low',
      encoding: 'cbr',
      artwork: true,
    });
    expect(cfg).toEqual({
      quality: 'high',
      audioQuality: 'medium',
      videoQuality: 'low',
      encoding: 'cbr',
      artwork: true,
    });
  });

  it('leaves DeviceConfig unchanged when no options provided', () => {
    const cfg: DeviceConfig = { volumeUuid: 'X' };
    applyCommonDeviceConfigOptions(cfg, {});
    expect(cfg).toEqual({ volumeUuid: 'X' });
  });

  it('preserves explicit artwork: false (not coerced to absent)', () => {
    // artwork is boolean; the `!== undefined` gate must accept false.
    const cfg: DeviceConfig = {};
    applyCommonDeviceConfigOptions(cfg, { artwork: false });
    expect(cfg.artwork).toBe(false);
  });

  it('does NOT touch quality when option is empty string (falsy)', () => {
    // Documented behaviour: empty-string options are ignored. Commander
    // doesn't produce empty strings today, but pinning this matches the
    // inline `if (options.X)` truthiness check.
    const cfg: DeviceConfig = {};
    applyCommonDeviceConfigOptions(cfg, { quality: '' });
    expect(cfg.quality).toBeUndefined();
  });

  it('does NOT touch any other DeviceConfig field', () => {
    // Helper is scoped to the 5 fields; anything else (volumeUuid,
    // unsupported, mass-storage extras) must be the caller's responsibility.
    const cfg: DeviceConfig = { volumeUuid: 'preserve-me', musicDir: 'M' };
    applyCommonDeviceConfigOptions(cfg, { quality: 'high' });
    expect(cfg.volumeUuid).toBe('preserve-me');
    expect(cfg.musicDir).toBe('M');
  });
});

describe('resolveIsFirstDeviceAndConfigPath', () => {
  it('returns isFirstDevice=true when no devices in config', () => {
    expect(
      resolveIsFirstDeviceAndConfigPath({ configPath: '/x', config: { devices: {} } })
    ).toEqual({
      isFirstDevice: true,
      configPath: '/x',
    });
  });

  it('returns isFirstDevice=true when config.devices is undefined', () => {
    expect(resolveIsFirstDeviceAndConfigPath({ configPath: '/x', config: {} })).toEqual({
      isFirstDevice: true,
      configPath: '/x',
    });
  });

  it('returns isFirstDevice=false when at least one device exists', () => {
    expect(
      resolveIsFirstDeviceAndConfigPath({
        configPath: '/x',
        config: { devices: { existing: {} } },
      })
    ).toEqual({
      isFirstDevice: false,
      configPath: '/x',
    });
  });

  it('falls back to DEFAULT_CONFIG_PATH when configPath is undefined', () => {
    const result = resolveIsFirstDeviceAndConfigPath({ config: {} });
    expect(result.configPath.length).toBeGreaterThan(0);
    expect(result.configPath).not.toBe('');
  });
});

describe('persistDeviceConfig — integration against a real config file', () => {
  let tmp: string;
  let configPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'podkit-add-persist-test-'));
    configPath = join(tmp, 'podkit.toml');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('writes the device to the config file and returns the save result', () => {
    const { result } = persistDeviceConfig({
      name: 'mypod',
      deviceConfig: { volumeUuid: 'abc-123', quality: 'high' },
      configPath,
      isFirstDevice: true,
      deviceInfoForErrorDetails: {},
    });
    expect(result.success).toBe(true);
    expect(existsSync(configPath)).toBe(true);
    const written = readFileSync(configPath, 'utf-8');
    expect(written).toContain('[devices.mypod]');
    expect(written).toContain('"abc-123"');
  });

  it('promotes the device as default when isFirstDevice=true', () => {
    persistDeviceConfig({
      name: 'mypod',
      deviceConfig: { volumeUuid: 'abc' },
      configPath,
      isFirstDevice: true,
      deviceInfoForErrorDetails: {},
    });
    const written = readFileSync(configPath, 'utf-8');
    expect(written).toContain('[defaults]');
    expect(written).toContain('device = "mypod"');
  });

  it('does NOT promote default when isFirstDevice=false', () => {
    persistDeviceConfig({
      name: 'mypod',
      deviceConfig: { volumeUuid: 'abc' },
      configPath,
      isFirstDevice: false,
      deviceInfoForErrorDetails: {},
    });
    const written = readFileSync(configPath, 'utf-8');
    expect(written).not.toContain('[defaults]');
  });

  it('throws CliError(CONFIG_SAVE_FAILED) when addDevice fails, with deviceInfo in details', () => {
    // Force a save failure by pointing at an unwritable path. /dev/null
    // works on macOS + Linux — it exists but isn't a directory.
    const badPath = '/dev/null/podkit.toml';
    const deviceInfo = { name: 'mypod', identifier: 'X' };
    let thrown: unknown;
    try {
      persistDeviceConfig({
        name: 'mypod',
        deviceConfig: { volumeUuid: 'abc' },
        configPath: badPath,
        isFirstDevice: false,
        deviceInfoForErrorDetails: deviceInfo,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CliError);
    if (thrown instanceof CliError) {
      expect(thrown.code).toBe('CONFIG_SAVE_FAILED');
      expect(thrown.details).toEqual({ device: deviceInfo });
    }
  });
});
