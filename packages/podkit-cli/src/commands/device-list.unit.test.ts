/**
 * Unit tests for the `device list` runner.
 *
 * `runDeviceList` accepts a deps seam (TASK-315). Tests stub `loadCore` /
 * `getDeviceManager` / `loadLibgpod` to prove no real USB walk or native
 * binding load happens.
 */

import { describe, it, expect } from 'bun:test';
import type { DeviceManager } from '@podkit/core';
import { runDeviceList, type DeviceListDeps, type DeviceListOutput } from './device.js';
import { BufferExitCodeSink, OutputContext } from '../output/index.js';
import { runWithContext, type CliContext } from '../context.js';
import { BufferSink } from '../test-utils/buffer-sink.js';
import {
  DEFAULT_TRANSFORMS_CONFIG,
  DEFAULT_VIDEO_TRANSFORMS_CONFIG,
  type PodkitConfig,
  type GlobalOptions,
  type LoadConfigResult,
  type DeviceConfig,
} from '../config/index.js';

function makeContext(devices: Record<string, DeviceConfig> = {}): CliContext {
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
  const base: Partial<DeviceManager> = {
    platform: 'test',
    isSupported: true,
    findIpodDevices: async () => [],
  };
  return { ...base, ...overrides } as DeviceManager;
}

const fakeCore = (
  overrides: Partial<typeof import('@podkit/core')> = {}
): typeof import('@podkit/core') =>
  ({
    resolveCapabilities: () => null,
    identifyCapabilities: () => null,
    getDeviceManager: () => fakeManager(),
    ...overrides,
  }) as typeof import('@podkit/core');

function run(ctx: CliContext, out: OutputContext, deps?: DeviceListDeps): Promise<void> {
  return runWithContext(ctx, () => runDeviceList(out, deps));
}

describe('runDeviceList', () => {
  it('returns an empty success payload when no devices are configured', async () => {
    const ctx = makeContext({});
    const { out, stdout, exitCode } = makeOut();
    const deps: DeviceListDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager(),
      loadLibgpod: async () => undefined,
    };

    await run(ctx, out, deps);
    expect(exitCode.get()).toBeUndefined();
    const result = stdout.json<DeviceListOutput>();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.devices).toEqual([]);
    }
  });

  it('renders configured iPod devices without consulting libgpod when disconnected', async () => {
    const ctx = makeContext({
      myipod: { volumeUuid: 'ABC-123', volumeName: 'myipod', type: 'ipod' } as DeviceConfig,
    });
    const { out, stdout, exitCode } = makeOut();

    let libgpodLoaded = false;
    const deps: DeviceListDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager(),
      loadLibgpod: async () => {
        libgpodLoaded = true;
        return undefined;
      },
    };

    await run(ctx, out, deps);
    expect(exitCode.get()).toBeUndefined();
    // libgpod is queried for the binding even if it returns undefined — the
    // important property is the *seam* is honoured, not the real import.
    expect(libgpodLoaded).toBe(true);

    const result = stdout.json<DeviceListOutput>();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.devices).toHaveLength(1);
      expect(result.devices[0]?.name).toBe('myipod');
      expect(result.devices[0]?.connected).toBe(false);
    }
  });

  it('treats a core-load failure as a soft skip — devices still render', async () => {
    const ctx = makeContext({
      myipod: { volumeUuid: 'ABC-123', volumeName: 'myipod', type: 'ipod' } as DeviceConfig,
    });
    const { out, stdout, exitCode } = makeOut();

    let coreCalls = 0;
    const deps: DeviceListDeps = {
      loadCore: async () => {
        coreCalls += 1;
        // First call (the probe) throws → caught silently. Subsequent calls
        // would throw too, so the runner must not surface the failure as
        // an error to the user.
        throw new Error('core unavailable');
      },
      loadLibgpod: async () => undefined,
    };

    // The second loadCore call (for resolveCapabilities / identifyCapabilities)
    // would propagate up. We expect that path NOT to be taken for iPod devices,
    // since iPod capabilities come from libgpod, not from `resolveCapabilities`.
    await run(ctx, out, deps);
    expect(exitCode.get()).toBeUndefined();
    expect(coreCalls).toBeGreaterThanOrEqual(1);

    const result = stdout.json<DeviceListOutput>();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.devices).toHaveLength(1);
      expect(result.devices[0]?.connected).toBe(false);
    }
  });
});
