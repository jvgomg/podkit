/**
 * Unit tests for the iPod-only device runners (`runDeviceClear`,
 * `runDeviceReset`, `runDeviceInit`, `runDeviceResetArtwork`).
 *
 * Focused on the early-throw paths that don't require a real iTunesDB
 * fixture — proving the deps seam added in TASK-315 short-circuits before
 * any real USB walk or libgpod open happens. Full behaviour coverage
 * (success paths against real fixtures) lives in `device.integration.test.ts`.
 */

import { describe, it, expect } from 'bun:test';
import type { DeviceManager } from '@podkit/core';
import {
  runDeviceClear,
  runDeviceReset,
  runDeviceInit,
  runDeviceResetArtwork,
  type DeviceOpDeps,
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
  type DeviceConfig,
} from '../config/index.js';

function makeContext(opts: { device?: string; type?: 'ipod' | 'echo-mini' } = {}): CliContext {
  const devices: Record<string, DeviceConfig> = {};
  if (opts.type === 'echo-mini' && opts.device) {
    devices[opts.device] = {
      type: 'echo-mini',
      path: '/tmp/nonexistent',
      volumeName: opts.device,
    } as DeviceConfig;
  }
  const config: PodkitConfig = {
    quality: 'medium',
    artwork: true,
    tips: true,
    transforms: DEFAULT_TRANSFORMS_CONFIG,
    videoTransforms: DEFAULT_VIDEO_TRANSFORMS_CONFIG,
    devices,
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
    device: opts.device,
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

describe('iPod-only runners: type gate + DI seam', () => {
  for (const [name, runner] of [
    ['runDeviceClear', runDeviceClear],
    ['runDeviceReset', runDeviceReset],
    ['runDeviceInit', runDeviceInit],
    ['runDeviceResetArtwork', runDeviceResetArtwork],
  ] as const) {
    it(`${name} throws DEVICE_NOT_RESOLVED when no device is specified`, async () => {
      const ctx = makeContext();
      const { out, stdout, exitCode } = makeOut();
      const deps: DeviceOpDeps = {
        loadCore: async () => ({}) as typeof import('@podkit/core'),
        getDeviceManager: () => fakeManager(),
      };
      await runWithContext(ctx, () => runAction(out, () => runner({} as never, out, deps)));
      expect(exitCode.get()).toBe(1);
      const err = stdout.json<ErrJson>();
      expect(err.code).toBe(DeviceErrorCodes.DEVICE_NOT_RESOLVED);
    });

    it(`${name} throws IPOD_ONLY on a mass-storage device`, async () => {
      const ctx = makeContext({ device: 'echo', type: 'echo-mini' });
      const { out, stdout, exitCode } = makeOut();
      const deps: DeviceOpDeps = {
        loadCore: async () => ({}) as typeof import('@podkit/core'),
        getDeviceManager: () => fakeManager(),
      };
      await runWithContext(ctx, () => runAction(out, () => runner({} as never, out, deps)));
      expect(exitCode.get()).toBe(1);
      const err = stdout.json<ErrJson>();
      expect(err.code).toBe(DeviceErrorCodes.IPOD_ONLY);
      // Message names the offending device + its type so the user knows which
      // device was selected (often the default) and how to fix it.
      expect(err.error).toContain('echo');
      expect(err.error).toContain('iPod');
    });

    it(`${name} surfaces CORE_LOAD_FAILED when loadCore rejects`, async () => {
      const ctx = makeContext({ device: '/Volumes/iPod' });
      const { out, stdout, exitCode } = makeOut();
      const deps: DeviceOpDeps = {
        loadCore: async () => {
          throw new Error('mock failure');
        },
      };
      await runWithContext(ctx, () => runAction(out, () => runner({} as never, out, deps)));
      expect(exitCode.get()).toBe(1);
      const err = stdout.json<ErrJson>();
      expect(err.code).toBe(DeviceErrorCodes.CORE_LOAD_FAILED);
    });
  }
});
