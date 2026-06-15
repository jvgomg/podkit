/**
 * Behaviour tests for the `device info` runner.
 *
 * Unlike the seam-check tests in `device-info-runner.unit.test.ts`, these
 * drive `runDeviceInfo` past `openDevice(...)` into the live-status block
 * — asserting that `status.musicCount`, `status.videoCount`, and the
 * model/capabilities payload reflect the fake adapter's data.
 *
 * Important pattern: `runDeviceInfo` wraps the entire live-status block
 * in a try/catch that demotes failures to `status.databaseError` rather
 * than throwing. Behaviour tests therefore assert on the JSON payload
 * (`status.musicCount`, `status.databaseError`, …) — NOT on thrown
 * `CliError`s.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceManager } from '@podkit/core';
import { runDeviceInfo, type DeviceInfoDeps } from './device.js';
import { BufferExitCodeSink, OutputContext } from '../output/index.js';
import { runWithContext, type CliContext } from '../context.js';
import { runAction } from '../errors.js';
import { BufferSink } from '../test-utils/buffer-sink.js';
import { makeFakeOpenDeviceResult, makeFakeIpodTrack } from '../test-utils/fake-ipod.js';
import {
  DEFAULT_TRANSFORMS_CONFIG,
  DEFAULT_VIDEO_TRANSFORMS_CONFIG,
  type PodkitConfig,
  type GlobalOptions,
  type LoadConfigResult,
} from '../config/index.js';

function makeContext(device: string): CliContext {
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

function fakeManager(): DeviceManager {
  return {
    platform: 'test',
    isSupported: true,
    findIpodDevices: async () => [],
    findByVolumeUuid: async () => null,
    getUuidForMountPoint: async () => null,
  } as unknown as DeviceManager;
}

function fakeCore(): typeof import('@podkit/core') {
  return {
    isMusicMediaType: (mediaType: number) => mediaType === 1,
    isVideoMediaType: (mediaType: number) => mediaType === 2,
    checkReadiness: async () => ({
      level: 'ready' as const,
      stages: [],
    }),
    ipodFromBlock: (block: unknown) => ({ kind: 'ipod', block, matchedBy: 'block-only' }),
    IpodError: class IpodError extends Error {},
  } as unknown as typeof import('@podkit/core');
}

interface InfoJson {
  success: true;
  device?: { name: string };
  status?: {
    mounted: boolean;
    mountPoint?: string;
    musicCount?: number;
    videoCount?: number;
    databaseError?: string;
    massStorageCapabilities?: {
      supportedAudioCodecs: string[];
      firmwareSupportedAudioCodecs?: string[];
      supportsVideo: boolean;
    };
  };
  readiness?: { level: string };
}

describe('runDeviceInfo: behaviour past openDevice', () => {
  let mount: string;
  beforeEach(async () => {
    mount = await mkdtemp(join(tmpdir(), 'info-bhv-'));
  });
  afterEach(async () => {
    await rm(mount, { recursive: true, force: true });
  });

  it('reports musicCount and videoCount from the fake adapter', async () => {
    const ctx = makeContext(mount);
    const { out, stdout, exitCode } = makeOut();

    const tracks = [
      makeFakeIpodTrack({ mediaType: 1 }),
      makeFakeIpodTrack({ mediaType: 1 }),
      makeFakeIpodTrack({ mediaType: 1 }),
      makeFakeIpodTrack({ mediaType: 2 }),
    ];

    const deps: DeviceInfoDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager(),
      openDevice: async () =>
        makeFakeOpenDeviceResult({
          tracks,
          isIpodDevice: false, // skip the ipod-specific model lookup branch
        }),
    };

    await runWithContext(ctx, () => runAction(out, () => runDeviceInfo(out, deps)));
    expect(exitCode.get()).toBeUndefined();

    const result = stdout.json<InfoJson>();
    expect(result.success).toBe(true);
    expect(result.status?.musicCount).toBe(3);
    expect(result.status?.videoCount).toBe(1);
  });

  it('emits mass-storage capabilities when openDevice returns a non-iPod result', async () => {
    const ctx = makeContext(mount);
    const { out, stdout, exitCode } = makeOut();

    const deps: DeviceInfoDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager(),
      openDevice: async () =>
        makeFakeOpenDeviceResult({
          tracks: [makeFakeIpodTrack({ mediaType: 1 })],
          isIpodDevice: false,
          capabilities: {
            supportedAudioCodecs: ['flac', 'mp3'],
            supportsVideo: true,
          },
        }),
    };

    await runWithContext(ctx, () => runAction(out, () => runDeviceInfo(out, deps)));
    expect(exitCode.get()).toBeUndefined();

    const result = stdout.json<InfoJson>();
    expect(result.status?.massStorageCapabilities?.supportedAudioCodecs).toEqual(['flac', 'mp3']);
    expect(result.status?.massStorageCapabilities?.supportsVideo).toBe(true);
    // No firmware diff plumbed through → omit the field rather than echo
    // the operational list. Absence is the "both views agree" signal.
    expect(result.status?.massStorageCapabilities?.firmwareSupportedAudioCodecs).toBeUndefined();
  });

  it('emits firmwareSupportedAudioCodecs when openDevice surfaces a stricter operational list', async () => {
    const ctx = makeContext(mount);
    const { out, stdout, exitCode } = makeOut();

    const deps: DeviceInfoDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager(),
      openDevice: async () =>
        makeFakeOpenDeviceResult({
          tracks: [makeFakeIpodTrack({ mediaType: 1 })],
          isIpodDevice: false,
          capabilities: {
            supportedAudioCodecs: ['aac', 'mp3', 'flac'],
          },
          firmwareCapabilities: {
            supportedAudioCodecs: ['aac', 'mp3', 'flac', 'wav', 'aiff'],
          },
        }),
    };

    await runWithContext(ctx, () => runAction(out, () => runDeviceInfo(out, deps)));
    expect(exitCode.get()).toBeUndefined();

    const result = stdout.json<InfoJson>();
    expect(result.status?.massStorageCapabilities?.supportedAudioCodecs).toEqual([
      'aac',
      'mp3',
      'flac',
    ]);
    expect(result.status?.massStorageCapabilities?.firmwareSupportedAudioCodecs).toEqual([
      'aac',
      'mp3',
      'flac',
      'wav',
      'aiff',
    ]);
  });

  it('demotes openDevice failure to status.databaseError (no thrown CliError)', async () => {
    const ctx = makeContext(mount);
    const { out, stdout } = makeOut();

    const deps: DeviceInfoDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager(),
      openDevice: async () => {
        throw new Error('database corrupt');
      },
    };

    await runWithContext(ctx, () => runAction(out, () => runDeviceInfo(out, deps)));
    // The runner catches the failure into `status.databaseError` rather than
    // throwing a CliError. The `success: true` JSON envelope reports that the
    // *command* ran, while `status.databaseError` carries the device-level
    // failure. Note: runDeviceInfo mutates `process.exitCode` directly on
    // unexpected database errors, which bypasses the OutputContext sink —
    // we only assert the JSON shape here.
    const result = stdout.json<InfoJson>();
    expect(result.success).toBe(true);
    expect(result.status?.databaseError).toContain('database corrupt');
  });
});
