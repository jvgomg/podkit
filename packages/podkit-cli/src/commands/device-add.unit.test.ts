/**
 * Unit tests for the `device add` runner.
 *
 * Exercises argv-validation branches and short-circuit error paths in
 * `runDeviceAdd` directly — no CLI subprocess. Each test scopes its own
 * CliContext via `runWithContext` and captures output via BufferSink.
 *
 * For built-binary smoke coverage (the wired-up `podkit device add`
 * command end-to-end), see test-packages/e2e-tests/src/commands/device.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMassStorageProvider, BUILT_IN_PRESETS } from '@podkit/devices-mass-storage';
import { enumerateConnectedDevices } from '@podkit/core';
import type { EnumeratedUsbDevice, DeviceManager } from '@podkit/core';
import { runDeviceAdd, type DeviceAddDeps } from './device.js';
import { BufferExitCodeSink, OutputContext } from '../output/index.js';
import type {
  IpodIdentityAssessment,
  IpodModel,
  DeviceCapabilities,
  SysInfoExtendedResult,
  CompleteUsbDevice,
} from '@podkit/core';
import { runWithContext, type CliContext } from '../context.js';
import { runAction } from '../errors.js';
import { BufferSink } from '../test-utils/buffer-sink.js';
import {
  DEFAULT_TRANSFORMS_CONFIG,
  DEFAULT_VIDEO_TRANSFORMS_CONFIG,
  type PodkitConfig,
  type GlobalOptions,
  type LoadConfigResult,
  type DeviceConfig,
} from '../config/index.js';

// =============================================================================
// Helpers
// =============================================================================

interface MakeContextOptions {
  device?: string;
  devices?: Record<string, DeviceConfig>;
  configPath?: string;
  json?: boolean;
}

function makeContext(opts: MakeContextOptions = {}): CliContext {
  const config: PodkitConfig = {
    quality: 'medium',
    artwork: true,
    tips: true,
    transforms: DEFAULT_TRANSFORMS_CONFIG,
    videoTransforms: DEFAULT_VIDEO_TRANSFORMS_CONFIG,
    devices: opts.devices ?? {},
    music: {},
    video: {},
  };
  const globalOpts: GlobalOptions = {
    json: opts.json ?? true, // JSON mode by default — tests assert structured payloads
    quiet: false,
    verbose: 0,
    color: false,
    tips: false,
    tty: false,
    device: opts.device,
    config: opts.configPath,
  };
  const configResult: LoadConfigResult = {
    config,
    configPath: opts.configPath,
    configFileExists: !!opts.configPath,
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

/** Minimal DeviceManager double — every method throws unless overridden. */
function fakeManager(overrides: Partial<DeviceManager> = {}): DeviceManager {
  const notImplemented = () => {
    throw new Error('fakeManager method not stubbed');
  };
  // Cast through unknown so we don't have to satisfy every method by hand —
  // tests only exercise the few we care about and stub the rest via overrides.
  const base: Partial<DeviceManager> = {
    platform: 'test',
    isSupported: true,
    eject: notImplemented as DeviceManager['eject'],
    mount: notImplemented as DeviceManager['mount'],
    listDevices: async () => [],
    findIpodDevices: async () => [],
    findByVolumeUuid: async () => null,
    getManualInstructions: () => '',
    requiresPrivileges: () => false,
    getUuidForMountPoint: async () => null,
    assessDevice: async () => null,
  };
  return { ...base, ...overrides } as DeviceManager;
}

interface AddOutputError {
  success: false;
  error: string;
  code?: string;
}

/**
 * Run the device-add runner exactly as production does — through runAction so
 * thrown CliErrors become structured output + process.exitCode mutation.
 * Tests assert on the captured stdout/stderr just like a JSON consumer would.
 */
function runAdd(
  ctx: CliContext,
  options: Parameters<typeof runDeviceAdd>[0],
  out: OutputContext,
  deps?: DeviceAddDeps
): Promise<unknown> {
  return runWithContext(ctx, () => runAction(out, () => runDeviceAdd(options, out, deps)));
}

// =============================================================================
// Validation: --device / name regex / duplicate
// =============================================================================

describe('runDeviceAdd: device flag + name validation', () => {
  it('rejects when neither positional name nor -d is given', async () => {
    const ctx = makeContext({ device: undefined });
    const { out, stdout, exitCode } = makeOut();
    await runAdd(ctx, {}, out);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<AddOutputError>();
    expect(err.success).toBe(false);
    // Usage hint shows both forms — the program-level `-d` and the positional.
    expect(err.error).toContain('podkit device add <name>');
    expect(err.error).toContain('-d');
  });

  it('rejects when positional and -d disagree', async () => {
    const ctx = makeContext({ device: 'from-d' });
    const { out, stdout, exitCode } = makeOut();
    await runAdd(ctx, { type: 'echo-mini', name: 'from-positional' }, out);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<AddOutputError>();
    expect(err.error).toContain('from-d');
    expect(err.error).toContain('from-positional');
  });

  it('rejects an invalid device name (must start with a letter)', async () => {
    const ctx = makeContext({ device: '1bad' });
    const { out, stdout, exitCode } = makeOut();
    await runAdd(ctx, { type: 'echo-mini' }, out);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<AddOutputError>();
    expect(err.error.toLowerCase()).toContain('invalid device name');
  });

  it('rejects a duplicate device name', async () => {
    const ctx = makeContext({
      device: 'foo',
      devices: { foo: { volumeUuid: 'x', volumeName: 'foo' } },
    });
    const { out, stdout, exitCode } = makeOut();
    await runAdd(ctx, { type: 'echo-mini' }, out);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<AddOutputError>();
    expect(err.error).toContain('"foo"');
    expect(err.error.toLowerCase()).toContain('already exists');
  });
});

// =============================================================================
// Validation: quality / encoding presets
// =============================================================================

