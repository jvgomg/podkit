/**
 * Unit tests for the `sync` runner.
 *
 * The full sync flow is exercised end-to-end against real fixtures in
 * `sync.integration.test.ts`. These tests target the dependency-injection
 * seam on `runSync` — they confirm the short-circuit paths (validation,
 * core-load failure) without performing a real USB walk.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceManager } from '@podkit/core';
import { runSync, type SyncDeps, SyncErrorCodes } from './sync.js';
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

let sharedSourceDir = '/tmp';

function makeContext(device?: string, withCollections = true): CliContext {
  const config: PodkitConfig = {
    quality: 'medium',
    artwork: true,
    tips: true,
    transforms: DEFAULT_TRANSFORMS_CONFIG,
    videoTransforms: DEFAULT_VIDEO_TRANSFORMS_CONFIG,
    devices: {},
    music: withCollections ? { main: { path: sharedSourceDir } } : {},
    video: {},
    defaults: withCollections ? { music: 'main' } : undefined,
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

interface ErrJson {
  success: false;
  error: string;
  code: string;
}

function fakeManager(): DeviceManager {
  return {
    platform: 'test',
    isSupported: true,
    findIpodDevices: async () => [],
    findByVolumeUuid: async () => null,
    getUuidForMountPoint: async () => null,
    listDevices: async () => [],
  } as unknown as DeviceManager;
}

describe('runSync: validation + deps seam', () => {
  beforeAll(async () => {
    sharedSourceDir = await mkdtemp(join(tmpdir(), 'sync-runner-'));
  });
  afterAll(async () => {
    await rm(sharedSourceDir, { recursive: true, force: true });
  });

  it('rejects an invalid --type value with INVALID_SYNC_TYPE', async () => {
    const ctx = makeContext('/Volumes/iPod');
    const { out, stdout, exitCode } = makeOut();
    await runWithContext(ctx, () =>
      runAction(out, () => runSync({ type: ['photos'] } as never, out))
    );
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<ErrJson>();
    expect(err.code).toBe(SyncErrorCodes.INVALID_SYNC_TYPE);
  });

  it('honours deps.loadCore — sync reaches it before performing real USB walk', async () => {
    const ctx = makeContext();
    const { out, exitCode } = makeOut();
    let loadCoreCalled = false;
    const deps: SyncDeps = {
      loadCore: async () => {
        loadCoreCalled = true;
        return {} as typeof import('@podkit/core');
      },
      getDeviceManager: () => fakeManager(),
    };
    // No --device + no default → runner enters auto-detect, which requires
    // loadCore. We don't care about the eventual outcome here, only that the
    // seam was honoured before any real USB walk could happen.
    await runWithContext(ctx, () => runAction(out, () => runSync({}, out, deps)));
    expect(loadCoreCalled).toBe(true);
    expect(exitCode.get()).toBe(1);
  });

  it('surfaces CORE_LOAD_FAILED when loadCore rejects', async () => {
    const ctx = makeContext('/Volumes/iPod');
    const { out, stdout, exitCode } = makeOut();
    const deps: SyncDeps = {
      loadCore: async () => {
        throw new Error('mock failure');
      },
    };
    await runWithContext(ctx, () => runAction(out, () => runSync({}, out, deps)));
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<ErrJson>();
    expect(err.code).toBe(SyncErrorCodes.CORE_LOAD_FAILED);
    expect(err.error).toContain('mock failure');
  });

  it('refuses cleanly with DEVICE_UNSUPPORTED when cascade resolves to an unsupported generation', async () => {
    const ctx = makeContext(sharedSourceDir);
    const { out, stdout, exitCode } = makeOut();

    // Use a real core import but stub `assessIpodIdentity` to return an
    // unsupported generation. The runner gates on this BEFORE any FFmpeg
    // detection, DB open, or track-plan generation.
    let openedDevice = false;
    const deps: SyncDeps = {
      getDeviceManager: () => fakeManager(),
      loadCore: async () => {
        const real = await import('@podkit/core');
        return {
          ...real,
          assessIpodIdentity: async () => ({
            model: {
              displayName: 'iPod nano (7th Generation)',
              generationId: 'nano_7g',
              checksumType: 'hashAB',
              source: 'usb',
              unsupportedReason: {
                kind: 'unsupported-device',
                headline: 'iPod nano (7th Generation) is not supported by podkit.',
                docsUrl: 'https://jvgomg.github.io/podkit/devices/supported-devices',
              },
            },
            capabilities: null,
            needsChecksum: true,
            checksumType: 'hashAB',
            firmwareInquiry: 'present',
            existing: null,
            usbFingerprint: null,
            sysInfoModelNumber: undefined,
          }),
          // Detect track-plan execution by spying on FFmpeg detect.
          createFFmpegTranscoder: () => {
            openedDevice = true;
            return real.createFFmpegTranscoder();
          },
        } as typeof real;
      },
    };

    await runWithContext(ctx, () => runAction(out, () => runSync({ dryRun: true }, out, deps)));
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<ErrJson>();
    expect(err.code).toBe(SyncErrorCodes.DEVICE_UNSUPPORTED);
    expect(err.error).toContain('iPod nano (7th Generation) is not supported');
    // Error wording must surface the unsupported-device reason without
    // mentioning libgpod; the latter is an internal detail and would
    // confuse end users running into this on an iPod nano 7g.
    expect(err.error.toLowerCase()).not.toContain('libgpod');
    // No track plan generated.
    expect(openedDevice).toBe(false);
  });
});
