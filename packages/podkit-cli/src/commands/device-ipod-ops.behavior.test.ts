/**
 * Behaviour tests for the iPod-only device runners.
 *
 * Unlike the seam-check tests in `device-ipod-ops.unit.test.ts` (which only
 * verify the early-throw paths), these drive each runner past
 * `IpodDatabase.open(...)` into the meat of the operation — asserting on
 * the side effects (removeAll/removeByType/save/initialize) and the JSON
 * payload that production would emit.
 *
 * Each test scopes a real temp directory via `mkdtemp` so `existsSync`
 * passes; the `ipodDatabase` deps seam swaps in a fake adapter from
 * `test-utils/fake-ipod.ts`. No real iTunesDB ever touches disk.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceManager } from '@podkit/core';
import {
  runDeviceClear,
  runDeviceReset,
  runDeviceInit,
  runDeviceResetArtwork,
  type DeviceOpDeps,
  DeviceErrorCodes,
} from './device.js';
import { BufferExitCodeSink, OutputContext } from '../output/index.js';
import { runWithContext, type CliContext } from '../context.js';
import { runAction } from '../errors.js';
import { BufferSink } from '../test-utils/buffer-sink.js';
import { makeFakeIpodAdapter, makeFakeIpodTrack } from '../test-utils/fake-ipod.js';
import type { IpodAdapterStub, IpodDatabaseStub } from '../handler-deps.js';
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
    scan: async () => [],
    locate: async () => null,
  } as unknown as DeviceManager;
}

/**
 * Build a minimal fake `@podkit/core` module. Only the symbols the runners
 * read are populated; tests that need more pass `coreOverrides`.
 */
function fakeCore(
  overrides: Partial<typeof import('@podkit/core')> = {}
): typeof import('@podkit/core') {
  return {
    isMusicMediaType: (mediaType: number) => mediaType === 1,
    isVideoMediaType: (mediaType: number) => mediaType === 2,
    IpodError: class IpodError extends Error {
      readonly code: string;
      constructor(message: string, code: string) {
        super(message);
        this.code = code;
      }
    },
    ...overrides,
  } as unknown as typeof import('@podkit/core');
}

function makeFakeIpodDatabase(adapter: IpodAdapterStub, hasDb = true): IpodDatabaseStub {
  return {
    open: async () => adapter,
    hasDatabase: async () => hasDb,
    initializeIpod: async () => adapter,
  };
}

interface SuccessJson {
  success: true;
  [key: string]: unknown;
}
interface ErrJson {
  success: false;
  error: string;
  code: string;
}

// =============================================================================
// runDeviceClear behaviour
// =============================================================================

