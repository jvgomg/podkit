/**
 * Unit tests for the `device music` and `device video` runners.
 *
 * Focused on the validation paths and the deps seam added in TASK-315.
 * The full-integration coverage (real iPod, openDevice, getTracks)
 * lives in `device.integration.test.ts`.
 */

import { describe, it, expect } from 'bun:test';
import type { DeviceManager } from '@podkit/core';
import {
  runDeviceMusic,
  runDeviceVideo,
  type DeviceMusicDeps,
  type DeviceVideoDeps,
  DeviceErrorCodes,
} from './device.js';
import { BufferExitCodeSink, OutputContext } from '../output/index.js';
import { runWithContext, type CliContext } from '../context.js';
import { runAction } from '../errors.js';
import { BufferSink } from '../test-utils/buffer-sink.js';
import {
  DEFAULT_TRANSFORMS_CONFIG,
  DEFAULT_VIDEO_TRANSFORMS_CONFIG,
  type PodkitConfig,
  type GlobalOptions,
  type LoadConfigResult,
} from '../config/index.js';

function makeContext(device?: string): CliContext {
  const config: PodkitConfig = {
    quality: 'medium',
    artwork: true,
    tips: true,
    transforms: DEFAULT_TRANSFORMS_CONFIG,
    videoTransforms: DEFAULT_VIDEO_TRANSFORMS_CONFIG,
    devices: {},
    music: {},
    video: {},
  };
  const globalOpts: GlobalOptions = {
    json: true,
    quiet: false,
    verbose: 0,
    color: false,
    tips: false,
    tty: false,
    device,
  };
  const configResult: LoadConfigResult = {
    config,
    configPath: undefined,
    configFileExists: false,
  };
  return { config, globalOpts, configResult };
}

function makeOut() {
  const stdout = new BufferSink();
  const stderr = new BufferSink();
  const exitCode = new BufferExitCodeSink();
  const out = new OutputContext({
    mode: 'json',
    quiet: false,
    verbose: 0,
    color: false,
    tips: false,
    tty: false,
    stdout,
    stderr,
    exitCode,
  });
  return { out, stdout, stderr, exitCode };
}

function fakeManager(overrides: Partial<DeviceManager> = {}): DeviceManager {
  return {
    platform: 'test',
    isSupported: true,
    scan: async () => [],
    locate: async () => null,
    ...overrides,
  } as DeviceManager;
}

interface ErrJson {
  success: false;
  error: string;
  code: string;
}

describe('runDeviceMusic + runDeviceVideo: validation + seam plumbing', () => {
  it('runDeviceMusic rejects --fields with non-tracks mode', async () => {
    const ctx = makeContext('/Volumes/iPod');
    const { out, stdout, exitCode } = makeOut();
    await runWithContext(ctx, () =>
      runAction(out, () => runDeviceMusic({ albums: true, fields: 'title' }, out))
    );
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<ErrJson>();
    expect(err.code).toBe(DeviceErrorCodes.INVALID_OPTION);
  });

  it('runDeviceMusic rejects invalid --fields value', async () => {
    const ctx = makeContext('/Volumes/iPod');
    const { out, stdout, exitCode } = makeOut();
    await runWithContext(ctx, () =>
      runAction(out, () => runDeviceMusic({ tracks: true, fields: 'not-a-real-field' }, out))
    );
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<ErrJson>();
    expect(err.code).toBe(DeviceErrorCodes.INVALID_FIELDS);
  });

  it('runDeviceMusic throws DEVICE_NOT_RESOLVED when no device is specified', async () => {
    const ctx = makeContext();
    const { out, stdout, exitCode } = makeOut();
    const deps: DeviceMusicDeps = {
      loadCore: async () => ({}) as typeof import('@podkit/core'),
      getDeviceManager: () => fakeManager(),
    };
    await runWithContext(ctx, () => runAction(out, () => runDeviceMusic({}, out, deps)));
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<ErrJson>();
    expect(err.code).toBe(DeviceErrorCodes.DEVICE_NOT_RESOLVED);
  });

  it('runDeviceMusic surfaces CORE_LOAD_FAILED when loadCore rejects', async () => {
    const ctx = makeContext('/Volumes/iPod');
    const { out, stdout, exitCode } = makeOut();
    const deps: DeviceMusicDeps = {
      loadCore: async () => {
        throw new Error('cant load');
      },
    };
    await runWithContext(ctx, () => runAction(out, () => runDeviceMusic({}, out, deps)));
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<ErrJson>();
    expect(err.code).toBe(DeviceErrorCodes.CORE_LOAD_FAILED);
  });

  it('runDeviceVideo throws DEVICE_NOT_RESOLVED when no device is specified', async () => {
    const ctx = makeContext();
    const { out, stdout, exitCode } = makeOut();
    const deps: DeviceVideoDeps = {
      loadCore: async () => ({}) as typeof import('@podkit/core'),
      getDeviceManager: () => fakeManager(),
    };
    await runWithContext(ctx, () => runAction(out, () => runDeviceVideo({}, out, deps)));
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<ErrJson>();
    expect(err.code).toBe(DeviceErrorCodes.DEVICE_NOT_RESOLVED);
  });

  it('runDeviceVideo surfaces CORE_LOAD_FAILED when loadCore rejects', async () => {
    const ctx = makeContext('/Volumes/iPod');
    const { out, stdout, exitCode } = makeOut();
    const deps: DeviceVideoDeps = {
      loadCore: async () => {
        throw new Error('cant load');
      },
    };
    await runWithContext(ctx, () => runAction(out, () => runDeviceVideo({}, out, deps)));
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<ErrJson>();
    expect(err.code).toBe(DeviceErrorCodes.CORE_LOAD_FAILED);
  });
});
