/**
 * Unit tests for the `device rename` runner.
 *
 * Exercises validation branches and the database-only happy path in
 * `runDeviceRename` directly — no CLI subprocess, no gpod-tool. Each test
 * scopes its own CliContext via `runWithContext` and injects fakes via
 * `DeviceOpDeps`, capturing output through BufferSink.
 *
 * End-to-end coverage of the wired-up `podkit device rename` command (real
 * iTunesDB) is left to the harness / e2e packages.
 */

import { describe, it, expect, mock } from 'bun:test';
import type { DeviceManager } from '@podkit/core';
import { runDeviceRename, type DeviceOpDeps } from './device/index.js';
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

interface RenameOutput {
  success: boolean;
  error?: string;
  code?: string;
  name?: string;
  databaseUpdated?: boolean;
  diskUpdated?: boolean;
  mountPoint?: string;
  diskLabel?: string;
  diskWarning?: string;
}

function runRename(
  ctx: CliContext,
  name: string,
  options: Parameters<typeof runDeviceRename>[1],
  out: OutputContext,
  deps?: DeviceOpDeps
): Promise<unknown> {
  return runWithContext(ctx, () => runAction(out, () => runDeviceRename(name, options, out, deps)));
}

/**
 * Build a fake `@podkit/core` module surface sufficient for the rename runner:
 * `IpodError`, a `getDeviceManager`, and the real-ish `applyDeviceName` that
 * delegates to the injected db (we mirror the production shape here so the test
 * verifies the runner wires the db + flags through correctly).
 */
