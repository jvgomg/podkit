/**
 * Unit tests for the `device scan` runner.
 *
 * Exercises the runner directly with a stubbed `@podkit/core` module so no
 * real USB walk happens (AC #2 of TASK-315). The fuller end-to-end coverage
 * lives in `device-scan.integration.test.ts`.
 */

import { describe, it, expect } from 'bun:test';
import type { DeviceManager } from '@podkit/core';
import {
  runDeviceScan,
  type DeviceScanDeps,
  type DeviceScanOutput,
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

function makeContext(): CliContext {
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
    listDevices: async () => [],
    findByVolumeUuid: async () => null,
    getSiblingVolumes: async () => [],
    getManualInstructions: () => '',
  };
  return { ...base, ...overrides } as DeviceManager;
}

const fakeCore = (
  overrides: Partial<typeof import('@podkit/core')> = {}
): typeof import('@podkit/core') =>
  ({
    checkReadiness: async () => ({ level: 'ready', stages: [] }),
    enumerateUsb: async () => [],
    classifyUsbDevices: () => [],
    createUsbOnlyReadinessResult: () => ({ level: 'unknown', stages: [] }),
    interpretError: () => ({ explanation: 'stub' }),
    ...overrides,
  }) as typeof import('@podkit/core');

function runScan(
  ctx: CliContext,
  options: Parameters<typeof runDeviceScan>[0],
  out: OutputContext,
  deps?: DeviceScanDeps,
  cliVersion?: string
): Promise<unknown> {
  return runWithContext(ctx, () =>
    runAction(out, () => runDeviceScan(options, out, deps, cliVersion))
  );
}

interface ScanErrorJson {
  success: false;
  error: string;
  code: string;
}

describe('runDeviceScan', () => {
  it('surfaces CORE_LOAD_FAILED when loadCore rejects', async () => {
    const ctx = makeContext();
    const { out, stdout, exitCode } = makeOut();
    const deps: DeviceScanDeps = {
      loadCore: async () => {
        throw new Error('core gone');
      },
    };
    await runScan(ctx, {}, out, deps);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<ScanErrorJson>();
    expect(err.code).toBe(DeviceErrorCodes.CORE_LOAD_FAILED);
    expect(err.error).toContain('core gone');
  });

  it('returns an empty device list when no iPods or USB devices are found', async () => {
    const ctx = makeContext();
    const { out, stdout, exitCode } = makeOut();

    let enumerateUsbCalled = false;
    const deps: DeviceScanDeps = {
      loadCore: async () =>
        fakeCore({
          enumerateUsb: (async () => {
            enumerateUsbCalled = true;
            return [];
          }) as typeof import('@podkit/core').enumerateUsb,
        }),
      getDeviceManager: () => fakeManager({ isSupported: true }),
    };

    await runScan(ctx, {}, out, deps);
    expect(exitCode.get()).toBeUndefined();
    expect(enumerateUsbCalled).toBe(true);
    const result = stdout.json<DeviceScanOutput>();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.devices).toEqual([]);
    }
  });

  it('skips findIpodDevices + enumerateUsb when the platform manager is unsupported', async () => {
    const ctx = makeContext();
    const { out, stdout, exitCode } = makeOut();

    let findIpodCalled = false;
    let enumerateUsbCalled = false;
    const deps: DeviceScanDeps = {
      loadCore: async () =>
        fakeCore({
          enumerateUsb: (async () => {
            enumerateUsbCalled = true;
            return [];
          }) as typeof import('@podkit/core').enumerateUsb,
        }),
      getDeviceManager: () =>
        fakeManager({
          isSupported: false,
          platform: 'unsupported',
          findIpodDevices: async () => {
            findIpodCalled = true;
            return [];
          },
        }),
    };

    await runScan(ctx, {}, out, deps);
    expect(exitCode.get()).toBeUndefined();
    // The runner short-circuits both USB walks on unsupported platforms.
    expect(findIpodCalled).toBe(false);
    expect(enumerateUsbCalled).toBe(false);
    const result = stdout.json<DeviceScanOutput>();
    expect(result.success).toBe(true);
  });

  it('embeds the supplied cliVersion in --report output', async () => {
    const ctx = makeContext();
    const { out, stdout, exitCode } = makeOut();
    const deps: DeviceScanDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager({ isSupported: true }),
    };

    await runScan(ctx, { report: true }, out, deps, 'test-1.2.3');
    expect(exitCode.get()).toBeUndefined();
    // --report writes plain text (the diagnostic report), not JSON.
    expect(stdout.text()).toContain('test-1.2.3');
  });
});
