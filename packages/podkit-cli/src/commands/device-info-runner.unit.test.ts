/**
 * Unit tests for the `device info` runner.
 *
 * The richer end-to-end coverage (real iPod fixtures, full status block)
 * lives in `device.integration.test.ts`. These tests target the deps seam
 * added in TASK-315 — they confirm that:
 *   - DEVICE_NOT_RESOLVED is thrown when no device can be resolved
 *   - the runner respects `deps.loadCore` (no real `@podkit/core` import)
 *   - the runner respects `deps.getDeviceManager` (no real USB walk)
 */

import { describe, it, expect } from 'bun:test';
import type { DeviceManager } from '@podkit/core';
import { runDeviceInfo, type DeviceInfoDeps, DeviceErrorCodes } from './device.js';
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
    findByVolumeUuid: async () => null,
    getUuidForMountPoint: async () => null,
  };
  return { ...base, ...overrides } as DeviceManager;
}

function run(ctx: CliContext, out: OutputContext, deps?: DeviceInfoDeps): Promise<unknown> {
  return runWithContext(ctx, () => runAction(out, () => runDeviceInfo(out, deps)));
}

interface InfoErrorJson {
  success: false;
  error: string;
  code: string;
}

describe('runDeviceInfo', () => {
  it('throws DEVICE_NOT_RESOLVED when no device specified and no default', async () => {
    const ctx = makeContext();
    const { out, stdout, exitCode } = makeOut();
    let loadCoreCalled = false;
    const deps: DeviceInfoDeps = {
      loadCore: async () => {
        loadCoreCalled = true;
        return {} as typeof import('@podkit/core');
      },
    };
    await run(ctx, out, deps);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<InfoErrorJson>();
    expect(err.code).toBe(DeviceErrorCodes.DEVICE_NOT_RESOLVED);
    // The runner bails before touching `@podkit/core`.
    expect(loadCoreCalled).toBe(false);
  });

  it('honours deps.getDeviceManager — no real USB walk when device path is given', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const mount = await mkdtemp(join(tmpdir(), 'info-runner-'));

    try {
      // Simulate a path-mode invocation by patching globalOpts.device on the ctx
      const ctx = makeContext();
      ctx.globalOpts.device = mount;

      const { out, stdout, exitCode } = makeOut();

      let managerCalled = false;
      const deps: DeviceInfoDeps = {
        loadCore: async () =>
          ({
            isMusicMediaType: () => true,
            isVideoMediaType: () => false,
            checkReadiness: async () => ({ level: 'unknown', stages: [] }),
            IpodError: class IpodError extends Error {},
            getDeviceManager: () => fakeManager(),
          }) as unknown as typeof import('@podkit/core'),
        getDeviceManager: () => {
          managerCalled = true;
          return fakeManager({
            isSupported: true,
            getUuidForMountPoint: async () => 'STUB-UUID',
          });
        },
      };

      await run(ctx, out, deps);
      expect(managerCalled).toBe(true);
      // The runner doesn't throw on a non-fatal live-status failure — info
      // still emits a structured payload (success: true) describing what it
      // could observe. We only verify here that the seam was honoured.
      const raw = stdout.text();
      expect(raw.length).toBeGreaterThan(0);
      expect(exitCode.get()).toBeUndefined();
    } finally {
      await rm(mount, { recursive: true, force: true });
    }
  });
});