describe('runDeviceAdd: quality + encoding option validation', () => {
  it('rejects an unknown --quality preset', async () => {
    const ctx = makeContext({ device: 'd' });
    const { out, stdout, exitCode } = makeOut();
    await runAdd(ctx, { type: 'echo-mini', quality: 'bogus' as never }, out);
    expect(exitCode.get()).toBe(1);
    expect(stdout.json<AddOutputError>().error).toContain('quality preset');
  });

  it('rejects an unknown --audio-quality preset', async () => {
    const ctx = makeContext({ device: 'd' });
    const { out, stdout, exitCode } = makeOut();
    await runAdd(ctx, { type: 'echo-mini', audioQuality: 'bogus' as never }, out);
    expect(exitCode.get()).toBe(1);
    expect(stdout.json<AddOutputError>().error).toContain('audio quality preset');
  });

  it('rejects an unknown --video-quality preset', async () => {
    const ctx = makeContext({ device: 'd' });
    const { out, stdout, exitCode } = makeOut();
    await runAdd(ctx, { type: 'echo-mini', videoQuality: 'bogus' as never }, out);
    expect(exitCode.get()).toBe(1);
    expect(stdout.json<AddOutputError>().error).toContain('video quality preset');
  });

  it('rejects an unknown --encoding mode', async () => {
    const ctx = makeContext({ device: 'd' });
    const { out, stdout, exitCode } = makeOut();
    await runAdd(ctx, { type: 'echo-mini', encoding: 'lossy' as never }, out);
    expect(exitCode.get()).toBe(1);
    expect(stdout.json<AddOutputError>().error).toContain('encoding mode');
  });
});

// =============================================================================
// Mass-storage: --path required, path-not-found, path-not-directory
// =============================================================================

