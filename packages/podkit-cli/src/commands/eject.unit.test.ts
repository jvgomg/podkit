/**
 * Unit tests for the `eject` runner.
 *
 * Exercises the runner directly with a stubbed `@podkit/core` module so no
 * real USB walk happens (AC #2 of TASK-315). Each test scopes its own
 * CliContext via `runWithContext` and captures output via BufferSink.
 */

import { describe, it, expect } from 'bun:test';
import type { DeviceManager } from '@podkit/core';
import { runEject, type EjectDeps, EjectErrorCodes } from './eject.js';
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

interface MakeContextOptions {
  device?: string;
  devices?: Record<string, DeviceConfig>;
}

function makeContext(opts: MakeContextOptions = {}): CliContext {
  const config: PodkitConfig = {
    quality: 'medium',
    artwork: true,
    tips: true,
    transforms: DEFAULT_TRANSFORMS_CONFIG,
    videoTransforms: DEFAULT_VIDEO_TRANSFORMS_CONFIG,
    devices: opts.devices ?? {},
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
  const notImplemented = () => {
    throw new Error('fakeManager method not stubbed');
  };
  const base: Partial<DeviceManager> = {
    platform: 'test',
    isSupported: true,
    eject: notImplemented as DeviceManager['eject'],
    mount: notImplemented as DeviceManager['mount'],
    scan: async () => [],
    locate: async () => null,
    getSiblingVolumes: async () => [],
    getManualInstructions: () => 'manual eject instructions',
    requiresPrivileges: () => false,
    assessDevice: async () => null,
  };
  return { ...base, ...overrides } as DeviceManager;
}

interface EjectErrorJson {
  success: false;
  error: string;
  code: string;
}

interface EjectSuccessJson {
  success: true;
  device: string;
  forced?: boolean;
  attempts?: number;
}

function runEjectWith(
  ctx: CliContext,
  options: Parameters<typeof runEject>[0],
  out: OutputContext,
  deps?: EjectDeps
): Promise<unknown> {
  return runWithContext(ctx, () => runAction(out, () => runEject(options, out, deps)));
}

const fakeCore = (
  overrides: Partial<typeof import('@podkit/core')> = {}
): typeof import('@podkit/core') =>
  ({
    ejectWithRetry: async () => ({ success: true, forced: false, attempts: 1 }),
    ...overrides,
  }) as typeof import('@podkit/core');

describe('runEject', () => {
  it('rejects when no device can be resolved (no --device, no default)', async () => {
    const ctx = makeContext({});
    const { out, stdout, exitCode } = makeOut();
    const deps: EjectDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager(),
    };
    await runEjectWith(ctx, {}, out, deps);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<EjectErrorJson>();
    expect(err.success).toBe(false);
    expect(err.code).toBe(EjectErrorCodes.DEVICE_NOT_RESOLVED);
  });

  it('exits with EJECT_UNSUPPORTED when the platform manager is unsupported', async () => {
    const ctx = makeContext({
      device: '/Volumes/iPod',
    });
    const { out, stdout, exitCode } = makeOut();
    const deps: EjectDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager({ isSupported: false, platform: 'unsupported' }),
    };
    await runEjectWith(ctx, {}, out, deps);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<EjectErrorJson>();
    expect(err.code).toBe(EjectErrorCodes.EJECT_UNSUPPORTED);
    expect(err.error).toContain('unsupported');
  });

  it('surfaces CORE_LOAD_FAILED when loadCore rejects', async () => {
    const ctx = makeContext({ device: '/Volumes/iPod' });
    const { out, stdout, exitCode } = makeOut();
    const deps: EjectDeps = {
      loadCore: async () => {
        throw new Error('module not found');
      },
    };
    await runEjectWith(ctx, {}, out, deps);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<EjectErrorJson>();
    expect(err.code).toBe(EjectErrorCodes.CORE_LOAD_FAILED);
    expect(err.error).toContain('module not found');
  });

  it('reports DEVICE_PATH_NOT_FOUND when the resolved path does not exist', async () => {
    const bogusPath = '/Volumes/does-not-exist-ever-12345';
    const ctx = makeContext({ device: bogusPath });
    const { out, stdout, exitCode } = makeOut();
    const deps: EjectDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager({ isSupported: true }),
    };
    await runEjectWith(ctx, {}, out, deps);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<EjectErrorJson>();
    // CLI path mode goes through resolveDevicePath; either path returns
    // DEVICE_PATH_UNRESOLVED (if the resolver rejects it) or
    // DEVICE_PATH_NOT_FOUND (if the resolver accepted it but existsSync
    // returned false). Either is acceptable — both prove the runner stopped
    // before invoking ejectWithRetry.
    expect([
      EjectErrorCodes.DEVICE_PATH_UNRESOLVED,
      EjectErrorCodes.DEVICE_PATH_NOT_FOUND,
    ]).toContain(err.code as never);
  });

  it('runs against the stubbed manager with no real USB walk and reports success', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const mount = await mkdtemp(join(tmpdir(), 'eject-success-'));

    const ctx = makeContext({ device: mount });
    const { out, stdout, exitCode } = makeOut();

    let ejectWithRetryCalled = false;
    const deps: EjectDeps = {
      loadCore: async () =>
        fakeCore({
          ejectWithRetry: (async (_m, device) => {
            ejectWithRetryCalled = true;
            return { success: true, device, forced: false, attempts: 1 };
          }) as typeof import('@podkit/core').ejectWithRetry,
        }),
      getDeviceManager: () => fakeManager({ isSupported: true }),
    };

    await runEjectWith(ctx, {}, out, deps);
    expect(exitCode.get()).toBeUndefined();
    const result = stdout.json<EjectSuccessJson>();
    expect(result.success).toBe(true);
    expect(result.device).toBe(mount);
    expect(ejectWithRetryCalled).toBe(true);

    const { rm } = await import('node:fs/promises');
    await rm(mount, { recursive: true, force: true });
  });

  it('surfaces EJECT_FAILED when the eject result reports failure', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const mount = await mkdtemp(join(tmpdir(), 'eject-failed-'));

    try {
      const ctx = makeContext({ device: mount });
      const { out, stdout, exitCode } = makeOut();

      const deps: EjectDeps = {
        loadCore: async () =>
          fakeCore({
            ejectWithRetry: (async (_m, device) => ({
              success: false,
              device,
              error: 'volume busy',
              forced: false,
              attempts: 3,
            })) as typeof import('@podkit/core').ejectWithRetry,
          }),
        getDeviceManager: () => fakeManager({ isSupported: true }),
      };

      await runEjectWith(ctx, {}, out, deps);
      expect(exitCode.get()).toBe(1);
      const err = stdout.json<EjectErrorJson>();
      expect(err.code).toBe(EjectErrorCodes.EJECT_FAILED);
      expect(err.error).toContain('volume busy');
    } finally {
      await rm(mount, { recursive: true, force: true });
    }
  });
});
