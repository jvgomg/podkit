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
    getDeviceManager: () => fakeManager(),
    discoverConnectedDevices: async () => [],
    // Stub the provenance resolver so the Settings section's capability
    // sub-block populates. Returns every field with `source: 'preset'` —
    // matches the real shape closely enough for the renderer assertions
    // here. Tests that need per-field provenance should override.
    resolveCapabilitiesResolved: () => ({
      supportedAudioCodecs: { value: ['aac'], source: 'preset' },
      artworkSources: { value: ['embedded'], source: 'preset' },
      artworkMaxResolution: { value: 127, source: 'preset' },
      supportsVideo: { value: false, source: 'preset' },
      audioNormalization: { value: 'none', source: 'preset' },
      supportsAlbumArtistBrowsing: { value: true, source: 'preset' },
    }),
  } as unknown as typeof import('@podkit/core');
}

interface InfoJson {
  success: true;
  device?: {
    name: string;
    // Breaking minor: the legacy top-level config fields below MUST stay
    // undefined on the JSON shape. Asserted in 'omits legacy top-level
    // config fields' below — consumers migrate to `settings.audio.value`
    // etc per the changeset.
    quality?: undefined;
    audioQuality?: undefined;
    videoQuality?: undefined;
    artwork?: undefined;
  };
  settings?: {
    quality: { value: string; source: string };
    audio: { value: string; source: string };
    video: { value: string | null; source: string };
    artwork: { value: boolean | null; source: string };
    manufacturer?: { value: string; source: string };
    productName?: { value: string; source: string };
    capabilities?: {
      supportedAudioCodecs: { value: string[]; source: string };
      supportsVideo: { value: boolean; source: string };
      audioNormalization: { value: string; source: string };
    };
  };
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

  // ── settings block — TASK-317.09 redesign ───────────────────────────────
  //
  // The new `settings` block at the top of the JSON envelope replaces the
  // legacy top-level `device.quality` / `device.audioQuality` /
  // `device.videoQuality` / `device.artwork` fields. Every value carries
  // `{ value, source }` provenance so consumers can render inheritance
  // markers without re-running the resolver.

  function makeContextWithDevice(
    deviceName: string,
    devicePath: string,
    deviceOverrides: Record<string, unknown> = {}
  ): CliContext {
    const config: PodkitConfig = {
      quality: 'medium',
      artwork: true,
      tips: true,
      transforms: DEFAULT_TRANSFORMS_CONFIG,
      videoTransforms: DEFAULT_VIDEO_TRANSFORMS_CONFIG,
      devices: {
        [deviceName]: {
          type: 'generic',
          path: devicePath,
          ...deviceOverrides,
        },
      },
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
      device: deviceName,
    };
    const configResult: LoadConfigResult = {
      config,
      configPath: undefined,
      configFileExists: false,
    };
    return { config, globalOpts, configResult };
  }