function fakeCore(extra: Partial<Record<string, unknown>> = {}): DeviceOpDeps['loadCore'] {
  return async () =>
    ({
      IpodError: class IpodError extends Error {},
      getDeviceManager: () => fakeManager(),
      applyDeviceName: async (input: {
        db: { setDeviceName(n: string): void; save(): Promise<unknown> };
        mountPath: string;
        name: string;
        disk?: boolean;
        database?: boolean;
      }) => {
        let databaseUpdated = false;
        if (input.database !== false) {
          input.db.setDeviceName(input.name);
          await input.db.save();
          databaseUpdated = true;
        }
        return {
          name: input.name,
          databaseUpdated,
          diskUpdated: false,
          mountPath: input.mountPath,
        };
      },
      ...extra,
    }) as unknown as typeof import('@podkit/core');
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

function fakeIpodDatabaseStub(): {
  stub: DeviceOpDeps['ipodDatabase'];
  setDeviceName: ReturnType<typeof mock>;
  save: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
} {
  const setDeviceName = mock(() => {});
  const save = mock(async () => undefined);
  const close = mock(() => {});
  const adapter = {
    trackCount: 0,
    device: { modelName: 'iPod', modelNumber: 'MA', generation: '5', capacity: 30 },
    getTracks: () => [],
    removeAllTracks: () => ({ removedCount: 0, fileDeleteErrors: [] }),
    removeTracksByContentType: () => ({ removedCount: 0, fileDeleteErrors: [] }),
    setDeviceName,
    save,
    close,
  };
  const stub = {
    open: async () => adapter,
    hasDatabase: async () => true,
    initializeIpod: async () => adapter,
  } as unknown as DeviceOpDeps['ipodDatabase'];
  return { stub, setDeviceName, save, close };
}

describe('runDeviceRename: validation', () => {
  it('rejects when both --no-disk and --no-database are passed', async () => {
    const ctx = makeContext({ device: '/tmp/some-ipod' });
    const { out, stdout, exitCode } = makeOut();
    await runRename(ctx, 'New Name', { disk: false, database: false }, out);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<RenameOutput>();
    expect(err.success).toBe(false);
    expect(err.code).toBe('NOTHING_TO_RENAME');
  });

  it('rejects an empty name', async () => {
    const ctx = makeContext({ device: '/tmp/some-ipod' });
    const { out, stdout, exitCode } = makeOut();
    await runRename(ctx, '   ', { disk: false }, out);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<RenameOutput>();
    expect(err.success).toBe(false);
    expect(err.code).toBe('NAME_REQUIRED');
  });
});

describe('runDeviceRename: database-only happy path (--no-disk)', () => {
  it('writes the device name, saves, and closes', async () => {
    // Use a real temp dir so existsSync + path resolution pass.
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'podkit-rename-'));

    const ctx = makeContext({ device: dir });
    const { out, stdout, exitCode } = makeOut();
    const { stub, setDeviceName, save, close } = fakeIpodDatabaseStub();

    const deps: DeviceOpDeps = {
      loadCore: fakeCore(),
      ipodDatabase: stub,
      getDeviceManager: () => fakeManager(),
      confirm: async () => true,
    };

    await runRename(ctx, 'Party iPod', { disk: false, yes: true }, out, deps);

    // Success leaves the exit code unset (undefined); errors set it to 1.
    expect(exitCode.get()).toBeUndefined();
    const result = stdout.json<RenameOutput>();
    expect(result.success).toBe(true);
    expect(result.name).toBe('Party iPod');
    expect(result.databaseUpdated).toBe(true);
    expect(result.diskUpdated).toBe(false);

    expect(setDeviceName).toHaveBeenCalledWith('Party iPod');
    expect(save).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('runDeviceRename: disk relabel surfaces lossy warning', () => {
  it('carries diskLabel + diskWarning into the result and warns in text mode', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'podkit-rename-disk-'));

    const ctx = makeContext({ device: dir, json: false });
    const { out, stdout, stderr, exitCode } = makeOut(false);
    const { stub } = fakeIpodDatabaseStub();

    // Fake core whose applyDeviceName reports a lossy FAT relabel.
    const loadCore: DeviceOpDeps['loadCore'] = async () =>
      ({
        IpodError: class IpodError extends Error {},
        getDeviceManager: () => fakeManager(),
        applyDeviceName: async (input: { name: string; mountPath: string }) => ({
          name: input.name,
          databaseUpdated: true,
          diskUpdated: true,
          mountPath: '/Volumes/PARTY IPOD',
          diskLabel: 'PARTY IPOD',
          diskWarning:
            'Disk label set to "PARTY IPOD" (FAT volume labels are uppercase and limited to 11 characters).',
        }),
      }) as unknown as typeof import('@podkit/core');

    const deps: DeviceOpDeps = {
      loadCore,
      ipodDatabase: stub,
      getDeviceManager: () => fakeManager(),
      confirm: async () => true,
    };

    await runRename(ctx, 'Party iPod', { yes: true }, out, deps);

    expect(exitCode.get()).toBeUndefined();
    // Text mode: the relabel warning lands on stderr.
    expect(stderr.text()).toContain('PARTY IPOD');
    expect(stdout.text()).toContain('Renamed iPod to "Party iPod"');
  });

  it('prints a line per surface and does NOT warn for a case-only relabel', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'podkit-rename-case-'));

    const ctx = makeContext({ device: dir, json: false });
    const { out, stdout, stderr, exitCode } = makeOut(false);
    const { stub } = fakeIpodDatabaseStub();

    // Case-only FAT relabel: label uppercased, but NOT lossy → no diskWarning.
    const loadCore: DeviceOpDeps['loadCore'] = async () =>
      ({
        IpodError: class IpodError extends Error {},
        getDeviceManager: () => fakeManager(),
        applyDeviceName: async (input: { name: string; mountPath: string }) => ({
          name: input.name,
          databaseUpdated: true,
          diskUpdated: true,
          mountPath: '/Volumes/GREENPOD',
          diskLabel: 'GREENPOD',
          // no diskWarning — case-folding is not lossy
        }),
      }) as unknown as typeof import('@podkit/core');

    const deps: DeviceOpDeps = {
      loadCore,
      ipodDatabase: stub,
      getDeviceManager: () => fakeManager(),
      confirm: async () => true,
    };

    await runRename(ctx, 'GreenPod', { yes: true }, out, deps);

    expect(exitCode.get()).toBeUndefined();
    const text = stdout.text();
    expect(text).toContain('Renamed iPod to "GreenPod"');
    expect(text).toContain('Disk label set to "GREENPOD"');
    // No warning for a pure case change.
    expect(stderr.text()).not.toContain('Warning');
  });
});
