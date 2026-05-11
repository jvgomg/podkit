/**
 * Unit tests for the `mount` runner.
 *
 * Exercises the runner directly with a stubbed `@podkit/core` module so no
 * real USB walk happens (AC #2 of TASK-315). The runner is shared by both
 * `podkit mount` and `podkit device mount`.
 */

import { describe, it, expect } from 'bun:test';
import type { DeviceManager, MountResult } from '@podkit/core';
import { runMount, type MountDeps, MountErrorCodes } from './mount.js';
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
    listDevices: async () => [],
    findIpodDevices: async () => [],
    findByVolumeUuid: async () => null,
    getSiblingVolumes: async () => [],
    getManualInstructions: () => 'manual mount instructions',
    requiresPrivileges: () => false,
    getUuidForMountPoint: async () => null,
    assessDevice: async () => null,
  };
  return { ...base, ...overrides } as DeviceManager;
}

interface MountErrorJson {
  success: false;
  error: string;
  code: string;
}

interface MountSuccessJson {
  success: true;
  device: string;
  mountPoint?: string;
  dryRunCommand?: string;
}

function runMountWith(
  ctx: CliContext,
  options: Parameters<typeof runMount>[0],
  out: OutputContext,
  deps?: MountDeps
): Promise<unknown> {
  return runWithContext(ctx, () => runAction(out, () => runMount(options, out, deps)));
}

describe('runMount', () => {
  it('exits with MOUNT_UNSUPPORTED on an unsupported platform', async () => {
    const ctx = makeContext({ device: '/Volumes/iPod' });
    const { out, stdout, exitCode } = makeOut();
    const deps: MountDeps = {
      loadCore: async () => ({}) as typeof import('@podkit/core'),
      getDeviceManager: () => fakeManager({ isSupported: false, platform: 'unsupported' }),
    };
    await runMountWith(ctx, {}, out, deps);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<MountErrorJson>();
    expect(err.code).toBe(MountErrorCodes.MOUNT_UNSUPPORTED);
    expect(err.error).toContain('unsupported');
  });

  it('surfaces CORE_LOAD_FAILED when loadCore rejects', async () => {
    const ctx = makeContext({ device: '/Volumes/iPod' });
    const { out, stdout, exitCode } = makeOut();
    const deps: MountDeps = {
      loadCore: async () => {
        throw new Error('core missing');
      },
    };
    await runMountWith(ctx, {}, out, deps);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<MountErrorJson>();
    expect(err.code).toBe(MountErrorCodes.CORE_LOAD_FAILED);
    expect(err.error).toContain('core missing');
  });

  it('reports DEVICE_NOT_RESOLVED when no device specified and no explicit disk', async () => {
    const ctx = makeContext({});
    const { out, stdout, exitCode } = makeOut();
    const deps: MountDeps = {
      loadCore: async () => ({}) as typeof import('@podkit/core'),
      getDeviceManager: () => fakeManager(),
    };
    await runMountWith(ctx, {}, out, deps);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<MountErrorJson>();
    expect(err.code).toBe(MountErrorCodes.DEVICE_NOT_RESOLVED);
  });

  it('mounts via --disk identifier without consulting the volume registry', async () => {
    const ctx = makeContext({});
    const { out, stdout, exitCode } = makeOut();
    let mountedId: string | undefined;
    const deps: MountDeps = {
      loadCore: async () => ({}) as typeof import('@podkit/core'),
      getDeviceManager: () =>
        fakeManager({
          isSupported: true,
          mount: (async (id) => {
            mountedId = id;
            return {
              success: true,
              device: id,
              mountPoint: `/tmp/podkit-${id}`,
            } satisfies MountResult;
          }) as DeviceManager['mount'],
        }),
    };
    await runMountWith(ctx, { disk: '/dev/disk4s2' }, out, deps);
    expect(exitCode.get()).toBeUndefined();
    expect(mountedId).toBe('/dev/disk4s2');
    const result = stdout.json<MountSuccessJson>();
    expect(result.success).toBe(true);
    expect(result.device).toBe('/dev/disk4s2');
    expect(result.mountPoint).toBe('/tmp/podkit-/dev/disk4s2');
  });

  it('emits the dry-run command without mounting when --dry-run is set', async () => {
    const ctx = makeContext({});
    const { out, stdout, exitCode } = makeOut();
    const deps: MountDeps = {
      loadCore: async () => ({}) as typeof import('@podkit/core'),
      getDeviceManager: () =>
        fakeManager({
          isSupported: true,
          mount: (async (id) => ({
            success: true,
            device: id,
            mountPoint: '/tmp/podkit-X',
            dryRunCommand: `mount ${id}`,
          })) as DeviceManager['mount'],
        }),
    };
    await runMountWith(ctx, { disk: '/dev/disk9s1', dryRun: true }, out, deps);
    expect(exitCode.get()).toBeUndefined();
    const result = stdout.json<MountSuccessJson>();
    expect(result.dryRunCommand).toBe('mount /dev/disk9s1');
  });

  it('surfaces MOUNT_FAILED when the manager reports a failure', async () => {
    const ctx = makeContext({});
    const { out, stdout, exitCode } = makeOut();
    const deps: MountDeps = {
      loadCore: async () => ({}) as typeof import('@podkit/core'),
      getDeviceManager: () =>
        fakeManager({
          isSupported: true,
          mount: (async (id) => ({
            success: false,
            device: id,
            error: 'kernel says no',
          })) as DeviceManager['mount'],
        }),
    };
    await runMountWith(ctx, { disk: '/dev/disk7s2' }, out, deps);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<MountErrorJson>();
    expect(err.code).toBe(MountErrorCodes.MOUNT_FAILED);
    expect(err.error).toContain('kernel says no');
  });

  it('surfaces MOUNT_REQUIRES_SUDO when the manager reports privilege requirements', async () => {
    const ctx = makeContext({});
    const { out, stdout, exitCode } = makeOut();
    const deps: MountDeps = {
      loadCore: async () => ({}) as typeof import('@podkit/core'),
      getDeviceManager: () =>
        fakeManager({
          isSupported: true,
          mount: (async (id) => ({
            success: false,
            device: id,
            requiresSudo: true,
            dryRunCommand: `mount -o iflash ${id}`,
          })) as DeviceManager['mount'],
        }),
    };
    await runMountWith(ctx, { disk: '/dev/disk6s1' }, out, deps);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<MountErrorJson>();
    expect(err.code).toBe(MountErrorCodes.MOUNT_REQUIRES_SUDO);
  });
});