describe('runDeviceAdd: mass-storage --path validation', () => {
  it('requires --path when --type echo-mini is given', async () => {
    const ctx = makeContext({ device: 'myecho' });
    const { out, stdout, exitCode } = makeOut();
    await runAdd(ctx, { type: 'echo-mini' }, out);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<AddOutputError>();
    expect(err.error).toContain('--path is required');
    expect(err.error).toContain('echo-mini');
  });

  it('requires --path when --type rockbox is given', async () => {
    const ctx = makeContext({ device: 'myrock' });
    const { out, stdout, exitCode } = makeOut();
    await runAdd(ctx, { type: 'rockbox' }, out);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<AddOutputError>();
    expect(err.error).toContain('--path is required');
    expect(err.error).toContain('rockbox');
  });

  it('reports path-not-found when --path does not exist', async () => {
    const ctx = makeContext({ device: 'myecho' });
    const { out, stdout, exitCode } = makeOut();
    await runAdd(ctx, { type: 'echo-mini', path: '/does/not/exist/ever' }, out);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<AddOutputError>();
    expect(err.error).toContain('Path not found');
    expect(err.error).toContain('/does/not/exist/ever');
  });

  it('reports path-is-not-a-directory when --path points to a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'device-add-file-'));
    const filePath = join(dir, 'not-a-dir.txt');
    await writeFile(filePath, 'hello');
    try {
      const ctx = makeContext({ device: 'myecho' });
      const { out, stdout, exitCode } = makeOut();
      await runAdd(ctx, { type: 'echo-mini', path: filePath }, out);
      expect(exitCode.get()).toBe(1);
      const err = stdout.json<AddOutputError>();
      expect(err.error).toContain('not a directory');
      expect(err.error).toContain(filePath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// Mass-storage: capability override validation
// =============================================================================

describe('runDeviceAdd: mass-storage capability overrides', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'device-add-mscaps-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('rejects --artwork-max-resolution when not a positive integer', async () => {
    const ctx = makeContext({ device: 'd' });
    const { out, stdout, exitCode } = makeOut();
    await runAdd(
      ctx,
      { type: 'echo-mini', path: dir, artworkMaxResolution: 'not-a-number' as never },
      out
    );
    expect(exitCode.get()).toBe(1);
    expect(stdout.json<AddOutputError>().error).toContain('artwork-max-resolution');
  });

  it('rejects --artwork-max-resolution outside the 1..10000 range', async () => {
    const ctx = makeContext({ device: 'd' });
    const { out, stdout, exitCode } = makeOut();
    await runAdd(
      ctx,
      { type: 'echo-mini', path: dir, artworkMaxResolution: '99999' as never },
      out
    );
    expect(exitCode.get()).toBe(1);
    expect(stdout.json<AddOutputError>().error).toContain('1 and 10000');
  });

  it('rejects an invalid --artwork-sources value', async () => {
    const ctx = makeContext({ device: 'd' });
    const { out, stdout, exitCode } = makeOut();
    await runAdd(ctx, { type: 'echo-mini', path: dir, artworkSources: ['bogus'] as never }, out);
    expect(exitCode.get()).toBe(1);
    expect(stdout.json<AddOutputError>().error).toContain('bogus');
    expect(stdout.json<AddOutputError>().error.toLowerCase()).toContain('artwork source');
  });

  it('rejects an invalid --supported-audio-codecs value', async () => {
    const ctx = makeContext({ device: 'd' });
    const { out, stdout, exitCode } = makeOut();
    await runAdd(
      ctx,
      { type: 'echo-mini', path: dir, supportedAudioCodecs: ['zzz'] as never },
      out
    );
    expect(exitCode.get()).toBe(1);
    expect(stdout.json<AddOutputError>().error).toContain('zzz');
    expect(stdout.json<AddOutputError>().error.toLowerCase()).toContain('audio codec');
  });
});

// =============================================================================
// iPod-flow: mass-storage-only options rejected, scan unsupported
// =============================================================================

describe('runDeviceAdd: iPod flow', () => {
  it('rejects mass-storage-only options on iPod type', async () => {
    const ctx = makeContext({ device: 'd' });
    const { out, stdout, exitCode } = makeOut();
    await runAdd(ctx, { type: 'ipod', musicDir: 'Music' }, out);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<AddOutputError>();
    expect(err.error).toContain('--music-dir');
    expect(err.error).toContain('mass-storage');
  });

  it('exits with "scanning not supported" on unsupported platforms (--type ipod, no --path)', async () => {
    const ctx = makeContext({ device: 'd' });
    const { out, stdout, exitCode } = makeOut();
    const deps: DeviceAddDeps = {
      getDeviceManager: () => fakeManager({ isSupported: false, platform: 'unsupported' }),
    };
    await runAdd(ctx, { type: 'ipod' }, out, deps);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<AddOutputError>();
    expect(err.error).toContain('Device scanning is not supported');
    expect(err.error).not.toContain('--path is required');
  });

  it('reports "Multiple iPod devices" when more than one iPod is found', async () => {
    const ctx = makeContext({ device: 'd' });
    const { out, stdout, exitCode } = makeOut();
    const deps: DeviceAddDeps = {
      getDeviceManager: () =>
        fakeManager({
          isSupported: true,
          findIpodDevices: async () => [
            {
              identifier: 'disk2s2',
              volumeName: 'iPodA',
              volumeUuid: 'uuid-a',
              storage: { sizeBytes: 0 },
              isMounted: true,
              mountPoint: '/Volumes/iPodA',
            } as Awaited<ReturnType<DeviceManager['findIpodDevices']>>[number],
            {
              identifier: 'disk3s2',
              volumeName: 'iPodB',
              volumeUuid: 'uuid-b',
              storage: { sizeBytes: 0 },
              isMounted: true,
              mountPoint: '/Volumes/iPodB',
            } as Awaited<ReturnType<DeviceManager['findIpodDevices']>>[number],
          ],
        }),
    };
    await runAdd(ctx, { type: 'ipod' }, out, deps);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<AddOutputError>();
    expect(err.error.toLowerCase()).toContain('multiple ipod');
  });

  it('reports "No iPod devices found" when scan returns empty', async () => {
    const ctx = makeContext({ device: 'd' });
    const { out, stdout, exitCode } = makeOut();
    const deps: DeviceAddDeps = {
      getDeviceManager: () => fakeManager({ isSupported: true }),
      // Stub core so discoverConnectedDevices returns no devices — the
      // iOS-unsupported detection path stays inert and the legacy
      // "no iPod found" path runs.
      loadCore: async () => {
        const real = await import('@podkit/core');
        return {
          ...real,
          discoverConnectedDevices: async () => [],
        } as typeof real;
      },
    };
    await runAdd(ctx, { type: 'ipod' }, out, deps);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<AddOutputError>();
    // The runner may also report a mass-storage hint here; either path is "not found".
    expect(err.error.toLowerCase()).toMatch(/no ipod|detected.*device/);
  });

  it('surfaces the canonical iOS unsupported message when an iPod touch is on USB but no disk (TASK-317.03)', async () => {
    const ctx = makeContext({ device: 'd' });
    const { out, stdout, exitCode } = makeOut();
    const deps: DeviceAddDeps = {
      getDeviceManager: () => fakeManager({ isSupported: true, findIpodDevices: async () => [] }),
      loadCore: async () => {
        const real = await import('@podkit/core');
        // Route discoverConnectedDevices through the real orchestrator
        // pieces, but with an injected USB walk so the iPod touch 5G
        // (PID 0x12a0) appears on the bus. This exercises the actual
        // classifier path that produces `usb.supported === false`.
        return {
          ...real,
          discoverConnectedDevices: (opts) =>
            real.discoverConnectedDevices({
              ...opts,
              enumerate: async () => [{ vendorId: '05ac', productId: '12a0' }] as never,
            }),
        } as typeof real;
      },
    };
    await runAdd(ctx, { type: 'ipod' }, out, deps);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<AddOutputError & { details?: { unsupported?: { kind?: string } } }>();
    expect(err.code).toBe('UNSUPPORTED_DEVICE');
    // Canonical message — never mentions libgpod (TASK-317.03 wording rule).
    expect(err.error.toLowerCase()).not.toContain('libgpod');
    expect(err.error.toLowerCase()).toContain('proprietary sync protocol');
    expect(err.details?.unsupported?.kind).toBe('ios-device');
  });
});

// =============================================================================
// HFS+ on Linux refusal (TASK-317.12)
// =============================================================================

describe('runDeviceAdd: HFS+ on Linux refusal (TASK-317.12)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'device-add-hfsplus-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  interface AddOutputErrorWithDetails extends AddOutputError {
    details?: { filesystem?: string; platform?: string; path?: string };
  }

  it('refuses with UNSUPPORTED_FILESYSTEM_ON_LINUX when --path points at HFS+ on Linux', async () => {
    const ctx = makeContext({ device: 'nano4g' });
    const { out, stdout, exitCode } = makeOut();
    const deps: DeviceAddDeps = {
      platform: 'linux',
      getDeviceManager: () =>
        fakeManager({
          isSupported: true,
          listDevices: async () => [
            {
              identifier: 'sdc2',
              volumeName: '',
              volumeUuid: '',
              storage: { sizeBytes: 8_000_000_000, filesystem: 'hfsplus' },
              isMounted: true,
              mountPoint: dir,
            },
          ],
        }),
    };

    await runAdd(ctx, { type: 'ipod', path: dir }, out, deps);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<AddOutputErrorWithDetails>();
    expect(err.code).toBe('UNSUPPORTED_FILESYSTEM_ON_LINUX');
    expect(err.error).toContain(
      'Cannot add iPod: this iPod is formatted as HFS+, which podkit does not support on Linux.'
    );
    expect(err.error).toContain('To use this iPod with podkit on Linux, reformat it to FAT32.');
    expect(err.error).toContain('https://jvgomg.github.io/podkit/devices/linux-filesystems');
    expect(err.error).toContain(
      '(podkit fully supports HFS+ iPods on macOS — this is a Linux-only limitation.)'
    );
    expect(err.details?.filesystem).toBe('hfsplus');
    expect(err.details?.platform).toBe('linux');
    expect(err.details?.path).toBe(dir);
  });

  it('refuses scan-found HFS+ iPod on Linux before any mount attempt', async () => {
    const ctx = makeContext({ device: 'nano4g' });
    const { out, stdout, exitCode } = makeOut();
    const deps: DeviceAddDeps = {
      platform: 'linux',
      getDeviceManager: () =>
        fakeManager({
          isSupported: true,
          findIpodDevices: async () => [
            {
              identifier: 'sdc2',
              volumeName: '',
              volumeUuid: '',
              storage: { sizeBytes: 8_000_000_000, filesystem: 'hfsplus' },
              isMounted: true,
              mountPoint: '/media/james/disk',
            } as Awaited<ReturnType<DeviceManager['findIpodDevices']>>[number],
          ],
          mount: async () => {
            throw new Error('mount() should not be called for HFS+ on Linux');
          },
        }),
      assessIdentity: async () => {
        throw new Error('assessIdentity() should not be called for HFS+ on Linux');
      },
    };

    await runAdd(ctx, { type: 'ipod' }, out, deps);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<AddOutputErrorWithDetails>();
    expect(err.code).toBe('UNSUPPORTED_FILESYSTEM_ON_LINUX');
    expect(err.details?.filesystem).toBe('hfsplus');
    expect(err.details?.path).toBe('/media/james/disk');
  });

  it('does NOT refuse HFS+ on macOS (refusal is Linux-only)', async () => {
    // The runner falls through to identity assessment + DB init. To avoid
    // those touching real disks/USB, stub assessIdentity + ipodDatabase.
    // The only assertion that matters here is that no
    // UNSUPPORTED_FILESYSTEM_ON_LINUX error is raised.
    const ctx = makeContext({ device: 'macipod', configPath: join(dir, 'config.toml') });
    const { out, stdout } = makeOut();

    const stubModel: IpodModel = {
      displayName: 'iPod 5G Video',
      generationId: 'video_5g',
      checksumType: 'none',
      source: 'usb',
    };
    const stubAssessment: IpodIdentityAssessment = {
      model: stubModel,
      capabilities: {
        artworkSources: ['database'],
        artworkMaxResolution: 320,
        supportedAudioCodecs: ['aac', 'mp3'],
        supportsVideo: true,
        audioNormalization: 'soundcheck',
        supportsAlbumArtistBrowsing: false,
      },
      needsChecksum: false,
      checksumType: 'none',
      firmwareInquiry: 'present',
      existing: null,
      usbFingerprint: null,
      sysInfoModelNumber: undefined,
    };
    const deps: DeviceAddDeps = {
      platform: 'darwin',
      getDeviceManager: () =>
        fakeManager({
          isSupported: true,
          listDevices: async () => [
            {
              identifier: 'disk6s2',
              volumeName: 'TERAPOD',
              volumeUuid: 'AAAA-BBBB',
              storage: { sizeBytes: 80_000_000_000, filesystem: 'hfsplus' },
              isMounted: true,
              mountPoint: dir,
            },
          ],
          findIpodDevices: async () => [],
        }),
      assessIdentity: async () => stubAssessment,
      ipodDatabase: {
        hasDatabase: async () => true,
        open: async () => ({ trackCount: 0, close: () => {} }),
        initializeIpod: async () => ({ close: () => {} }),
      },
    };

    await runAdd(ctx, { type: 'ipod', path: dir, yes: true }, out, deps);
    // No assertion on success/failure — only that the HFS+-on-Linux refusal
    // does NOT fire on macOS.
    const text = stdout.text();
    expect(text).not.toContain('UNSUPPORTED_FILESYSTEM_ON_LINUX');
    expect(text).not.toContain('podkit does not support on Linux');
  });

  it('does NOT refuse VFAT on Linux (only HFS+ is the policy)', async () => {
    const ctx = makeContext({ device: 'fatipod', configPath: join(dir, 'config.toml') });
    const { out, stdout, exitCode } = makeOut();

    const stubModel: IpodModel = {
      displayName: 'iPod nano (3rd Generation)',
      generationId: 'nano_3g',
      checksumType: 'none',
      source: 'usb',
    };
    const stubAssessment: IpodIdentityAssessment = {
      model: stubModel,
      capabilities: {
        artworkSources: ['database'],
        artworkMaxResolution: 176,
        supportedAudioCodecs: ['aac', 'mp3'],
        supportsVideo: true,
        audioNormalization: 'soundcheck',
        supportsAlbumArtistBrowsing: false,
      },
      needsChecksum: false,
      checksumType: 'none',
      firmwareInquiry: 'present',
      existing: null,
      usbFingerprint: null,
      sysInfoModelNumber: undefined,
    };
    const deps: DeviceAddDeps = {
      platform: 'linux',
      getDeviceManager: () =>
        fakeManager({
          isSupported: true,
          listDevices: async () => [
            {
              identifier: 'sdb2',
              volumeName: 'IPOD',
              volumeUuid: 'AAAA-BBBB',
              storage: { sizeBytes: 8_000_000_000, filesystem: 'vfat' },
              isMounted: true,
              mountPoint: dir,
            },
          ],
          // findIpodDevices is consulted for the volumeUuid lookup in the
          // --path branch; mirror the listDevices record so TASK-317.15
          // doesn't refuse on missing UUID.
          findIpodDevices: async () => [
            {
              identifier: 'sdb2',
              volumeName: 'IPOD',
              volumeUuid: 'AAAA-BBBB',
              storage: { sizeBytes: 8_000_000_000, filesystem: 'vfat' },
              isMounted: true,
              mountPoint: dir,
            } as Awaited<ReturnType<DeviceManager['findIpodDevices']>>[number],
          ],
        }),
      assessIdentity: async () => stubAssessment,
      ipodDatabase: {
        hasDatabase: async () => true,
        open: async () => ({ trackCount: 0, close: () => {} }),
        initializeIpod: async () => ({ close: () => {} }),
      },
    };

    await runAdd(ctx, { type: 'ipod', path: dir, yes: true }, out, deps);
    const text = stdout.text();
    expect(text).not.toContain('UNSUPPORTED_FILESYSTEM_ON_LINUX');
    expect(exitCode.get()).toBeUndefined();
  });
});

// =============================================================================
// Missing volumeUuid defensive refusal (TASK-317.15)
// =============================================================================

describe('runDeviceAdd: missing volumeUuid refusal (TASK-317.15)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'device-add-no-uuid-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  interface AddOutputErrorWithDetails extends AddOutputError {
    details?: { path?: string; identifier?: string; filesystem?: string | null };
  }

  const stubModel: IpodModel = {
    displayName: 'iPod nano (3rd Generation)',
    generationId: 'nano_3g',
    checksumType: 'none',
    source: 'usb',
  };
  const stubAssessment: IpodIdentityAssessment = {
    model: stubModel,
    capabilities: {
      artworkSources: ['database'],
      artworkMaxResolution: 176,
      supportedAudioCodecs: ['aac', 'mp3'],
      supportsVideo: true,
      audioNormalization: 'soundcheck',
      supportsAlbumArtistBrowsing: false,
    },
    needsChecksum: false,
    checksumType: 'none',
    firmwareInquiry: 'present',
    existing: null,
    usbFingerprint: null,
    sysInfoModelNumber: undefined,
  };

  it('refuses --path add with VOLUME_UUID_REQUIRED when the matching device has no volumeUuid', async () => {
    const ctx = makeContext({ device: 'mystery', configPath: join(dir, 'config.toml') });
    const { out, stdout, exitCode } = makeOut();
    const deps: DeviceAddDeps = {
      platform: 'linux',
      getDeviceManager: () =>
        fakeManager({
          isSupported: true,
          // Note: HFS+ is caught earlier by TASK-317.12. Use an unusual
          // filesystem (e.g. exfat) to exercise this catch-all branch.
          listDevices: async () => [
            {
              identifier: 'sdc2',
              volumeName: 'IPOD',
              volumeUuid: '',
              storage: { sizeBytes: 8_000_000_000, filesystem: 'exfat' },
              isMounted: true,
              mountPoint: dir,
            },
          ],
          findIpodDevices: async () => [
            {
              identifier: 'sdc2',
              volumeName: 'IPOD',
              volumeUuid: '',
              storage: { sizeBytes: 8_000_000_000, filesystem: 'exfat' },
              isMounted: true,
              mountPoint: dir,
            } as Awaited<ReturnType<DeviceManager['findIpodDevices']>>[number],
          ],
        }),
      assessIdentity: async () => stubAssessment,
      ipodDatabase: {
        hasDatabase: async () => true,
        open: async () => ({ trackCount: 0, close: () => {} }),
        initializeIpod: async () => ({ close: () => {} }),
      },
    };

    await runAdd(ctx, { type: 'ipod', path: dir, yes: true }, out, deps);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<AddOutputErrorWithDetails>();
    expect(err.code).toBe('VOLUME_UUID_REQUIRED');
    expect(err.error).toContain('does not have a readable filesystem UUID');
    expect(err.error).toContain('podkit identifies iPods by volume UUID');
    expect(err.error).toContain('https://jvgomg.github.io/podkit/devices/troubleshooting');
    expect(err.details?.path).toBe(dir);
    expect(err.details?.identifier).toBe('sdc2');
    expect(err.details?.filesystem).toBe('exfat');
  });

  it('refuses scan-found add with VOLUME_UUID_REQUIRED when the iPod has no volumeUuid', async () => {
    const ctx = makeContext({ device: 'mystery', configPath: join(dir, 'config.toml') });
    const { out, stdout, exitCode } = makeOut();
    const deps: DeviceAddDeps = {
      platform: 'linux',
      getDeviceManager: () =>
        fakeManager({
          isSupported: true,
          findIpodDevices: async () => [
            {
              identifier: 'sdc2',
              volumeName: 'IPOD',
              // Empty UUID — simulates lsblk not surfacing one (corrupt
              // FAT32 table, unusual layout, mass-storage with no FS UUID).
              volumeUuid: '',
              storage: { sizeBytes: 8_000_000_000, filesystem: 'vfat' },
              isMounted: true,
              mountPoint: '/media/james/IPOD',
            } as Awaited<ReturnType<DeviceManager['findIpodDevices']>>[number],
          ],
          mount: async () => {
            throw new Error('mount() should not be called when volumeUuid is missing');
          },
        }),
      assessIdentity: async () => {
        throw new Error('assessIdentity() should not be called when volumeUuid is missing');
      },
    };

    await runAdd(ctx, { type: 'ipod', yes: true }, out, deps);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<AddOutputErrorWithDetails>();
    expect(err.code).toBe('VOLUME_UUID_REQUIRED');
    expect(err.error).toContain('does not have a readable filesystem UUID');
    expect(err.error).toContain('https://jvgomg.github.io/podkit/devices/troubleshooting');
    expect(err.details?.path).toBe('/media/james/IPOD');
    expect(err.details?.identifier).toBe('sdc2');
    expect(err.details?.filesystem).toBe('vfat');
  });

  it('refuses legacy synthetic `manual-...` UUIDs (defence-in-depth)', async () => {
    // Even if a stale device record carrying a `manual-` synthetic UUID
    // somehow reaches this branch (e.g. a buggy probe), refuse rather
    // than persisting it.
    const ctx = makeContext({ device: 'mystery', configPath: join(dir, 'config.toml') });
    const { out, stdout, exitCode } = makeOut();
    const deps: DeviceAddDeps = {
      platform: 'linux',
      getDeviceManager: () =>
        fakeManager({
          isSupported: true,
          findIpodDevices: async () => [
            {
              identifier: 'sdc2',
              volumeName: 'IPOD',
              volumeUuid: 'manual-L21lZGlhL2phbWVz',
              storage: { sizeBytes: 8_000_000_000, filesystem: 'vfat' },
              isMounted: true,
              mountPoint: '/media/james/IPOD',
            } as Awaited<ReturnType<DeviceManager['findIpodDevices']>>[number],
          ],
        }),
    };

    await runAdd(ctx, { type: 'ipod', yes: true }, out, deps);
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<AddOutputErrorWithDetails>();
    expect(err.code).toBe('VOLUME_UUID_REQUIRED');
  });

  it('adds successfully when a real volumeUuid is present (regression)', async () => {
    const ctx = makeContext({ device: 'nano3g', configPath: join(dir, 'config.toml') });
    const { out, stdout, exitCode } = makeOut();
    const deps: DeviceAddDeps = {
      platform: 'linux',
      getDeviceManager: () =>
        fakeManager({
          isSupported: true,
          findIpodDevices: async () => [
            {
              identifier: 'sdc2',
              volumeName: 'IPOD',
              volumeUuid: '968A-2063',
              storage: { sizeBytes: 8_000_000_000, filesystem: 'vfat' },
              isMounted: true,
              mountPoint: '/media/james/IPOD',
            } as Awaited<ReturnType<DeviceManager['findIpodDevices']>>[number],
          ],
        }),
      assessIdentity: async () => stubAssessment,
      ipodDatabase: {
        hasDatabase: async () => true,
        open: async () => ({ trackCount: 11, close: () => {} }),
        initializeIpod: async () => ({ close: () => {} }),
      },
    };

    await runAdd(ctx, { type: 'ipod', yes: true }, out, deps);
    expect(exitCode.get()).toBeUndefined();
    const result = stdout.json<AddOutputSuccess>();
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// AC #1 + #5: enumeration with mocked USB walk (verbatim from prior file)
// =============================================================================

describe('enumerateConnectedDevices with real providers and mocked USB walk (AC #1, #5)', () => {
  const echoMiniDiscovered: EnumeratedUsbDevice = {
    vendorId: '0x071b',
    productId: '0x3203',
    serialNumber: 'EM-SERIAL-001',
  };

  it('detects Echo Mini via VID/PID 0x071b/0x3203 using built-in presets', async () => {
    const massStorageProvider = createMassStorageProvider(BUILT_IN_PRESETS);

    const result = await enumerateConnectedDevices({
      providers: [massStorageProvider],
      walk: () => Promise.resolve([echoMiniDiscovered]),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.matchedProviderId).toBe('mass-storage');
    expect(result[0]!.identity?.kind).toBe('mass-storage');
    if (result[0]!.identity?.kind === 'mass-storage') {
      expect(result[0]!.identity.presetId).toBe('echo-mini');
    }
  });

  it('reports no identity for an unrecognised VID/PID with mass-storage provider only', async () => {
    const massStorageProvider = createMassStorageProvider(BUILT_IN_PRESETS);
    const unknownDevice: EnumeratedUsbDevice = {
      vendorId: '0xdead',
      productId: '0xbeef',
    };

    const result = await enumerateConnectedDevices({
      providers: [massStorageProvider],
      walk: () => Promise.resolve([unknownDevice]),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.matchedProviderId).toBeUndefined();
    expect(result[0]!.identity).toBeUndefined();
  });

  it('returns Echo Mini presetId in identity when serialNumber is present', async () => {
    const massStorageProvider = createMassStorageProvider(BUILT_IN_PRESETS);

    const result = await enumerateConnectedDevices({
      providers: [massStorageProvider],
      walk: () =>
        Promise.resolve([
          {
            vendorId: '0x071b',
            productId: '0x3203',
            serialNumber: 'MY-ECHO-123',
          } as EnumeratedUsbDevice,
        ]),
    });

    expect(result).toHaveLength(1);
    const identity = result[0]!.identity;
    expect(identity?.kind).toBe('mass-storage');
    if (identity?.kind === 'mass-storage') {
      expect(identity.presetId).toBe('echo-mini');
      expect(identity.serialNumber).toBe('MY-ECHO-123');
    }
  });
});

// =============================================================================
// runDeviceAdd: cascade-resolved identity + single combined prompt (nano 2G case)
// =============================================================================

const NANO_2G_USB: CompleteUsbDevice = {
  vendorId: '05ac',
  productId: '1260',
  serialNumber: 'YM7275YSVQH',
  bus: 20,
  devnum: 5,
};

const NANO_2G_MODEL: IpodModel = {
  displayName: 'iPod nano (2nd Generation)',
  generationId: 'nano_2g',
  checksumType: 'none',
  source: 'usb',
};

const NANO_2G_CAPS: DeviceCapabilities = {
  artworkSources: ['database'],
  artworkMaxResolution: 176,
  supportedAudioCodecs: ['aac', 'mp3'],
  supportsVideo: false,
  audioNormalization: 'soundcheck',
  supportsAlbumArtistBrowsing: false,
};

function makeNano2GAssessment(
  opts: {
    firmwareInquiry?: 'present' | 'missing' | 'unwritable';
  } = {}
): IpodIdentityAssessment {
  return {
    model: NANO_2G_MODEL,
    capabilities: NANO_2G_CAPS,
    needsChecksum: false,
    checksumType: 'none',
    firmwareInquiry: opts.firmwareInquiry ?? 'missing',
    existing: null,
    usbFingerprint: opts.firmwareInquiry === 'unwritable' ? null : NANO_2G_USB,
    sysInfoModelNumber: undefined,
  };
}

const FAKE_IPOD_DB: NonNullable<DeviceAddDeps['ipodDatabase']> = {
  hasDatabase: async () => true,
  open: async () => ({ trackCount: 63, close: () => {} }),
  initializeIpod: async () => ({ close: () => {} }),
};

interface AddOutputSuccess {
  success: true;
  device: { name: string; modelName: string; trackCount: number };
  saved: boolean;
  initialized?: boolean;
  isDefault: boolean;
}

describe('runDeviceAdd: nano 2G slick-flow (cascade + combined prompt)', () => {
  let tempDir: string;
  let tempConfig: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'device-add-slick-'));
    tempConfig = join(tempDir, 'config.toml');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('cascade-resolves nano 2G via USB and offers a single combined prompt', async () => {
    const ctx = makeContext({ device: 'nano2g', json: true, configPath: tempConfig });
    const { out, stdout, exitCode } = makeOut(true);

    let writeCalled = false;
    const deps: DeviceAddDeps = {
      getDeviceManager: () =>
        fakeManager({
          isSupported: true,
          findIpodDevices: async () => [
            {
              identifier: 'disk6s2',
              volumeName: 'PARTY IPOD',
              volumeUuid: 'NANO-2G-UUID',
              storage: { sizeBytes: 4_000_000_000 },
              isMounted: true,
              mountPoint: '/Volumes/PARTY IPOD',
            } as Awaited<ReturnType<DeviceManager['findIpodDevices']>>[number],
          ],
        }),
      assessIdentity: async () => makeNano2GAssessment({ firmwareInquiry: 'missing' }),
      ensureSysInfoExtended: async () => {
        writeCalled = true;
        return {
          present: true,
          source: 'usb-read',
          identity: {
            firewireGuid: '000A27001A0647CB',
            serialNumber: 'YM7275YSVQH',
          },
          firewireGuid: '000A27001A0647CB',
          serialNumber: 'YM7275YSVQH',
        } as SysInfoExtendedResult;
      },
      ipodDatabase: FAKE_IPOD_DB,
    };

    // --yes triggers the slick path automatically (write SysInfoExtended + save).
    await runAdd(ctx, { type: 'ipod', yes: true }, out, deps);

    expect(exitCode.get()).toBeUndefined();
    const result = stdout.json<AddOutputSuccess>();
    expect(result.success).toBe(true);
    // Cascade-resolved display name (not libgpod's "Invalid").
    expect(result.device.modelName).toContain('nano (2nd Generation)');
    expect(result.device.trackCount).toBe(63);
    // SysInfoExtended write fired in --yes mode.
    expect(writeCalled).toBe(true);
  });

  it('writes SysInfoExtended under --yes (default slick-path behaviour)', async () => {
    const ctx = makeContext({ device: 'nano2g', json: true, configPath: tempConfig });
    const { out } = makeOut(true);

    let writeCalled = false;
    const deps: DeviceAddDeps = {
      getDeviceManager: () =>
        fakeManager({
          isSupported: true,
          findIpodDevices: async () => [
            {
              identifier: 'disk6s2',
              volumeName: 'PARTY IPOD',
              volumeUuid: 'NANO-2G-UUID',
              storage: { sizeBytes: 4_000_000_000 },
              isMounted: true,
              mountPoint: '/Volumes/PARTY IPOD',
            } as Awaited<ReturnType<DeviceManager['findIpodDevices']>>[number],
          ],
        }),
      assessIdentity: async () => makeNano2GAssessment({ firmwareInquiry: 'missing' }),
      ensureSysInfoExtended: async () => {
        writeCalled = true;
        return {
          present: true,
          source: 'usb-read',
          identity: {
            firewireGuid: '000A27001A0647CB',
            serialNumber: 'YM7275YSVQH',
          },
        } as SysInfoExtendedResult;
      },
      ipodDatabase: FAKE_IPOD_DB,
    };

    await runAdd(ctx, { type: 'ipod', yes: true }, out, deps);
    expect(writeCalled).toBe(true);
  });

  it('skips SysInfoExtended write under --no-firmware-inquiry', async () => {
    const ctx = makeContext({ device: 'nano2g', json: true, configPath: tempConfig });
    const { out, stdout } = makeOut(true);

    let writeCalled = false;
    const deps: DeviceAddDeps = {
      getDeviceManager: () =>
        fakeManager({
          isSupported: true,
          findIpodDevices: async () => [
            {
              identifier: 'disk6s2',
              volumeName: 'PARTY IPOD',
              volumeUuid: 'NANO-2G-UUID',
              storage: { sizeBytes: 4_000_000_000 },
              isMounted: true,
              mountPoint: '/Volumes/PARTY IPOD',
            } as Awaited<ReturnType<DeviceManager['findIpodDevices']>>[number],
          ],
        }),
      assessIdentity: async () => makeNano2GAssessment({ firmwareInquiry: 'missing' }),
      ensureSysInfoExtended: async () => {
        writeCalled = true;
        return { present: false, source: 'unavailable', identity: {} } as SysInfoExtendedResult;
      },
      ipodDatabase: FAKE_IPOD_DB,
    };

    await runAdd(
      ctx,
      // commander's `--no-firmware-inquiry` parses to `firmwareInquiry: false`.
      { type: 'ipod', yes: true, firmwareInquiry: false },
      out,
      deps
    );
    expect(writeCalled).toBe(false);
    const result = stdout.json<AddOutputSuccess>();
    expect(result.success).toBe(true);
    // Identity still cascade-resolved even without firmware write.
    expect(result.device.modelName).toContain('nano (2nd Generation)');
  });

  it('--path branch: cascade-resolves identity and writes SysInfoExtended', async () => {
    const mountDir = await mkdtemp(join(tmpdir(), 'nano2g-mount-'));
    try {
      const ctx = makeContext({ device: 'nano2gpath', json: true, configPath: tempConfig });
      const { out, stdout, exitCode } = makeOut(true);

      let writeCalled = false;
      const deps: DeviceAddDeps = {
        // Path branch consults manager for volumeUuid lookup; supply a real
        // matching record so TASK-317.15's defensive refusal doesn't fire.
        getDeviceManager: () =>
          fakeManager({
            isSupported: true,
            findIpodDevices: async () => [
              {
                identifier: 'disk6s2',
                volumeName: 'PARTY IPOD',
                volumeUuid: 'NANO-2G-UUID',
                storage: { sizeBytes: 4_000_000_000, filesystem: 'vfat' },
                isMounted: true,
                mountPoint: mountDir,
              } as Awaited<ReturnType<DeviceManager['findIpodDevices']>>[number],
            ],
          }),
        assessIdentity: async () => makeNano2GAssessment({ firmwareInquiry: 'missing' }),
        ensureSysInfoExtended: async () => {
          writeCalled = true;
          return {
            present: true,
            source: 'usb-read',
            identity: {
              firewireGuid: '000A27001A0647CB',
              serialNumber: 'YM7275YSVQH',
            },
          } as SysInfoExtendedResult;
        },
        ipodDatabase: FAKE_IPOD_DB,
      };

      await runAdd(ctx, { type: 'ipod', yes: true, path: mountDir }, out, deps);

      expect(exitCode.get()).toBeUndefined();
      const result = stdout.json<AddOutputSuccess>();
      expect(result.success).toBe(true);
      expect(result.device.modelName).toContain('nano (2nd Generation)');
      expect(writeCalled).toBe(true);
    } finally {
      await rm(mountDir, { recursive: true, force: true });
    }
  });

  it('cancels add when user declines the warn-allow prompt on an unsupported generation (TASK-317.03)', async () => {
    // Per TASK-317.03 the runner now warns + prompts instead of hard-refusing.
    // No --yes here; supply confirm that returns false → cancellation.
    const ctx = makeContext({ device: 'touchcancel', json: true, configPath: tempConfig });
    const { out, exitCode } = makeOut(true);

    const unsupportedAssessment: IpodIdentityAssessment = {
      model: {
        displayName: 'iPod touch (1st Generation)',
        generationId: 'touch_1g',
        checksumType: 'none',
        source: 'usb',
        unsupportedReason: {
          kind: 'ios-device',
          headline: 'iPod touch (1st generation) uses Apple’s proprietary sync protocol.',
          docsUrl: 'https://jvgomg.github.io/podkit/devices/supported-devices',
        },
      },
      capabilities: null,
      needsChecksum: false,
      checksumType: 'none',
      firmwareInquiry: 'missing',
      existing: null,
      usbFingerprint: NANO_2G_USB,
      sysInfoModelNumber: undefined,
    };

    const deps: DeviceAddDeps = {
      confirm: async () => false,
      getDeviceManager: () =>
        fakeManager({
          isSupported: true,
          findIpodDevices: async () => [
            {
              identifier: 'disk1s2',
              volumeName: 'TOUCH',
              volumeUuid: 'TOUCH-UUID',
              storage: { sizeBytes: 0 },
              isMounted: true,
              mountPoint: '/Volumes/TOUCH',
            } as Awaited<ReturnType<DeviceManager['findIpodDevices']>>[number],
          ],
        }),
      assessIdentity: async () => unsupportedAssessment,
      ipodDatabase: FAKE_IPOD_DB,
    };

    await runAdd(ctx, { type: 'ipod' }, out, deps);
    // Cancellation is not an error — exit code stays unset (0).
    expect(exitCode.get()).toBeUndefined();
  });

  it('persists unsupported rich shape when the user accepts the warn-allow prompt (TASK-317.03)', async () => {
    const ctx = makeContext({ device: 'touchok', json: true, configPath: tempConfig });
    const { out, stdout, exitCode } = makeOut(true);

    const unsupportedAssessment: IpodIdentityAssessment = {
      model: {
        displayName: 'iPod touch (1st Generation)',
        generationId: 'touch_1g',
        checksumType: 'none',
        source: 'usb',
        unsupportedReason: {
          kind: 'ios-device',
          headline: 'iPod touch (1st generation) is unsupported.',
          docsUrl: 'https://jvgomg.github.io/podkit/devices/supported-devices',
        },
      },
      capabilities: null,
      needsChecksum: false,
      checksumType: 'none',
      firmwareInquiry: 'missing',
      existing: null,
      usbFingerprint: NANO_2G_USB,
      sysInfoModelNumber: undefined,
    };

    const deps: DeviceAddDeps = {
      // --yes flips the default to accept; no confirm prompt fires.
      getDeviceManager: () =>
        fakeManager({
          isSupported: true,
          findIpodDevices: async () => [
            {
              identifier: 'disk1s2',
              volumeName: 'TOUCH',
              volumeUuid: 'TOUCH-UUID',
              storage: { sizeBytes: 0 },
              isMounted: true,
              mountPoint: '/Volumes/TOUCH',
            } as Awaited<ReturnType<DeviceManager['findIpodDevices']>>[number],
          ],
        }),
      assessIdentity: async () => unsupportedAssessment,
      ipodDatabase: FAKE_IPOD_DB,
    };

    await runAdd(ctx, { type: 'ipod', yes: true }, out, deps);
    expect(exitCode.get()).toBeUndefined();
    const result = stdout.json<AddOutputSuccess>();
    expect(result.success).toBe(true);

    // Re-load the config to assert the rich unsupported shape landed.
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(tempConfig, 'utf-8');
    // Must be a TOML inline table, not a bare boolean.
    expect(text).toContain('unsupported = {');
    expect(text).toContain('kind = "ios-device"');
    expect(text).toMatch(/confirmedAt = "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z"/);
    // Confirm the kind comes from the assessment (ios-device, not the fallback).
    expect(text).not.toContain('unsupported = true');
  });

  it('loadConfigFile round-trips the unsupported rich shape written by addDevice', async () => {
    const { addDevice, loadConfigFile } = await import('../config/index.js');
    const isoDate = '2026-01-15T10:00:00.000Z';
    const deviceName = 'toucheck';

    addDevice(
      deviceName,
      { type: 'ipod', unsupported: { kind: 'unsupported-preset', confirmedAt: isoDate } },
      { configPath: tempConfig, createIfMissing: true }
    );

    const parsed = loadConfigFile(tempConfig);
    const dev = parsed?.devices?.[deviceName];
    expect(typeof dev?.unsupported).toBe('object');
    const u = dev?.unsupported as { kind?: string; confirmedAt?: string };
    expect(u.kind).toBe('unsupported-preset');
    expect(u.confirmedAt).toBe(isoDate);
  });
});
