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
    scan: async () => [],
    locate: async () => null,
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

  it("surfaces COLLECTION_NOT_FOUND offline for a typo'd -c, before any device error", async () => {
    // A device path is given but no device is connected, so the device-path
    // resolution would fail. The `-c` flag is wholesale + device-independent,
    // so its "not found" must surface FIRST — offline, before the device error
    // and before core ever loads.
    const ctx = makeContext('/Volumes/DefinitelyNotConnected');
    const { out, stdout, exitCode } = makeOut();
    let loadCoreCalled = false;
    const deps: SyncDeps = {
      getDeviceManager: () => fakeManager(),
      loadCore: async () => {
        loadCoreCalled = true;
        return {} as typeof import('@podkit/core');
      },
    };
    await runWithContext(ctx, () =>
      runAction(out, () => runSync({ collection: 'does-not-exist' }, out, deps))
    );
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<ErrJson>();
    expect(err.code).toBe(SyncErrorCodes.COLLECTION_NOT_FOUND);
    expect(err.error).toContain('does-not-exist');
    // Resolved offline — core never loaded, no device path resolution reached.
    expect(loadCoreCalled).toBe(false);
  });

  it('surfaces SOURCE_NOT_FOUND offline for a -c with a bad source path, before any device error', async () => {
    // `-c main` exists but its source directory does not. With a disconnected
    // device path, the bad-source error must still surface FIRST (offline).
    const ctx = makeContext('/Volumes/DefinitelyNotConnected');
    // Point the 'main' collection at a path that does not exist.
    ctx.config.music = { main: { path: '/no/such/source/dir/podkit-test' } };
    const { out, stdout, exitCode } = makeOut();
    let loadCoreCalled = false;
    const deps: SyncDeps = {
      getDeviceManager: () => fakeManager(),
      loadCore: async () => {
        loadCoreCalled = true;
        return {} as typeof import('@podkit/core');
      },
    };
    await runWithContext(ctx, () =>
      runAction(out, () => runSync({ collection: 'main' }, out, deps))
    );
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<ErrJson>();
    expect(err.code).toBe(SyncErrorCodes.SOURCE_NOT_FOUND);
    expect(err.error).toContain('/no/such/source/dir/podkit-test');
    expect(loadCoreCalled).toBe(false);
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
              family: 'iPod nano',
              ordinal: 7,
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

  it('no longer refuses a syncable shuffle at the sync gate', async () => {
    const ctx = makeContext(sharedSourceDir);
    const { out, stdout, exitCode } = makeOut();

    // shuffle_1g/shuffle_2g are `syncable`, and podkit writes their playback
    // database through libgpod once the device's identity is on disk. Sync
    // must therefore treat them like any other syncable iPod and fall through
    // to the next gate in the cascade (blank device / needs-init here) rather
    // than refusing on capability grounds.
    let openedDevice = false;
    const deps: SyncDeps = {
      getDeviceManager: () => fakeManager(),
      loadCore: async () => {
        const real = await import('@podkit/core');
        return {
          ...real,
          assessIpodIdentity: async () => ({
            model: {
              displayName: 'iPod shuffle 1GB Pink (2nd Generation)',
              generationId: 'shuffle_2g',
              family: 'iPod shuffle',
              ordinal: 2,
              checksumType: 'none',
              modelNumber: 'A947',
              source: 'serial',
            },
            capabilities: null,
            needsChecksum: false,
            checksumType: 'none',
            firmwareInquiry: 'present',
            existing: null,
            usbFingerprint: null,
            sysInfoModelNumber: undefined,
          }),
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
    expect(err.code).toBe(SyncErrorCodes.IPOD_NEEDS_INIT);
    expect(openedDevice).toBe(false);
  });

  it('refuses a read-only shuffle on access grounds', async () => {
    const ctx = makeContext(sharedSourceDir);
    const { out, stdout, exitCode } = makeOut();

    // shuffle_3g/shuffle_4g carry an `unsupportedReason` (read-only access),
    // and the unsupported-device gate must keep catching them. The sibling
    // test above proves a *syncable* shuffle sails through — these two pin the
    // distinction: the refusal tracks the device's access tier, never the
    // shuffle family as a whole.
    const deps: SyncDeps = {
      getDeviceManager: () => fakeManager(),
      loadCore: async () => {
        const real = await import('@podkit/core');
        return {
          ...real,
          assessIpodIdentity: async () => ({
            model: {
              displayName: 'iPod shuffle (4th Generation)',
              generationId: 'shuffle_4g',
              family: 'iPod shuffle',
              ordinal: 4,
              checksumType: 'none',
              source: 'usb',
              unsupportedReason: {
                kind: 'unsupported-device',
                headline: 'iPod shuffle (4th Generation) is read-only in podkit.',
                docsUrl: 'https://jvgomg.github.io/podkit/devices/supported-devices',
              },
            },
            capabilities: null,
            needsChecksum: false,
            checksumType: 'none',
            firmwareInquiry: 'present',
            existing: null,
            usbFingerprint: null,
            sysInfoModelNumber: undefined,
          }),
        } as typeof real;
      },
    };

    await runWithContext(ctx, () => runAction(out, () => runSync({ dryRun: true }, out, deps)));
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<ErrJson>();
    expect(err.code).toBe(SyncErrorCodes.DEVICE_UNSUPPORTED);
  });

  it('refuses cleanly with UNKNOWN_IPOD_MODEL when the cascade resolves no model', async () => {
    const ctx = makeContext(sharedSourceDir);
    const { out, stdout, exitCode } = makeOut();

    // Assessment succeeds but the cascade yields no model (no SIE, no serial,
    // no USB fingerprint). Sync must refuse BEFORE FFmpeg detect / DB open
    // rather than silently degrading to a generic iPod.
    let openedDevice = false;
    const deps: SyncDeps = {
      getDeviceManager: () => fakeManager(),
      loadCore: async () => {
        const real = await import('@podkit/core');
        return {
          ...real,
          assessIpodIdentity: async () => ({
            model: null,
            capabilities: null,
            needsChecksum: false,
            checksumType: undefined,
            firmwareInquiry: 'missing',
            existing: null,
            usbFingerprint: null,
            sysInfoModelNumber: undefined,
          }),
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
    expect(err.code).toBe(SyncErrorCodes.UNKNOWN_IPOD_MODEL);
    // Actionable remediation: one-time USB setup + in-place repair.
    expect(err.error).toContain('device add');
    expect(err.error).toContain('doctor --repair sysinfo-extended');
    // Neutral wording — no implementation leakage.
    expect(err.error.toLowerCase()).not.toContain('libgpod');
    // Refused before any heavy work.
    expect(openedDevice).toBe(false);
  });

  it('refuses cleanly with IPOD_NEEDS_INIT when the device has no database', async () => {
    const ctx = makeContext(sharedSourceDir);
    const { out, stdout, exitCode } = makeOut();

    // The device path is a plain directory with no iPod_Control/iTunes/iTunesDB
    // (sharedSourceDir doubles as the blank "device"). Identity resolves fine —
    // the device is set up, just never initialised — so the refusal must be the
    // distinct needs-init code, not UNKNOWN_IPOD_MODEL and not the overloaded
    // IPOD_OPEN_FAILED from the open path.
    let heavyWork = false;
    const deps: SyncDeps = {
      getDeviceManager: () => fakeManager(),
      loadCore: async () => {
        const real = await import('@podkit/core');
        return {
          ...real,
          assessIpodIdentity: async () => ({
            model: {
              displayName: 'iPod Video (5th Generation)',
              generationId: 'video_5g',
              family: 'iPod Video',
              ordinal: 5,
              checksumType: 'none',
              source: 'sysinfo',
            },
            capabilities: null,
            needsChecksum: false,
            checksumType: undefined,
            firmwareInquiry: 'present',
            existing: null,
            usbFingerprint: null,
            sysInfoModelNumber: 'MA446',
          }),
          // Detect heavy work (FFmpeg detect runs just before the DB open).
          createFFmpegTranscoder: () => {
            heavyWork = true;
            return real.createFFmpegTranscoder();
          },
        } as typeof real;
      },
    };

    await runWithContext(ctx, () => runAction(out, () => runSync({ dryRun: true }, out, deps)));
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<ErrJson>();
    expect(err.code).toBe(SyncErrorCodes.IPOD_NEEDS_INIT);
    // Actionable remediation: point at the init command, not at open-failure
    // debugging.
    expect(err.error).toContain('podkit device init');
    expect(err.error.toLowerCase()).not.toContain('libgpod');
    // Refused before FFmpeg detect / DB open.
    expect(heavyWork).toBe(false);
  });

  it('does not claim needs-init when identity assessment failed on a databaseless path', async () => {
    const ctx = makeContext(sharedSourceDir);
    const { out, stdout, exitCode } = makeOut();

    // Assessment throwing means "this may not be an iPod at all" — e.g. an
    // unregistered `-d /path` pointing at a mass-storage player. Claiming
    // IPOD_NEEDS_INIT there would misdirect the user to `device init` on a
    // non-iPod, so the blank-device gate must stand down and let the open
    // path surface its own failure.
    const deps: SyncDeps = {
      getDeviceManager: () => fakeManager(),
      loadCore: async () => {
        const real = await import('@podkit/core');
        return {
          ...real,
          assessIpodIdentity: async () => {
            throw new Error('not an iPod');
          },
        } as typeof real;
      },
    };

    await runWithContext(ctx, () => runAction(out, () => runSync({ dryRun: true }, out, deps)));
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<ErrJson>();
    expect(err.code).toBe(SyncErrorCodes.IPOD_OPEN_FAILED);
    expect(err.code).not.toBe(SyncErrorCodes.IPOD_NEEDS_INIT);
  });
});