  it('emits a settings block carrying resolved cascade values + provenance', async () => {
    const ctx = makeContextWithDevice('mp3player', mount, { audioQuality: 'max' });
    const { out, stdout, exitCode } = makeOut();

    const deps: DeviceInfoDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager(),
      openDevice: async () =>
        makeFakeOpenDeviceResult({
          tracks: [],
          isIpodDevice: false,
          capabilities: { supportedAudioCodecs: ['aac'] },
        }),
    };

    await runWithContext(ctx, () => runAction(out, () => runDeviceInfo(out, deps)));
    expect(exitCode.get()).toBeUndefined();

    const result = stdout.json<InfoJson>();
    expect(result.settings).toBeDefined();
    // Device-level audioQuality override → source 'device'.
    expect(result.settings?.audio.value).toBe('max');
    expect(result.settings?.audio.source).toBe('device');
    // Quality inherited from the global quality cascade ('medium' set in
    // makeContextWithDevice). Device doesn't set its own `quality`, so the
    // resolver labels the source `'global-quality'` — the inherited-from-
    // global-quality marker used elsewhere in the cascade.
    expect(result.settings?.quality.value).toBe('medium');
    expect(result.settings?.quality.source).toBe('global-quality');
    // Mass-storage capabilities cascade through with preset / device-config
    // provenance.
    expect(result.settings?.capabilities).toBeDefined();
  });

  it('iPod device emits settings WITHOUT capabilities sub-block or manufacturer/productName', async () => {
    // iPod devices have no preset display labels (manufacturer/productName
    // are mass-storage-only), and the capability cascade is mass-storage-only
    // too — the iPod side surfaces capabilities through libgpod separately.
    // Regression for round-2 reviewer finding: settings shape should narrow
    // correctly for iPod, not just mass-storage.
    const config: PodkitConfig = {
      quality: 'medium',
      artwork: true,
      tips: true,
      transforms: DEFAULT_TRANSFORMS_CONFIG,
      videoTransforms: DEFAULT_VIDEO_TRANSFORMS_CONFIG,
      devices: {
        terapod: {
          type: 'ipod',
          path: mount,
          volumeUuid: '5U851AEH3R0',
        },
      },
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
      device: 'terapod',
    };
    const ctx: CliContext = {
      config,
      globalOpts,
      configResult: { config, configPath: undefined, configFileExists: false },
    };
    const { out, stdout, exitCode } = makeOut();

    const deps: DeviceInfoDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager(),
      openDevice: async () =>
        makeFakeOpenDeviceResult({
          tracks: [],
          isIpodDevice: true,
          capabilities: { supportedAudioCodecs: ['aac', 'mp3'] },
        }),
    };

    await runWithContext(ctx, () => runAction(out, () => runDeviceInfo(out, deps)));
    expect(exitCode.get()).toBeUndefined();

    const result = stdout.json<InfoJson>();
    expect(result.settings).toBeDefined();
    expect(result.settings?.manufacturer).toBeUndefined();
    expect(result.settings?.productName).toBeUndefined();
    expect(result.settings?.capabilities).toBeUndefined();
  });

  it('path mode (--device /Volumes/Foo with no config match) emits NO settings block', async () => {
    // When info is invoked with a raw path that doesn't resolve to any
    // configured device, `device` is undefined and there's no cascade to
    // resolve. The settings block must be absent — otherwise `settings.*`
    // would carry nonsense for a one-off path-mode peek.
    const ctx = makeContext(mount); // makeContext gives `devices: {}`
    const { out, stdout, exitCode } = makeOut();

    const deps: DeviceInfoDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager(),
      openDevice: async () =>
        makeFakeOpenDeviceResult({
          tracks: [],
          isIpodDevice: false,
          capabilities: { supportedAudioCodecs: ['aac'] },
        }),
    };

    await runWithContext(ctx, () => runAction(out, () => runDeviceInfo(out, deps)));
    expect(exitCode.get()).toBeUndefined();

    const result = stdout.json<InfoJson>();
    expect(result.settings).toBeUndefined();
    expect(result.device).toBeUndefined();
  });

  it('omits legacy top-level config fields (breaking minor — consumers migrate to settings.*)', async () => {
    const ctx = makeContextWithDevice('mp3player', mount);
    const { out, stdout, exitCode } = makeOut();

    const deps: DeviceInfoDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager(),
      openDevice: async () =>
        makeFakeOpenDeviceResult({
          tracks: [],
          isIpodDevice: false,
          capabilities: { supportedAudioCodecs: ['aac'] },
        }),
    };

    await runWithContext(ctx, () => runAction(out, () => runDeviceInfo(out, deps)));
    expect(exitCode.get()).toBeUndefined();

    const result = stdout.json<InfoJson>();
    // Explicitly check the legacy fields are gone — a regression that
    // re-introduces them (silently shadowing settings.*.value) would slip
    // through every other test.
    expect(result.device?.quality).toBeUndefined();
    expect(result.device?.audioQuality).toBeUndefined();
    expect(result.device?.videoQuality).toBeUndefined();
    expect(result.device?.artwork).toBeUndefined();
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
