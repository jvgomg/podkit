/**
 * Unit tests for the `device reset` runner (factory reset).
 *
 * Exercises the runner directly with injected fakes — no CLI subprocess, no
 * gpod-tool, no real iTunesDB. A temp dir stands in for the mount path so
 * `existsSync` + path resolution pass; `IpodDatabase`, `sweepDeviceContent`,
 * `applyDeviceName`, and the config-refresh seam are all faked. NOTHING touches
 * a real device.
 *
 * Full behaviour coverage against a real fixture lives in the integration /
 * harness packages.
 */

import { describe, it, expect, mock } from 'bun:test';
import type { DeviceManager } from '@podkit/core';
import { runDeviceReset } from './device/reset.js';
import type { DeviceOpDeps } from './device/index.js';
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

function makeContext(opts: { device?: string; json?: boolean } = {}): CliContext {
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
    json: opts.json ?? true,
    quiet: true,
    verbose: 0,
    color: false,
    tips: false,
    tty: false,
    device: opts.device,
    config: undefined,
  };
  const configResult: LoadConfigResult = {
    config,
    configPath: undefined,
    configFileExists: false,
  };
  return { config, globalOpts, configResult };
}

function makeOut(json = true): {
  out: OutputContext;
  stdout: BufferSink;
  stderr: BufferSink;
  exitCode: BufferExitCodeSink;
} {
  const stdout = new BufferSink();
  const stderr = new BufferSink();
  const exitCode = new BufferExitCodeSink();
  const out = new OutputContext({
    mode: json ? 'json' : 'text',
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

interface ResetOutput {
  success: boolean;
  error?: string;
  code?: string;
  name?: string;
  modelName?: string;
  tracksRemoved?: number;
  musicFilesRemoved?: number;
  artworkFilesRemoved?: number;
  bytesFreed?: number;
  diskLabel?: string;
  diskWarning?: string;
  dryRun?: boolean;
}

function fakeManager(): DeviceManager {
  return {
    platform: 'test',
    isSupported: true,
    scan: async () => [],
    locate: async () => null,
    getManualInstructions: () => '',
    requiresPrivileges: () => false,
    assessDevice: async () => null,
  } as unknown as DeviceManager;
}

/**
 * Build a fake IpodDatabase static surface. `hasDb` controls `hasDatabase`;
 * `name` is the current master-playlist name (the device's display name).
 * Captures the spies callers want to assert against.
 */
function fakeIpodDatabase(opts: { hasDb?: boolean; name?: string } = {}) {
  const hasDb = opts.hasDb ?? true;
  const currentName = opts.name ?? 'Old Name';

  const openClose = mock(() => {});
  const initClose = mock(() => {});
  // Reset deletes the iTunesDB (via sweep) then recreates a fresh empty one with
  // initializeIpod — that is the only way to clear orphaned playlist members.
  const initializeIpod = mock(
    async (_path: string, _opts?: { name?: string }) =>
      ({
        device: { modelName: 'iPod nano (test)', modelNumber: 'X', generation: '5', capacity: 4 },
        close: initClose,
      }) as unknown
  );

  // Step 1 opens the existing DB read-only to capture the current name + model.
  const openAdapter = {
    trackCount: 7,
    device: { modelName: 'iPod nano (test)', modelNumber: 'X', generation: '5', capacity: 4 },
    getTracks: () => [],
    getMasterPlaylist: () => ({ name: currentName }),
    close: openClose,
  };

  const stub = {
    open: async () => openAdapter,
    hasDatabase: async () => hasDb,
    initializeIpod,
  } as unknown as DeviceOpDeps['ipodDatabase'];

  return { stub, initializeIpod, openClose, initClose };
}

/**
 * Fake `@podkit/core` surface: IpodError, getDeviceManager, applyDeviceName
 * (disk-only relabel), and a sweepDeviceContent spy. `applyDeviceName` here
 * asserts the runner uses the disk-only branch (database: false, no db).
 */
function fakeCore(
  opts: {
    sweep?: ReturnType<typeof mock>;
    applyDeviceName?: ReturnType<typeof mock>;
  } = {}
): DeviceOpDeps['loadCore'] {
  const sweep =
    opts.sweep ??
    mock(() => ({
      musicFilesRemoved: 3,
      artworkFilesRemoved: 2,
      bytesFreed: 12345,
      musicSwept: true,
      artworkSwept: true,
    }));
  const applyDeviceName =
    opts.applyDeviceName ??
    mock(async (input: { name: string; mountPath: string }) => ({
      name: input.name,
      databaseUpdated: false,
      diskUpdated: true,
      mountPath: input.mountPath,
    }));

  return async () =>
    ({
      IpodError: class IpodError extends Error {},
      getDeviceManager: () => fakeManager(),
      sweepDeviceContent: sweep,
      applyDeviceName,
    }) as unknown as typeof import('@podkit/core');
}

async function tmpDir(prefix: string): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return mkdtemp(join(tmpdir(), prefix));
}

function runReset(
  ctx: CliContext,
  options: Parameters<typeof runDeviceReset>[0],
  out: OutputContext,
  deps?: Parameters<typeof runDeviceReset>[2]
): Promise<unknown> {
  return runWithContext(ctx, () => runAction(out, () => runDeviceReset(options, out, deps)));
}

describe('runDeviceReset: factory reset happy path', () => {
  it('reads the current name, wipes disk + DB, recreates an empty DB, relabels', async () => {
    const dir = await tmpDir('podkit-reset-');
    const ctx = makeContext({ device: dir });
    const { out, stdout, exitCode } = makeOut();

    const { stub, initializeIpod, openClose, initClose } = fakeIpodDatabase({ name: 'Party iPod' });
    const sweep = mock(
      (_mountPath: string, _opts: { music: boolean; artwork: boolean; database: boolean }) => ({
        musicFilesRemoved: 5,
        artworkFilesRemoved: 3,
        databaseFilesRemoved: 1,
        bytesFreed: 99999,
        musicSwept: true,
        artworkSwept: true,
        databaseSwept: true,
      })
    );
    const applyDeviceName = mock(async (input: { name: string; mountPath: string }) => ({
      name: input.name,
      databaseUpdated: false,
      diskUpdated: true,
      mountPath: input.mountPath,
    }));

    const deps = {
      loadCore: fakeCore({ sweep, applyDeviceName }),
      ipodDatabase: stub,
      getDeviceManager: () => fakeManager(),
      confirm: async () => true,
      refreshConfig: async () => {},
    };

    await runReset(ctx, { yes: true }, out, deps);

    expect(exitCode.get()).toBeUndefined();
    const result = stdout.json<ResetOutput>();
    expect(result.success).toBe(true);
    expect(result.name).toBe('Party iPod');
    expect(result.tracksRemoved).toBe(7);
    expect(result.musicFilesRemoved).toBe(5);
    expect(result.artworkFilesRemoved).toBe(3);
    expect(result.bytesFreed).toBe(99999);

    // Sweep wiped everything on disk INCLUDING the database files — that is what
    // clears orphaned playlist members an API-level track removal can't reach.
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(sweep.mock.calls[0]?.[1]).toEqual({ music: true, artwork: true, database: true });

    // DB recreated empty with the carried-over name (the deleted DB means
    // initializeIpod produces a fresh, pristine one).
    expect(initializeIpod).toHaveBeenCalledTimes(1);
    expect(initializeIpod.mock.calls[0]?.[1]).toEqual({ name: 'Party iPod' });

    // applyDeviceName used the disk-only branch.
    expect(applyDeviceName).toHaveBeenCalledTimes(1);
    const applyArg = applyDeviceName.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(applyArg.database).toBe(false);
    expect(applyArg.disk).toBe(true);
    expect(applyArg.db).toBeUndefined();
    expect(applyArg.name).toBe('Party iPod');

    // The read handle (step 1) and the recreate handle (step 3) both closed.
    expect(openClose).toHaveBeenCalledTimes(1);
    expect(initClose).toHaveBeenCalledTimes(1);
  });

  it('uses --name override for the cleared DB and the label', async () => {
    const dir = await tmpDir('podkit-reset-name-');
    const ctx = makeContext({ device: dir });
    const { out, stdout, exitCode } = makeOut();

    const { stub, initializeIpod } = fakeIpodDatabase({ name: 'Old Name' });
    const applyDeviceName = mock(async (input: { name: string; mountPath: string }) => ({
      name: input.name,
      databaseUpdated: false,
      diskUpdated: true,
      mountPath: input.mountPath,
    }));

    const deps = {
      loadCore: fakeCore({ applyDeviceName }),
      ipodDatabase: stub,
      getDeviceManager: () => fakeManager(),
      confirm: async () => true,
      refreshConfig: async () => {},
    };

    await runReset(ctx, { yes: true, name: 'Brand New' }, out, deps);

    expect(exitCode.get()).toBeUndefined();
    const result = stdout.json<ResetOutput>();
    expect(result.name).toBe('Brand New');
    expect(initializeIpod.mock.calls[0]?.[1]).toEqual({ name: 'Brand New' });
    const applyArg = applyDeviceName.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(applyArg.name).toBe('Brand New');
  });
});

describe('runDeviceReset: AC#4 uninitialised device', () => {
  it('errors with NOT_INITIALIZED pointing to init when no DB exists', async () => {
    const dir = await tmpDir('podkit-reset-nodb-');
    const ctx = makeContext({ device: dir });
    const { out, stdout, exitCode } = makeOut();

    const { stub, initializeIpod } = fakeIpodDatabase({ hasDb: false });
    const sweep = mock(() => ({
      musicFilesRemoved: 0,
      artworkFilesRemoved: 0,
      bytesFreed: 0,
      musicSwept: true,
      artworkSwept: true,
    }));

    const deps = {
      loadCore: fakeCore({ sweep }),
      ipodDatabase: stub,
      getDeviceManager: () => fakeManager(),
      confirm: async () => true,
      refreshConfig: async () => {},
    };

    await runReset(ctx, { yes: true }, out, deps);

    expect(exitCode.get()).toBe(1);
    const err = stdout.json<ResetOutput>();
    expect(err.success).toBe(false);
    expect(err.code).toBe('NOT_INITIALIZED');
    expect(err.error).toContain('device init');

    // Nothing mutated.
    expect(initializeIpod).not.toHaveBeenCalled();
    expect(sweep).not.toHaveBeenCalled();
  });

  it('errors with NOT_INITIALIZED when the DB exists but has no readable name', async () => {
    const dir = await tmpDir('podkit-reset-noname-');
    const ctx = makeContext({ device: dir });
    const { out, stdout, exitCode } = makeOut();

    // hasDb true, but the master playlist name is blank.
    const { stub, initializeIpod } = fakeIpodDatabase({ hasDb: true, name: '' });
    const sweep = mock(() => ({
      musicFilesRemoved: 0,
      artworkFilesRemoved: 0,
      bytesFreed: 0,
      musicSwept: true,
      artworkSwept: true,
    }));

    const deps = {
      loadCore: fakeCore({ sweep }),
      ipodDatabase: stub,
      getDeviceManager: () => fakeManager(),
      confirm: async () => true,
      refreshConfig: async () => {},
    };

    await runReset(ctx, { yes: true }, out, deps);

    expect(exitCode.get()).toBe(1);
    const err = stdout.json<ResetOutput>();
    expect(err.success).toBe(false);
    expect(err.code).toBe('NOT_INITIALIZED');
    expect(err.error).toContain('device init');

    // No destructive step ran.
    expect(initializeIpod).not.toHaveBeenCalled();
    expect(sweep).not.toHaveBeenCalled();
  });
});

describe('runDeviceReset: confirmation', () => {
  it('cancels (no mutation) when the user declines', async () => {
    const dir = await tmpDir('podkit-reset-cancel-');
    const ctx = makeContext({ device: dir, json: false });
    const { out, stdout, exitCode } = makeOut(false);

    const { stub, initializeIpod } = fakeIpodDatabase({ name: 'Keep Me' });
    const sweep = mock(() => ({
      musicFilesRemoved: 0,
      artworkFilesRemoved: 0,
      bytesFreed: 0,
      musicSwept: true,
      artworkSwept: true,
    }));
    const applyDeviceName = mock(async () => ({
      name: 'Keep Me',
      databaseUpdated: false,
      diskUpdated: true,
      mountPath: dir,
    }));

    const deps = {
      loadCore: fakeCore({ sweep, applyDeviceName }),
      ipodDatabase: stub,
      getDeviceManager: () => fakeManager(),
      confirm: async () => false,
      refreshConfig: async () => {},
    };

    await runReset(ctx, {}, out, deps);

    expect(exitCode.get()).toBeUndefined();
    expect(stdout.text()).toContain('Cancelled');
    expect(initializeIpod).not.toHaveBeenCalled();
    expect(sweep).not.toHaveBeenCalled();
    expect(applyDeviceName).not.toHaveBeenCalled();
  });
});

describe('runDeviceReset: dry run', () => {
  it('reports the plan and performs no mutations', async () => {
    const dir = await tmpDir('podkit-reset-dry-');
    const ctx = makeContext({ device: dir });
    const { out, stdout, exitCode } = makeOut();

    const { stub, initializeIpod, openClose } = fakeIpodDatabase({ name: 'Dry Run iPod' });
    const sweep = mock(() => ({
      musicFilesRemoved: 0,
      artworkFilesRemoved: 0,
      bytesFreed: 0,
      musicSwept: true,
      artworkSwept: true,
    }));
    const applyDeviceName = mock(async () => ({
      name: 'Dry Run iPod',
      databaseUpdated: false,
      diskUpdated: true,
      mountPath: dir,
    }));

    const deps = {
      loadCore: fakeCore({ sweep, applyDeviceName }),
      ipodDatabase: stub,
      getDeviceManager: () => fakeManager(),
      confirm: async () => true,
      refreshConfig: async () => {},
    };

    await runReset(ctx, { dryRun: true }, out, deps);

    expect(exitCode.get()).toBeUndefined();
    const result = stdout.json<ResetOutput>();
    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.name).toBe('Dry Run iPod');
    expect(result.tracksRemoved).toBe(7);

    // No mutation in dry run.
    expect(initializeIpod).not.toHaveBeenCalled();
    expect(sweep).not.toHaveBeenCalled();
    expect(applyDeviceName).not.toHaveBeenCalled();

    // Only the read-for-name handle was opened + closed; no mutate open.
    expect(openClose).toHaveBeenCalledTimes(1);
  });
});
