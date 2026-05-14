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

  it('emits USB-only iPods into the JSON devices array (TASK-334)', async () => {
    // Regression for TASK-334: a USB-walk-only Apple device (no lsblk entry)
    // must surface in `--format json` output as a USB-only iPod entry so
    // downstream consumers (Tier-3 tests, automation) can assert on its
    // vendor/product descriptor without falling back to `lsusb` cross-checks.
    //
    // The fake `enumerateUsb` returns an Apple iPod video 5G descriptor with
    // no `diskIdentifier`; the fake `findIpodDevices` returns nothing, so
    // there is no joinable block device. The scan envelope must contain a
    // single `usbOnly: true` device with the expected vendor/product IDs and
    // the iPod 5G video model details from the classifier.
    const ctx = makeContext();
    const { out, stdout, exitCode } = makeOut();

    // The classifier in `@podkit/core` is the real one in the production
    // build but we inject a tiny fake that mirrors what `classifyAsIpod`
    // would return for an Apple iPod 5G video descriptor — keeps the test
    // hermetic and avoids pulling the full devices-ipod table into the unit.
    type EnumeratedUsbDevice = Parameters<
      typeof import('@podkit/core').classifyUsbDevices
    >[0][number];
    type RecognizedDevice = ReturnType<typeof import('@podkit/core').classifyUsbDevices>[number];

    const fakeDevice: EnumeratedUsbDevice = {
      vendorId: '05ac',
      productId: '1209',
      // No bus/devnum/serial — typical of the Tier-3 FunctionFS persona
      // before the descriptor handshake completes.
    };

    const fakeIpodModel = {
      displayName: 'iPod video (5th Generation)',
      generationId: 'video_5g',
      checksumType: 'hash58',
      source: 'usb',
    } as const;

    const fakeClassification: RecognizedDevice = {
      kind: 'ipod',
      device: fakeDevice,
      model: fakeIpodModel,
      supported: true,
    } as unknown as RecognizedDevice;

    const deps: DeviceScanDeps = {
      loadCore: async () =>
        fakeCore({
          enumerateUsb: (async () => [fakeDevice]) as typeof import('@podkit/core').enumerateUsb,
          classifyUsbDevices: (() => [
            fakeClassification,
          ]) as typeof import('@podkit/core').classifyUsbDevices,
          createUsbOnlyReadinessResult: (() => ({
            level: 'unknown',
            stages: [],
            usbModel: fakeIpodModel,
          })) as typeof import('@podkit/core').createUsbOnlyReadinessResult,
        }),
      getDeviceManager: () =>
        fakeManager({
          isSupported: true,
          findIpodDevices: async () => [],
        }),
    };

    await runScan(ctx, {}, out, deps);
    expect(exitCode.get()).toBeUndefined();
    const result = stdout.json<DeviceScanOutput>();
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.devices).toHaveLength(1);
    const usbOnly = result.devices![0]!;
    expect(usbOnly.usbOnly).toBe(true);
    expect(usbOnly.isMounted).toBe(false);
    expect(usbOnly.mountPoint).toBeUndefined();
    expect(usbOnly.identifier).toBe('');
    expect(usbOnly.volumeUuid).toBe('');
    expect(usbOnly.size).toBe(0);
    expect(usbOnly.usbDescriptor).toEqual({ vendorId: '05ac', productId: '1209' });
    expect(usbOnly.volumeName).toBe('iPod video (5th Generation)');
    expect(usbOnly.model?.displayName).toBe('iPod video (5th Generation)');
    expect(usbOnly.model?.generationId).toBe('video_5g');
    expect(usbOnly.model?.source).toBe('usb');
  });
});