describe('runDeviceClear: behaviour past IpodDatabase.open', () => {
  let mount: string;
  beforeEach(async () => {
    mount = await mkdtemp(join(tmpdir(), 'clear-bhv-'));
  });
  afterEach(async () => {
    await rm(mount, { recursive: true, force: true });
  });

  it('--type all calls removeAllTracks + save and reports tracksRemoved', async () => {
    const ctx = makeContext(mount);
    const { out, stdout, exitCode } = makeOut();

    let removeAllCalled: { deleteFiles?: boolean } | undefined;
    let saveCalled = false;
    const adapter = makeFakeIpodAdapter({
      trackCount: 5,
      getTracks: () => [
        makeFakeIpodTrack({ size: 100, mediaType: 1 }),
        makeFakeIpodTrack({ size: 200, mediaType: 1 }),
        makeFakeIpodTrack({ size: 300, mediaType: 2 }),
      ],
      removeAllTracks: (opts) => {
        removeAllCalled = opts ?? {};
        return { removedCount: 3, fileDeleteErrors: [] };
      },
      save: async () => {
        saveCalled = true;
      },
    });

    const deps: DeviceOpDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager(),
      ipodDatabase: makeFakeIpodDatabase(adapter),
      confirm: async () => true,
    };

    await runWithContext(ctx, () =>
      runAction(out, () => runDeviceClear({ type: 'all', confirm: true }, out, deps))
    );

    expect(exitCode.get()).toBeUndefined();
    expect(removeAllCalled).toEqual({ deleteFiles: true });
    expect(saveCalled).toBe(true);

    const result = stdout.json<SuccessJson>();
    expect(result.success).toBe(true);
    expect(result.contentType).toBe('all');
    expect(result.tracksRemoved).toBe(3);
  });

  it('--type music calls removeTracksByContentType("music")', async () => {
    const ctx = makeContext(mount);
    const { out, stdout, exitCode } = makeOut();

    let removeByTypeArg: string | undefined;
    const adapter = makeFakeIpodAdapter({
      getTracks: () => [
        makeFakeIpodTrack({ size: 100, mediaType: 1 }),
        makeFakeIpodTrack({ size: 200, mediaType: 2 }),
      ],
      removeTracksByContentType: (type) => {
        removeByTypeArg = type;
        return { removedCount: 1, fileDeleteErrors: [] };
      },
    });

    const deps: DeviceOpDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager(),
      ipodDatabase: makeFakeIpodDatabase(adapter),
    };

    await runWithContext(ctx, () =>
      runAction(out, () => runDeviceClear({ type: 'music', confirm: true }, out, deps))
    );

    expect(exitCode.get()).toBeUndefined();
    expect(removeByTypeArg).toBe('music');
    const result = stdout.json<SuccessJson>();
    expect(result.tracksRemoved).toBe(1);
  });

  it('--dry-run skips removeAllTracks and emits dryRun:true', async () => {
    const ctx = makeContext(mount);
    const { out, stdout, exitCode } = makeOut();

    let removeAllCalled = false;
    const adapter = makeFakeIpodAdapter({
      getTracks: () => [makeFakeIpodTrack({ size: 100, mediaType: 1 })],
      removeAllTracks: () => {
        removeAllCalled = true;
        return { removedCount: 1, fileDeleteErrors: [] };
      },
    });

    const deps: DeviceOpDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager(),
      ipodDatabase: makeFakeIpodDatabase(adapter),
    };

    await runWithContext(ctx, () =>
      runAction(out, () => runDeviceClear({ type: 'all', dryRun: true }, out, deps))
    );

    expect(exitCode.get()).toBeUndefined();
    expect(removeAllCalled).toBe(false);
    const result = stdout.json<SuccessJson>();
    expect(result.dryRun).toBe(true);
  });
});

// =============================================================================
// runDeviceReset behaviour
// =============================================================================

describe('runDeviceReset: behaviour past IpodDatabase.hasDatabase/open', () => {
  let mount: string;
  beforeEach(async () => {
    mount = await mkdtemp(join(tmpdir(), 'reset-bhv-'));
  });
  afterEach(async () => {
    await rm(mount, { recursive: true, force: true });
  });

  it('--dry-run with hasDatabase=true reports current track count and dryRun', async () => {
    const ctx = makeContext(mount);
    const { out, stdout, exitCode } = makeOut();

    const adapter = makeFakeIpodAdapter({ trackCount: 42 });
    const deps: DeviceOpDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager(),
      ipodDatabase: makeFakeIpodDatabase(adapter, true),
    };

    await runWithContext(ctx, () =>
      runAction(out, () => runDeviceReset({ dryRun: true }, out, deps))
    );

    expect(exitCode.get()).toBeUndefined();
    const result = stdout.json<SuccessJson>();
    expect(result.dryRun).toBe(true);
    expect(result.tracksRemoved).toBe(42);
  });

  it('--dry-run with hasDatabase=false reports no track removal', async () => {
    const ctx = makeContext(mount);
    const { out, stdout, exitCode } = makeOut();

    const adapter = makeFakeIpodAdapter();
    const deps: DeviceOpDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager(),
      ipodDatabase: makeFakeIpodDatabase(adapter, false),
    };

    await runWithContext(ctx, () =>
      runAction(out, () => runDeviceReset({ dryRun: true }, out, deps))
    );

    expect(exitCode.get()).toBeUndefined();
    const result = stdout.json<SuccessJson>();
    expect(result.dryRun).toBe(true);
    expect(result.tracksRemoved).toBe(0);
  });
});

// =============================================================================
// runDeviceInit behaviour
// =============================================================================

