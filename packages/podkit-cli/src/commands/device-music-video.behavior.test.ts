/**
 * Behaviour tests for the `device music` and `device video` runners.
 *
 * Unlike the seam-check tests in `device-music-video.unit.test.ts`, these
 * drive each runner past `openDevice(...)` into the track-filtering and
 * output-formatting body — asserting on the JSON payload that production
 * would emit.
 *
 * Each test scopes a real temp directory via `mkdtemp` so `existsSync`
 * passes; the `openDevice` deps seam swaps in a fake adapter from
 * `test-utils/fake-ipod.ts`. No real iTunesDB ever touches disk.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceManager } from '@podkit/core';
import {
  runDeviceMusic,
  runDeviceVideo,
  type DeviceMusicDeps,
  type DeviceVideoDeps,
} from './device.js';
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
  } as unknown as DeviceManager;
}

function fakeCore(): typeof import('@podkit/core') {
  return {
    // mediaType=1 → music, mediaType=2 → video (matches our fixture mapping)
    isMusicMediaType: (mediaType: number) => mediaType === 1,
    isVideoMediaType: (mediaType: number) => mediaType === 2,
  } as unknown as typeof import('@podkit/core');
}

// =============================================================================
// runDeviceMusic
// =============================================================================

describe('runDeviceMusic: behaviour past openDevice', () => {
  let mount: string;
  beforeEach(async () => {
    mount = await mkdtemp(join(tmpdir(), 'music-bhv-'));
  });
  afterEach(async () => {
    await rm(mount, { recursive: true, force: true });
  });

  it('--tracks emits only music-mediaType tracks as JSON', async () => {
    const ctx = makeContext(mount);
    const { out, stdout, exitCode } = makeOut();

    const tracks = [
      makeFakeIpodTrack({ title: 'Song A', mediaType: 1 }),
      makeFakeIpodTrack({ title: 'Song B', mediaType: 1 }),
      makeFakeIpodTrack({ title: 'Video X', mediaType: 2 }),
    ];

    const deps: DeviceMusicDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager(),
      openDevice: async () => makeFakeOpenDeviceResult({ tracks, isIpodDevice: true }),
    };

    await runWithContext(ctx, () =>
      runAction(out, () => runDeviceMusic({ tracks: true }, out, deps))
    );

    expect(exitCode.get()).toBeUndefined();
    const titles = stdout.json<Array<{ title: string }>>().map((t) => t.title);
    expect(titles).toEqual(['Song A', 'Song B']);
  });

  it('stats mode reports the music track count (filtering out video)', async () => {
    const ctx = makeContext(mount);
    const { out, stdout, exitCode } = makeOut();

    const tracks = [
      makeFakeIpodTrack({ mediaType: 1, duration: 200, size: 5_000_000 }),
      makeFakeIpodTrack({ mediaType: 1, duration: 180, size: 4_500_000 }),
      makeFakeIpodTrack({ mediaType: 2 }), // filtered out by isMusicMediaType
    ];

    const deps: DeviceMusicDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager(),
      openDevice: async () => makeFakeOpenDeviceResult({ tracks, isIpodDevice: true }),
    };

    await runWithContext(ctx, () => runAction(out, () => runDeviceMusic({}, out, deps)));
    expect(exitCode.get()).toBeUndefined();
    // `computeStats` shape — `tracks` is the count after filtering by
    // `isMusicMediaType`, so 3 input tracks (2 music, 1 video) → 2.
    const stats = stdout.json<{ tracks: number }>();
    expect(stats.tracks).toBe(2);
  });
});

// =============================================================================
// runDeviceVideo
// =============================================================================

describe('runDeviceVideo: behaviour past openDevice', () => {
  let mount: string;
  beforeEach(async () => {
    mount = await mkdtemp(join(tmpdir(), 'video-bhv-'));
  });
  afterEach(async () => {
    await rm(mount, { recursive: true, force: true });
  });

  it('on a video-capable device, --tracks emits only video-mediaType tracks', async () => {
    const ctx = makeContext(mount);
    const { out, stdout, exitCode } = makeOut();

    const tracks = [
      makeFakeIpodTrack({ title: 'Song A', mediaType: 1 }),
      makeFakeIpodTrack({ title: 'Movie A', mediaType: 2 }),
      makeFakeIpodTrack({ title: 'Movie B', mediaType: 2 }),
    ];

    const deps: DeviceVideoDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager(),
      openDevice: async () =>
        makeFakeOpenDeviceResult({
          tracks,
          isIpodDevice: true,
          capabilities: { supportsVideo: true },
        }),
    };

    await runWithContext(ctx, () =>
      runAction(out, () => runDeviceVideo({ tracks: true }, out, deps))
    );

    expect(exitCode.get()).toBeUndefined();
    const titles = stdout.json<Array<{ title: string }>>().map((t) => t.title);
    expect(titles).toEqual(['Movie A', 'Movie B']);
  });

  it('on a non-video-capable device, emits a JSON message and skips track listing', async () => {
    const ctx = makeContext(mount);
    const { out, stdout, exitCode } = makeOut();

    const deps: DeviceVideoDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager(),
      openDevice: async () =>
        makeFakeOpenDeviceResult({
          tracks: [makeFakeIpodTrack({ mediaType: 2 })],
          isIpodDevice: true,
          capabilities: { supportsVideo: false },
        }),
    };

    await runWithContext(ctx, () => runAction(out, () => runDeviceVideo({}, out, deps)));
    expect(exitCode.get()).toBeUndefined();
    const out_ = stdout.json<{ message: string }>();
    expect(out_.message.toLowerCase()).toContain('does not support video');
  });
});
