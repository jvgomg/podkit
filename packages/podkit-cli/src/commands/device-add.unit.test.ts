/**
 * Unit tests for the `device add` runner.
 *
 * Exercises argv-validation branches and short-circuit error paths in
 * `runDeviceAdd` directly — no CLI subprocess. Each test scopes its own
 * CliContext via `runWithContext` and captures output via BufferSink.
 *
 * For built-binary smoke coverage (the wired-up `podkit device add`
 * command end-to-end), see packages/e2e-tests/src/commands/device.e2e.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMassStorageProvider, BUILT_IN_PRESETS } from '@podkit/devices-mass-storage';
import { enumerateConnectedDevices } from '@podkit/core';
import type { UsbDiscoveredDevice, DeviceManager } from '@podkit/core';
import { runDeviceAdd, type DeviceAddDeps } from './device.js';
import { OutputContext } from '../output/index.js';
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

function makeOut(json = true): { out: OutputContext; stdout: BufferSink; stderr: BufferSink } {
  const stdout = new BufferSink();
  const stderr = new BufferSink();
  const out = new OutputContext({
    mode: json ? 'json' : 'text',
    quiet: false,
    verbose: 0,
    color: false,
    tips: false,
    tty: false,
    stdout,
    stderr,
  });
  return { out, stdout, stderr };
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
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = 0;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it('rejects when --device is missing', async () => {
    const ctx = makeContext({ device: undefined });
    const { out, stdout } = makeOut();
    await runAdd(ctx, {}, out);
    expect(process.exitCode).toBe(1);
    const err = stdout.json<AddOutputError>();
    expect(err.success).toBe(false);
    expect(err.error).toContain('--device');
  });

  it('rejects an invalid device name (must start with a letter)', async () => {
    const ctx = makeContext({ device: '1bad' });
    const { out, stdout } = makeOut();
    await runAdd(ctx, { type: 'echo-mini' }, out);
    expect(process.exitCode).toBe(1);
    const err = stdout.json<AddOutputError>();
    expect(err.error.toLowerCase()).toContain('invalid device name');
  });

  it('rejects a duplicate device name', async () => {
    const ctx = makeContext({
      device: 'foo',
      devices: { foo: { volumeUuid: 'x', volumeName: 'foo' } },
    });
    const { out, stdout } = makeOut();
    await runAdd(ctx, { type: 'echo-mini' }, out);
    expect(process.exitCode).toBe(1);
    const err = stdout.json<AddOutputError>();
    expect(err.error).toContain('"foo"');
    expect(err.error.toLowerCase()).toContain('already exists');
  });
});

// =============================================================================
// Validation: quality / encoding presets
// =============================================================================

describe('runDeviceAdd: quality + encoding option validation', () => {
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = 0;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it('rejects an unknown --quality preset', async () => {
    const ctx = makeContext({ device: 'd' });
    const { out, stdout } = makeOut();
    await runAdd(ctx, { type: 'echo-mini', quality: 'bogus' as never }, out);
    expect(process.exitCode).toBe(1);
    expect(stdout.json<AddOutputError>().error).toContain('quality preset');
  });

  it('rejects an unknown --audio-quality preset', async () => {
    const ctx = makeContext({ device: 'd' });
    const { out, stdout } = makeOut();
    await runAdd(ctx, { type: 'echo-mini', audioQuality: 'bogus' as never }, out);
    expect(process.exitCode).toBe(1);
    expect(stdout.json<AddOutputError>().error).toContain('audio quality preset');
  });

  it('rejects an unknown --video-quality preset', async () => {
    const ctx = makeContext({ device: 'd' });
    const { out, stdout } = makeOut();
    await runAdd(ctx, { type: 'echo-mini', videoQuality: 'bogus' as never }, out);
    expect(process.exitCode).toBe(1);
    expect(stdout.json<AddOutputError>().error).toContain('video quality preset');
  });

  it('rejects an unknown --encoding mode', async () => {
    const ctx = makeContext({ device: 'd' });
    const { out, stdout } = makeOut();
    await runAdd(ctx, { type: 'echo-mini', encoding: 'lossy' as never }, out);
    expect(process.exitCode).toBe(1);
    expect(stdout.json<AddOutputError>().error).toContain('encoding mode');
  });
});

// =============================================================================
// Mass-storage: --path required, path-not-found, path-not-directory
// =============================================================================

describe('runDeviceAdd: mass-storage --path validation', () => {
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = 0;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it('requires --path when --type echo-mini is given', async () => {
    const ctx = makeContext({ device: 'myecho' });
    const { out, stdout } = makeOut();
    await runAdd(ctx, { type: 'echo-mini' }, out);
    expect(process.exitCode).toBe(1);
    const err = stdout.json<AddOutputError>();
    expect(err.error).toContain('--path is required');
    expect(err.error).toContain('echo-mini');
  });

  it('requires --path when --type rockbox is given', async () => {
    const ctx = makeContext({ device: 'myrock' });
    const { out, stdout } = makeOut();
    await runAdd(ctx, { type: 'rockbox' }, out);
    expect(process.exitCode).toBe(1);
    const err = stdout.json<AddOutputError>();
    expect(err.error).toContain('--path is required');
    expect(err.error).toContain('rockbox');
  });

  it('reports path-not-found when --path does not exist', async () => {
    const ctx = makeContext({ device: 'myecho' });
    const { out, stdout } = makeOut();
    await runAdd(ctx, { type: 'echo-mini', path: '/does/not/exist/ever' }, out);
    expect(process.exitCode).toBe(1);
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
      const { out, stdout } = makeOut();
      await runAdd(ctx, { type: 'echo-mini', path: filePath }, out);
      expect(process.exitCode).toBe(1);
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
  let originalExitCode: typeof process.exitCode;

  beforeEach(async () => {
    originalExitCode = process.exitCode;
    process.exitCode = 0;
    dir = await mkdtemp(join(tmpdir(), 'device-add-mscaps-'));
  });

  afterEach(async () => {
    process.exitCode = originalExitCode;
    await rm(dir, { recursive: true, force: true });
  });

  it('rejects --artwork-max-resolution when not a positive integer', async () => {
    const ctx = makeContext({ device: 'd' });
    const { out, stdout } = makeOut();
    await runAdd(
      ctx,
      { type: 'echo-mini', path: dir, artworkMaxResolution: 'not-a-number' as never },
      out
    );
    expect(process.exitCode).toBe(1);
    expect(stdout.json<AddOutputError>().error).toContain('artwork-max-resolution');
  });

  it('rejects --artwork-max-resolution outside the 1..10000 range', async () => {
    const ctx = makeContext({ device: 'd' });
    const { out, stdout } = makeOut();
    await runAdd(
      ctx,
      { type: 'echo-mini', path: dir, artworkMaxResolution: '99999' as never },
      out
    );
    expect(process.exitCode).toBe(1);
    expect(stdout.json<AddOutputError>().error).toContain('1 and 10000');
  });

  it('rejects an invalid --artwork-sources value', async () => {
    const ctx = makeContext({ device: 'd' });
    const { out, stdout } = makeOut();
    await runAdd(ctx, { type: 'echo-mini', path: dir, artworkSources: ['bogus'] as never }, out);
    expect(process.exitCode).toBe(1);
    expect(stdout.json<AddOutputError>().error).toContain('bogus');
    expect(stdout.json<AddOutputError>().error.toLowerCase()).toContain('artwork source');
  });

  it('rejects an invalid --supported-audio-codecs value', async () => {
    const ctx = makeContext({ device: 'd' });
    const { out, stdout } = makeOut();
    await runAdd(
      ctx,
      { type: 'echo-mini', path: dir, supportedAudioCodecs: ['zzz'] as never },
      out
    );
    expect(process.exitCode).toBe(1);
    expect(stdout.json<AddOutputError>().error).toContain('zzz');
    expect(stdout.json<AddOutputError>().error.toLowerCase()).toContain('audio codec');
  });
});

// =============================================================================
// iPod-flow: mass-storage-only options rejected, scan unsupported
// =============================================================================

describe('runDeviceAdd: iPod flow', () => {
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = 0;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it('rejects mass-storage-only options on iPod type', async () => {
    const ctx = makeContext({ device: 'd' });
    const { out, stdout } = makeOut();
    await runAdd(ctx, { type: 'ipod', musicDir: 'Music' }, out);
    expect(process.exitCode).toBe(1);
    const err = stdout.json<AddOutputError>();
    expect(err.error).toContain('--music-dir');
    expect(err.error).toContain('mass-storage');
  });

  it('exits with "scanning not supported" on unsupported platforms (--type ipod, no --path)', async () => {
    const ctx = makeContext({ device: 'd' });
    const { out, stdout } = makeOut();
    const deps: DeviceAddDeps = {
      getDeviceManager: () => fakeManager({ isSupported: false, platform: 'unsupported' }),
    };
    await runAdd(ctx, { type: 'ipod' }, out, deps);
    expect(process.exitCode).toBe(1);
    const err = stdout.json<AddOutputError>();
    expect(err.error).toContain('Device scanning is not supported');
    expect(err.error).not.toContain('--path is required');
  });

  it('reports "Multiple iPod devices" when more than one iPod is found', async () => {
    const ctx = makeContext({ device: 'd' });
    const { out, stdout } = makeOut();
    const deps: DeviceAddDeps = {
      getDeviceManager: () =>
        fakeManager({
          isSupported: true,
          findIpodDevices: async () => [
            {
              identifier: 'disk2s2',
              volumeName: 'iPodA',
              volumeUuid: 'uuid-a',
              size: 0,
              isMounted: true,
              mountPoint: '/Volumes/iPodA',
            } as Awaited<ReturnType<DeviceManager['findIpodDevices']>>[number],
            {
              identifier: 'disk3s2',
              volumeName: 'iPodB',
              volumeUuid: 'uuid-b',
              size: 0,
              isMounted: true,
              mountPoint: '/Volumes/iPodB',
            } as Awaited<ReturnType<DeviceManager['findIpodDevices']>>[number],
          ],
        }),
    };
    await runAdd(ctx, { type: 'ipod' }, out, deps);
    expect(process.exitCode).toBe(1);
    const err = stdout.json<AddOutputError>();
    expect(err.error.toLowerCase()).toContain('multiple ipod');
  });

  it('reports "No iPod devices found" when scan returns empty', async () => {
    const ctx = makeContext({ device: 'd' });
    const { out, stdout } = makeOut();
    const deps: DeviceAddDeps = {
      getDeviceManager: () => fakeManager({ isSupported: true }),
    };
    await runAdd(ctx, { type: 'ipod' }, out, deps);
    expect(process.exitCode).toBe(1);
    const err = stdout.json<AddOutputError>();
    // The runner may also report a mass-storage hint here; either path is "not found".
    expect(err.error.toLowerCase()).toMatch(/no ipod|detected.*device/);
  });
});

// =============================================================================
// AC #1 + #5: enumeration with mocked USB walk (verbatim from prior file)
// =============================================================================

describe('enumerateConnectedDevices with real providers and mocked USB walk (AC #1, #5)', () => {
  const echoMiniDiscovered: UsbDiscoveredDevice = {
    usb: { vendorId: '0x071b', productId: '0x3203', serialNumber: 'EM-SERIAL-001' },
    supported: true,
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
    const unknownDevice: UsbDiscoveredDevice = {
      usb: { vendorId: '0xdead', productId: '0xbeef' },
      supported: true,
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
            usb: { vendorId: '0x071b', productId: '0x3203', serialNumber: 'MY-ECHO-123' },
            supported: true,
          } as UsbDiscoveredDevice,
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
  let originalExitCode: typeof process.exitCode;
  let tempDir: string;
  let tempConfig: string;

  beforeEach(async () => {
    originalExitCode = process.exitCode;
    process.exitCode = 0;
    tempDir = await mkdtemp(join(tmpdir(), 'device-add-slick-'));
    tempConfig = join(tempDir, 'config.toml');
  });

  afterEach(async () => {
    process.exitCode = originalExitCode;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('cascade-resolves nano 2G via USB and offers a single combined prompt', async () => {
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
              size: 4_000_000_000,
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

    expect(process.exitCode).toBe(0);
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
              size: 4_000_000_000,
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
              size: 4_000_000_000,
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
      const { out, stdout } = makeOut(true);

      let writeCalled = false;
      const deps: DeviceAddDeps = {
        // Path branch only consults manager for volumeUuid lookup; isSupported=true triggers it.
        getDeviceManager: () =>
          fakeManager({
            isSupported: true,
            findIpodDevices: async () => [],
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

      expect(process.exitCode).toBe(0);
      const result = stdout.json<AddOutputSuccess>();
      expect(result.success).toBe(true);
      expect(result.device.modelName).toContain('nano (2nd Generation)');
      expect(writeCalled).toBe(true);
    } finally {
      await rm(mountDir, { recursive: true, force: true });
    }
  });

  it('blocks add when cascade reveals an unsupported generation', async () => {
    const ctx = makeContext({ device: 'd', json: true, configPath: tempConfig });
    const { out, stdout } = makeOut(true);

    const unsupportedAssessment: IpodIdentityAssessment = {
      model: {
        displayName: 'iPod touch (1st Generation)',
        generationId: 'touch_1g',
        checksumType: 'none',
        source: 'usb',
        notSupportedReason:
          'iPod touch (1st Generation) is not supported by podkit (libgpod cannot sync this generation).',
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
      getDeviceManager: () =>
        fakeManager({
          isSupported: true,
          findIpodDevices: async () => [
            {
              identifier: 'disk1s2',
              volumeName: 'TOUCH',
              volumeUuid: 'TOUCH-UUID',
              size: 0,
              isMounted: true,
              mountPoint: '/Volumes/TOUCH',
            } as Awaited<ReturnType<DeviceManager['findIpodDevices']>>[number],
          ],
        }),
      assessIdentity: async () => unsupportedAssessment,
      ipodDatabase: FAKE_IPOD_DB,
    };

    await runAdd(ctx, { type: 'ipod', yes: true }, out, deps);
    expect(process.exitCode).toBe(1);
    const err = stdout.json<AddOutputError>();
    expect(err.code).toBe('UNSUPPORTED_DEVICE');
    expect(err.error).toContain('not supported');
  });
});