describe('runDeviceInit: behaviour past hasDatabase guard', () => {
  let mount: string;
  beforeEach(async () => {
    mount = await mkdtemp(join(tmpdir(), 'init-bhv-'));
  });
  afterEach(async () => {
    await rm(mount, { recursive: true, force: true });
  });

  it('hasDatabase=true without --force throws DATABASE_EXISTS', async () => {
    const ctx = makeContext(mount);
    const { out, stdout, exitCode } = makeOut();

    let initCalled = false;
    const adapter = makeFakeIpodAdapter();
    const deps: DeviceOpDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager(),
      ipodDatabase: {
        open: async () => adapter,
        hasDatabase: async () => true,
        initializeIpod: async () => {
          initCalled = true;
          return adapter;
        },
      },
    };

    await runWithContext(ctx, () => runAction(out, () => runDeviceInit({}, out, deps)));
    expect(exitCode.get()).toBe(1);
    expect(initCalled).toBe(false);
    const err = stdout.json<ErrJson>();
    expect(err.code).toBe(DeviceErrorCodes.DATABASE_EXISTS);
  });

  it('hasDatabase=false calls initializeIpod and emits modelName in payload', async () => {
    const ctx = makeContext(mount);
    const { out, stdout, exitCode } = makeOut();

    let initCalled = false;
    const adapter = makeFakeIpodAdapter({
      device: {
        modelName: 'iPod nano (5th Generation)',
        modelNumber: 'MC031LL',
        generation: 'nano_5g',
        capacity: 8,
      },
    });
    const deps: DeviceOpDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager(),
      ipodDatabase: {
        open: async () => adapter,
        hasDatabase: async () => false,
        initializeIpod: async () => {
          initCalled = true;
          return adapter;
        },
      },
    };

    await runWithContext(ctx, () => runAction(out, () => runDeviceInit({}, out, deps)));
    expect(exitCode.get()).toBeUndefined();
    expect(initCalled).toBe(true);
    const result = stdout.json<SuccessJson>();
    expect(result.success).toBe(true);
    expect(result.modelName).toBe('iPod nano (5th Generation)');
  });
});

// =============================================================================
// runDeviceResetArtwork behaviour
// =============================================================================

describe('runDeviceResetArtwork: behaviour past IpodDatabase.open', () => {
  let mount: string;
  beforeEach(async () => {
    mount = await mkdtemp(join(tmpdir(), 'resetart-bhv-'));
  });
  afterEach(async () => {
    await rm(mount, { recursive: true, force: true });
  });

  it('--dry-run flows through resetArtworkDatabase and emits dryRun payload', async () => {
    const ctx = makeContext(mount);
    const { out, stdout, exitCode } = makeOut();

    let resetCalled = false;
    let dryRunArg: boolean | undefined;
    const adapter = makeFakeIpodAdapter({ trackCount: 7 });
    const deps: DeviceOpDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager(),
      ipodDatabase: makeFakeIpodDatabase(adapter),
      resetArtworkDatabase: (async (_db, _path, opts) => {
        resetCalled = true;
        dryRunArg = opts?.dryRun;
        return { tracksCleared: 7, totalTracks: 7, orphanedFilesRemoved: 0 };
      }) as typeof import('@podkit/core').resetArtworkDatabase,
    };

    await runWithContext(ctx, () =>
      runAction(out, () => runDeviceResetArtwork({ dryRun: true, yes: true }, out, deps))
    );

    expect(exitCode.get()).toBeUndefined();
    expect(resetCalled).toBe(true);
    expect(dryRunArg).toBe(true);
    const result = stdout.json<SuccessJson>();
    expect(result.dryRun).toBe(true);
    expect(result.tracksCleared).toBe(7);
    expect(result.totalTracks).toBe(7);
  });

  it('with --yes commits the reset and reports the cleared count', async () => {
    const ctx = makeContext(mount);
    const { out, stdout, exitCode } = makeOut();

    const adapter = makeFakeIpodAdapter({ trackCount: 50 });
    const deps: DeviceOpDeps = {
      loadCore: async () => fakeCore(),
      getDeviceManager: () => fakeManager(),
      ipodDatabase: makeFakeIpodDatabase(adapter),
      resetArtworkDatabase: (async () => ({
        tracksCleared: 40,
        totalTracks: 50,
        orphanedFilesRemoved: 3,
      })) as typeof import('@podkit/core').resetArtworkDatabase,
    };

    await runWithContext(ctx, () =>
      runAction(out, () => runDeviceResetArtwork({ yes: true }, out, deps))
    );

    expect(exitCode.get()).toBeUndefined();
    const result = stdout.json<SuccessJson>();
    expect(result.success).toBe(true);
    expect(result.tracksCleared).toBe(40);
    expect(result.orphanedFilesRemoved).toBe(3);
    expect(result.dryRun).toBe(false);
  });
});
