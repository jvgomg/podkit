/**
 * Unit tests for the `device archive` runner + command surface.
 *
 * The runner is a thin shell over `@podkit/ipod-archive`'s `runArchive` (the
 * bare both-stages default), `runDump` (`--dump-only`), and `runTransform`
 * (`--from-dump`) — all injected here so the tests exercise the CLI wiring
 * (device resolution, the iPod-only gate, the device-free `--from-dump`
 * transform, and the per-stage output envelope) without a real iPod or a real
 * filesystem dump.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DeviceManager, DiscoveredDevice } from '@podkit/core';
import {
  runDeviceArchive,
  type DeviceArchiveDeps,
  DeviceErrorCodes,
  deviceCommand,
} from './device.js';
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

function makeContext(device?: string): CliContext {
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

/** A text-mode (human) OutputContext, non-TTY so progress is plain lines. */
function makeTextOut() {
  const stdout = new BufferSink();
  const stderr = new BufferSink();
  const exitCode = new BufferExitCodeSink();
  const out = new OutputContext({
    mode: 'text',
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

/** A text-mode context that makes a human-mode CLI context (json: false). */
function makeTextContext(device?: string): CliContext {
  const ctx = makeContext(device);
  return { ...ctx, globalOpts: { ...ctx.globalOpts, json: false } };
}

function fakeManager(overrides: Partial<DeviceManager> = {}): DeviceManager {
  return {
    platform: 'test',
    isSupported: true,
    scan: async () => [],
    locate: async () => null,
    ...overrides,
  } as DeviceManager;
}

interface ErrJson {
  success: false;
  error: string;
  code: string;
}

type DiscoverFn = NonNullable<DeviceArchiveDeps['discoverConnectedDevices']>;

/** Build a `discoverConnectedDevices` stub returning a fixed device list. */
function fakeDiscover(devices: DiscoveredDevice[]): DiscoverFn {
  return (async () => devices) as DiscoverFn;
}

/** A mounted block-side iPod discovered record. */
function mountedIpod(volumeName: string, mountPoint: string): DiscoveredDevice {
  return {
    kind: 'ipod',
    matchedBy: 'block-only',
    block: {
      identifier: mountPoint,
      volumeName,
      volumeUuid: 'UUID-' + volumeName,
      storage: { sizeBytes: 1_000_000 },
      isMounted: true,
      mountPoint,
    },
  };
}

describe('device archive: command surface', () => {
  const archiveCmd = () => deviceCommand.commands.find((c) => c.name() === 'archive');

  it('is registered as a device subcommand', () => {
    expect(archiveCmd()).toBeDefined();
    expect(archiveCmd()?.description()).toContain('archive');
  });

  it('accepts an optional positional output path', () => {
    const cmd = archiveCmd();
    expect(cmd?.registeredArguments).toHaveLength(1);
    expect(cmd?.registeredArguments[0]?.name()).toBe('path');
    expect(cmd?.registeredArguments[0]?.required).toBe(false);
  });

  it('has --dump-only and --from-dump options', () => {
    const cmd = archiveCmd();
    expect(cmd?.options.find((o) => o.long === '--dump-only')).toBeDefined();
    expect(cmd?.options.find((o) => o.long === '--from-dump')).toBeDefined();
  });
});

describe('runDeviceArchive', () => {
  let volume: string;
  let dest: string;

  beforeEach(() => {
    volume = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-cli-vol-'));
    dest = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-cli-dest-'));
  });

  afterEach(() => {
    fs.rmSync(volume, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  });

  it('runs --from-dump via runTransform without resolving a device', async () => {
    const ctx = makeContext();
    const { out, stdout, exitCode } = makeOut();

    let seenDump: string | undefined;
    const fakeRunTransform: DeviceArchiveDeps['runTransform'] = async (dumpDir) => {
      seenDump = dumpDir;
      return {
        archiveDir: path.join(dumpDir, 'archive'),
        ipodRoot: path.join(dumpDir, 'raw'),
        written: 3,
        fallbackTagged: 0,
        noAudio: [{ dbid: 1n, title: 'No File' }],
        noArtwork: [{ dbid: 2n, title: 'No Art' }],
        failures: [],
        tagFailures: [],
        identity: {},
        libraryDbPath: path.join(dumpDir, 'archive', 'library.sqlite'),
        readmePath: path.join(dumpDir, 'archive', 'README.md'),
        reportMarkdownPath: path.join(dumpDir, 'archive', 'report.md'),
        reportJsonPath: path.join(dumpDir, 'archive', 'report.json'),
        playlistsWritten: [],
        playlistFailures: [],
      };
    };

    const deps: DeviceArchiveDeps = {
      // No getDeviceManager / loadCore: the transform path must not touch them.
      runTransform: fakeRunTransform,
    };

    await runWithContext(ctx, () =>
      runAction(out, () => runDeviceArchive(undefined, { fromDump: '/some/dump' }, out, deps))
    );

    expect(exitCode.get()).not.toBe(1);
    expect(seenDump).toBe('/some/dump');
    const result = stdout.json<{
      success: true;
      stage: string;
      archiveDir: string;
      written: number;
      noAudioCount: number;
      noArtworkCount: number;
      failureCount: number;
    }>();
    expect(result.success).toBe(true);
    expect(result.stage).toBe('transform');
    expect(result.written).toBe(3);
    expect(result.noAudioCount).toBe(1);
    expect(result.noArtworkCount).toBe(1);
    expect(result.failureCount).toBe(0);
    expect(result.archiveDir).toContain('archive');
  });

  it('surfaces a transform failure as ARCHIVE_TRANSFORM_FAILED', async () => {
    const ctx = makeContext();
    const { out, stdout, exitCode } = makeOut();
    const deps: DeviceArchiveDeps = {
      runTransform: async () => {
        throw new Error('no iPod_Control found');
      },
    };
    await runWithContext(ctx, () =>
      runAction(out, () => runDeviceArchive(undefined, { fromDump: '/bad/dump' }, out, deps))
    );
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<ErrJson>();
    expect(err.code).toBe(DeviceErrorCodes.ARCHIVE_TRANSFORM_FAILED);
  });

  it('auto-detect: no devices → NO_DEVICE_FOUND (primary message, NOT the iPod-only caveat)', async () => {
    const ctx = makeContext(); // no --device → auto-detect
    const { out, stdout, exitCode } = makeOut();
    const deps: DeviceArchiveDeps = {
      loadCore: async () => ({}) as typeof import('@podkit/core'),
      getDeviceManager: () => fakeManager(),
      discoverConnectedDevices: fakeDiscover([]),
    };
    await runWithContext(ctx, () =>
      runAction(out, () => runDeviceArchive(dest, { dumpOnly: true }, out, deps))
    );
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<ErrJson>();
    expect(err.code).toBe(DeviceErrorCodes.NO_DEVICE_FOUND);
    // The primary message is about no iPod being connected — NOT the old,
    // confusing "Archive is only supported for iPod devices" caveat.
    expect(err.error).toContain('No iPod found');
    expect(err.error).not.toContain('only supported for iPod');
  });

  it('auto-detect: unsupported platform → NO_DEVICE_FOUND telling the user to pass --device', async () => {
    const ctx = makeContext();
    const { out, stdout, exitCode } = makeOut();
    const deps: DeviceArchiveDeps = {
      loadCore: async () => ({}) as typeof import('@podkit/core'),
      getDeviceManager: () => fakeManager({ isSupported: false }),
      // discovery must not even be consulted on an unsupported platform.
      discoverConnectedDevices: (async () => {
        throw new Error('discoverConnectedDevices must not run on an unsupported platform');
      }) as DiscoverFn,
    };
    await runWithContext(ctx, () =>
      runAction(out, () => runDeviceArchive(dest, { dumpOnly: true }, out, deps))
    );
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<ErrJson>();
    expect(err.code).toBe(DeviceErrorCodes.NO_DEVICE_FOUND);
    expect(err.error).toContain('not supported on this platform');
  });

  it('auto-detect: an unsupported (non-iPod) USB device → no-iPod / iPod-only message', async () => {
    const ctx = makeContext();
    const { out, stdout, exitCode } = makeOut();
    const unsupported: DiscoveredDevice = {
      kind: 'unsupported',
      matchedBy: 'usb-only',
      usb: {
        kind: 'unsupported',
        family: 'Sony Walkman',
        reason: 'Sony Walkman is not yet supported by podkit.',
        device: { vendorId: '054c', productId: '0991' },
      } as Extract<DiscoveredDevice, { kind: 'unsupported' }>['usb'],
    };
    const deps: DeviceArchiveDeps = {
      loadCore: async () => ({}) as typeof import('@podkit/core'),
      getDeviceManager: () => fakeManager(),
      discoverConnectedDevices: fakeDiscover([unsupported]),
    };
    await runWithContext(ctx, () =>
      runAction(out, () => runDeviceArchive(dest, { dumpOnly: true }, out, deps))
    );
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<ErrJson>();
    expect(err.code).toBe(DeviceErrorCodes.IPOD_ONLY);
    expect(err.error).toContain('No iPod found');
  });

  it('auto-detect: a connected mass-storage device only → no-iPod / iPod-only message', async () => {
    const ctx = makeContext();
    const { out, stdout, exitCode } = makeOut();
    const massStorage: DiscoveredDevice = {
      kind: 'mass-storage',
      matchedBy: 'block-only',
      block: {
        identifier: 'disk9',
        volumeName: 'ECHO',
        volumeUuid: 'ECHO-UUID',
        storage: { sizeBytes: 1_000_000 },
        isMounted: true,
        mountPoint: '/Volumes/ECHO',
      },
    };
    const deps: DeviceArchiveDeps = {
      loadCore: async () => ({}) as typeof import('@podkit/core'),
      getDeviceManager: () => fakeManager(),
      discoverConnectedDevices: fakeDiscover([massStorage]),
    };
    await runWithContext(ctx, () =>
      runAction(out, () => runDeviceArchive(dest, { dumpOnly: true }, out, deps))
    );
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<ErrJson>();
    expect(err.code).toBe(DeviceErrorCodes.IPOD_ONLY);
    // No iPod is the headline; the iPod-only caveat is the qualifier.
    expect(err.error).toContain('No iPod found');
    expect(err.error).toContain('only supported for iPods');
  });

  it('auto-detect: exactly one mounted iPod → delegates to runDump with the detected mount path', async () => {
    const ctx = makeContext();
    const { out, stdout, exitCode } = makeOut();

    let seenVolume: string | undefined;
    const fakeRunDump: DeviceArchiveDeps['runDump'] = async (volumeRoot, destDir) => {
      seenVolume = volumeRoot;
      return {
        outputDir: path.join(destDir, 'TERAPOD-x'),
        rawDumpDir: path.join(destDir, 'TERAPOD-x', 'raw'),
        manifestPath: path.join(destDir, 'TERAPOD-x', 'raw', 'manifest.sha256'),
        identity: {},
        classification: { copy: ['iPod_Control'], junk: [], foreign: [] },
        manifest: [{ sha256: 'a'.repeat(64), relativePath: 'iPod_Control/x' }],
        failures: [],
        report: { foreignSkipped: [], dumpFailures: [] },
        reportMarkdownPath: path.join(destDir, 'TERAPOD-x', 'report.md'),
        reportJsonPath: path.join(destDir, 'TERAPOD-x', 'report.json'),
      };
    };

    const deps: DeviceArchiveDeps = {
      loadCore: async () => ({}) as typeof import('@podkit/core'),
      getDeviceManager: () => fakeManager(),
      discoverConnectedDevices: fakeDiscover([mountedIpod('TERAPOD', volume)]),
      runDump: fakeRunDump,
    };

    await runWithContext(ctx, () =>
      runAction(out, () => runDeviceArchive(dest, { dumpOnly: true }, out, deps))
    );

    expect(exitCode.get()).not.toBe(1);
    // The dump ran against the iPod's actual mount point, not a configured default.
    expect(seenVolume).toBe(volume);
    const result = stdout.json<{ success: true; stage: string }>();
    expect(result.success).toBe(true);
    expect(result.stage).toBe('dump');
  });

  it('captures firmware SysInfoExtended and passes its XML to runDump', async () => {
    const ctx = makeContext();
    const { out, exitCode } = makeOut();

    let seenXml: unknown;
    const fakeRunDump: DeviceArchiveDeps['runDump'] = async (_volumeRoot, destDir, opts) => {
      seenXml = opts?.capturedSysInfoXml;
      return {
        outputDir: path.join(destDir, 'TERAPOD-x'),
        rawDumpDir: path.join(destDir, 'TERAPOD-x', 'raw'),
        manifestPath: path.join(destDir, 'TERAPOD-x', 'raw', 'manifest.sha256'),
        identity: {},
        classification: { copy: ['iPod_Control'], junk: [], foreign: [] },
        manifest: [{ sha256: 'a'.repeat(64), relativePath: 'iPod_Control/x' }],
        failures: [],
        report: { foreignSkipped: [], dumpFailures: [] },
        reportMarkdownPath: path.join(destDir, 'TERAPOD-x', 'report.md'),
        reportJsonPath: path.join(destDir, 'TERAPOD-x', 'report.json'),
      };
    };

    // A core stub: the device has no on-disk SysInfoExtended but a USB
    // fingerprint, so a read-only firmware inquiry captures the SIE XML.
    const sieXml = '<?xml version="1.0"?><plist><dict/></plist>';
    const fakeCore = {
      assessIpodIdentity: async () => ({ existing: null, usbFingerprint: { productId: '1303' } }),
      captureSysInfoExtendedXml: async () => sieXml,
    } as unknown as typeof import('@podkit/core');

    const deps: DeviceArchiveDeps = {
      loadCore: async () => fakeCore,
      getDeviceManager: () => fakeManager(),
      discoverConnectedDevices: fakeDiscover([mountedIpod('TERAPOD', volume)]),
      runDump: fakeRunDump,
    };

    await runWithContext(ctx, () =>
      runAction(out, () => runDeviceArchive(dest, { dumpOnly: true }, out, deps))
    );

    expect(exitCode.get()).not.toBe(1);
    expect(seenXml).toBe(sieXml);
  });

  it('skips firmware capture when the device already has SysInfoExtended on disk', async () => {
    const ctx = makeContext();
    const { out, exitCode } = makeOut();

    let seenXml: unknown = 'unset';
    const fakeRunDump: DeviceArchiveDeps['runDump'] = async (_volumeRoot, destDir, opts) => {
      seenXml = opts?.capturedSysInfoXml;
      return {
        outputDir: path.join(destDir, 'TERAPOD-x'),
        rawDumpDir: path.join(destDir, 'TERAPOD-x', 'raw'),
        manifestPath: path.join(destDir, 'TERAPOD-x', 'raw', 'manifest.sha256'),
        identity: {},
        classification: { copy: ['iPod_Control'], junk: [], foreign: [] },
        manifest: [{ sha256: 'a'.repeat(64), relativePath: 'iPod_Control/x' }],
        failures: [],
        report: { foreignSkipped: [], dumpFailures: [] },
        reportMarkdownPath: path.join(destDir, 'TERAPOD-x', 'report.md'),
        reportJsonPath: path.join(destDir, 'TERAPOD-x', 'report.json'),
      };
    };

    let inquiryCalled = false;
    const fakeCore = {
      assessIpodIdentity: async () => ({ existing: { present: true }, usbFingerprint: null }),
      captureSysInfoExtendedXml: async () => {
        inquiryCalled = true;
        return null;
      },
    } as unknown as typeof import('@podkit/core');

    const deps: DeviceArchiveDeps = {
      loadCore: async () => fakeCore,
      getDeviceManager: () => fakeManager(),
      discoverConnectedDevices: fakeDiscover([mountedIpod('TERAPOD', volume)]),
      runDump: fakeRunDump,
    };

    await runWithContext(ctx, () =>
      runAction(out, () => runDeviceArchive(dest, { dumpOnly: true }, out, deps))
    );

    expect(exitCode.get()).not.toBe(1);
    expect(inquiryCalled).toBe(false);
    expect(seenXml).toBeUndefined();
  });

  it('auto-detect: multiple mounted iPods → MULTIPLE_IPODS', async () => {
    const ctx = makeContext();
    const { out, stdout, exitCode } = makeOut();
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-cli-vol2-'));
    try {
      const deps: DeviceArchiveDeps = {
        loadCore: async () => ({}) as typeof import('@podkit/core'),
        getDeviceManager: () => fakeManager(),
        discoverConnectedDevices: fakeDiscover([
          mountedIpod('TERAPOD', volume),
          mountedIpod('SPAREPOD', other),
        ]),
        runDump: async () => {
          throw new Error('runDump must not be called when multiple iPods are connected');
        },
      };
      await runWithContext(ctx, () =>
        runAction(out, () => runDeviceArchive(dest, { dumpOnly: true }, out, deps))
      );
      expect(exitCode.get()).toBe(1);
      const err = stdout.json<ErrJson>();
      expect(err.code).toBe(DeviceErrorCodes.MULTIPLE_IPODS);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it('auto-detect: an unmounted (usb-only) iPod → IPOD_NOT_MOUNTED with the scan --mount hint', async () => {
    const ctx = makeContext();
    const { out, stdout, exitCode } = makeOut();
    const usbOnlyIpod: DiscoveredDevice = {
      kind: 'ipod',
      matchedBy: 'usb-only',
      usb: {
        kind: 'ipod',
        supported: true,
        device: { vendorId: '05ac', productId: '1209' },
      } as Extract<DiscoveredDevice, { kind: 'ipod' }>['usb'],
    };
    const deps: DeviceArchiveDeps = {
      loadCore: async () => ({}) as typeof import('@podkit/core'),
      getDeviceManager: () => fakeManager(),
      discoverConnectedDevices: fakeDiscover([usbOnlyIpod]),
    };
    await runWithContext(ctx, () =>
      runAction(out, () => runDeviceArchive(dest, { dumpOnly: true }, out, deps))
    );
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<ErrJson>();
    expect(err.code).toBe(DeviceErrorCodes.IPOD_NOT_MOUNTED);
    expect(err.error).toContain('not mounted');
  });

  it('delegates to runDump and emits the dump success envelope (path mode)', async () => {
    const ctx = makeContext(volume); // -d <path> → path mode
    const { out, stdout, exitCode } = makeOut();

    const fakeRunDump: DeviceArchiveDeps['runDump'] = async (volumeRoot, destDir) => ({
      outputDir: path.join(destDir, 'IPOD-20260622-090703'),
      rawDumpDir: path.join(destDir, 'IPOD-20260622-090703', 'raw'),
      manifestPath: path.join(destDir, 'IPOD-20260622-090703', 'raw', 'manifest.sha256'),
      identity: {},
      classification: { copy: ['iPod_Control'], junk: ['.DS_Store'], foreign: ['mixtape.flac'] },
      manifest: [{ sha256: 'a'.repeat(64), relativePath: 'iPod_Control/x' }],
      failures: [],
      report: { foreignSkipped: ['mixtape.flac'], dumpFailures: [] },
      reportMarkdownPath: path.join(destDir, 'IPOD-20260622-090703', 'report.md'),
      reportJsonPath: path.join(destDir, 'IPOD-20260622-090703', 'report.json'),
    });

    const deps: DeviceArchiveDeps = {
      loadCore: async () => ({}) as typeof import('@podkit/core'),
      getDeviceManager: () => fakeManager(),
      runDump: fakeRunDump,
    };

    await runWithContext(ctx, () =>
      runAction(out, () => runDeviceArchive(dest, { dumpOnly: true }, out, deps))
    );

    expect(exitCode.get()).not.toBe(1);
    const result = stdout.json<{
      success: true;
      stage: string;
      fileCount: number;
      foreign: string[];
      outputDir: string;
    }>();
    expect(result.success).toBe(true);
    expect(result.stage).toBe('dump');
    expect(result.fileCount).toBe(1);
    expect(result).not.toHaveProperty('junkCount');
    expect(result.foreign).toEqual(['mixtape.flac']);
    expect(result.outputDir).toContain('IPOD-20260622-090703');
  });

  it('delegates to runArchive (both stages) and emits the both-stages envelope (bare invocation — no flags)', async () => {
    const ctx = makeContext(volume);
    const { out, stdout, exitCode } = makeOut();

    let seenVolume: string | undefined;
    let seenDest: string | undefined;
    const outputDir = path.join(dest, 'IPOD-20260622-090703');
    const fakeRunArchive: DeviceArchiveDeps['runArchive'] = async (volumeRoot, destDir) => {
      seenVolume = volumeRoot;
      seenDest = destDir;
      return {
        outputDir,
        dump: {
          outputDir,
          rawDumpDir: path.join(outputDir, 'raw'),
          manifestPath: path.join(outputDir, 'raw', 'manifest.sha256'),
          identity: {},
          classification: {
            copy: ['iPod_Control'],
            junk: ['.DS_Store'],
            foreign: ['mixtape.flac'],
          },
          manifest: [{ sha256: 'b'.repeat(64), relativePath: 'iPod_Control/Music/F00/x.m4a' }],
          failures: [],
          report: { foreignSkipped: ['mixtape.flac'], dumpFailures: [] },
          reportMarkdownPath: path.join(outputDir, 'report.md'),
          reportJsonPath: path.join(outputDir, 'report.json'),
        },
        transform: {
          archiveDir: path.join(outputDir, 'archive'),
          ipodRoot: path.join(outputDir, 'raw'),
          written: 1,
          noAudio: [],
          noArtwork: [{ dbid: 2n, title: 'No Art' }],
          fallbackTagged: 0,
          failures: [],
          tagFailures: [],
          identity: {},
          libraryDbPath: path.join(outputDir, 'archive', 'library.sqlite'),
          readmePath: path.join(outputDir, 'archive', 'README.md'),
          reportMarkdownPath: path.join(outputDir, 'archive', 'report.md'),
          reportJsonPath: path.join(outputDir, 'archive', 'report.json'),
          playlistsWritten: [],
          playlistFailures: [],
        },
      };
    };

    const deps: DeviceArchiveDeps = {
      loadCore: async () => ({}) as typeof import('@podkit/core'),
      getDeviceManager: () => fakeManager(),
      // runDump must NOT be called on the bare path — it now runs both stages.
      runDump: async () => {
        throw new Error('runDump should not be called on the bare both-stages path');
      },
      runArchive: fakeRunArchive,
    };

    // Bare invocation: no dumpOnly, no fromDump flag.
    await runWithContext(ctx, () => runAction(out, () => runDeviceArchive(dest, {}, out, deps)));

    expect(exitCode.get()).not.toBe(1);
    expect(seenVolume).toBe(volume);
    expect(seenDest).toBe(dest);
    const result = stdout.json<{
      success: true;
      stage: string;
      outputDir: string;
      rawDumpDir: string;
      archiveDir: string;
      fileCount: number;
      foreign: string[];
      written: number;
      noArtworkCount: number;
      readmePath: string;
    }>();
    expect(result.success).toBe(true);
    expect(result.stage).toBe('both');
    expect(result.outputDir).toBe(outputDir);
    expect(result.rawDumpDir).toBe(path.join(outputDir, 'raw'));
    expect(result.archiveDir).toBe(path.join(outputDir, 'archive'));
    expect(result.fileCount).toBe(1);
    expect(result).not.toHaveProperty('junkCount');
    expect(result.foreign).toEqual(['mixtape.flac']);
    expect(result.written).toBe(1);
    expect(result.noArtworkCount).toBe(1);
    expect(result.readmePath).toBe(path.join(outputDir, 'archive', 'README.md'));
  });

  it('gates to iPod-only — a mass-storage configured device is rejected', async () => {
    // A configured mass-storage device resolved by name. We feed it through a
    // config that types the device as a preset, then assert the IPOD_ONLY gate.
    const config: PodkitConfig = {
      quality: 'medium',
      artwork: true,
      tips: true,
      transforms: DEFAULT_TRANSFORMS_CONFIG,
      videoTransforms: DEFAULT_VIDEO_TRANSFORMS_CONFIG,
      devices: { echo: { type: 'echo-mini', path: volume } },
      music: {},
      video: {},
    };
    const ctx: CliContext = {
      config,
      globalOpts: {
        json: true,
        quiet: false,
        verbose: 0,
        color: false,
        tips: false,
        tty: false,
        device: 'echo',
      },
      configResult: { config, configPath: undefined, configFileExists: false },
    };
    const { out, stdout, exitCode } = makeOut();
    const deps: DeviceArchiveDeps = {
      loadCore: async () => ({}) as typeof import('@podkit/core'),
      getDeviceManager: () => fakeManager(),
      runDump: async () => {
        throw new Error('runDump should not be called for a mass-storage device');
      },
    };
    await runWithContext(ctx, () =>
      runAction(out, () => runDeviceArchive(dest, { dumpOnly: true }, out, deps))
    );
    expect(exitCode.get()).toBe(1);
    const err = stdout.json<ErrJson>();
    expect(err.code).toBe(DeviceErrorCodes.IPOD_ONLY);
  });
});

describe('runDeviceArchive — human output + progress', () => {
  let volume: string;
  let dest: string;

  beforeEach(() => {
    volume = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-cli-vol-'));
    dest = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-cli-dest-'));
  });

  afterEach(() => {
    fs.rmSync(volume, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  });

  /** A both-stages stub that drives the provided onProgress with synthetic events. */
  function fakeRunArchiveWithProgress(outputDir: string): DeviceArchiveDeps['runArchive'] {
    return (async (_volumeRoot, _destDir, opts) => {
      opts?.onProgress?.({ kind: 'dump:start', outputDir, deviceName: 'TERAPOD' });
      opts?.onProgress?.({ kind: 'dump:file', copied: 1 });
      opts?.onProgress?.({ kind: 'dump:file', copied: 2 });
      opts?.onProgress?.({ kind: 'dump:done', fileCount: 2 });
      opts?.onProgress?.({
        kind: 'transform:start',
        identity: {
          serialNumber: 'ABC123',
          modelName: 'iPod Video (60GB)',
          modelNumber: 'MA147',
          capacityGb: 60,
        },
        stats: {
          total: 3,
          songs: 2,
          movies: 1,
          podcasts: 0,
          audiobooks: 0,
          musicVideos: 0,
          tvShows: 0,
          playlists: 2,
        },
      });
      opts?.onProgress?.({ kind: 'transform:track', done: 1, total: 3, title: 'A' });
      opts?.onProgress?.({ kind: 'transform:done', written: 3 });
      return {
        outputDir,
        dump: {
          outputDir,
          rawDumpDir: path.join(outputDir, 'raw'),
          manifestPath: path.join(outputDir, 'raw', 'manifest.sha256'),
          identity: {},
          classification: { copy: ['iPod_Control'], junk: [], foreign: [] },
          manifest: [{ sha256: 'a'.repeat(64), relativePath: 'iPod_Control/x' }],
          failures: [],
          report: { foreignSkipped: [], dumpFailures: [] },
          reportMarkdownPath: path.join(outputDir, 'report.md'),
          reportJsonPath: path.join(outputDir, 'report.json'),
        },
        transform: {
          archiveDir: path.join(outputDir, 'archive'),
          ipodRoot: path.join(outputDir, 'raw'),
          written: 3,
          noAudio: [],
          noArtwork: [],
          fallbackTagged: 0,
          failures: [],
          tagFailures: [],
          identity: {},
          libraryDbPath: path.join(outputDir, 'archive', 'library.sqlite'),
          readmePath: path.join(outputDir, 'archive', 'README.md'),
          reportMarkdownPath: path.join(outputDir, 'archive', 'report.md'),
          reportJsonPath: path.join(outputDir, 'archive', 'report.json'),
          playlistsWritten: [],
          playlistFailures: [],
        },
      };
    }) as DeviceArchiveDeps['runArchive'];
  }

  it('bare run: prints a destination header + device-meta + library, NOT per-artifact paths', async () => {
    const ctx = makeTextContext(volume);
    const { out, stdout, stderr } = makeTextOut();
    const outputDir = path.join(dest, 'TERAPOD-x-20260622');
    const deps: DeviceArchiveDeps = {
      loadCore: async () => ({}) as typeof import('@podkit/core'),
      getDeviceManager: () => fakeManager(),
      runArchive: fakeRunArchiveWithProgress(outputDir),
    };

    await runWithContext(ctx, () => runAction(out, () => runDeviceArchive(dest, {}, out, deps)));

    const text = stdout.text() + stderr.text();
    // ONE destination header showing where it's going.
    expect(text).toContain(`Archiving iPod "TERAPOD" → ${outputDir}`);
    // The per-artifact path lines are GONE from the human output.
    expect(text).not.toContain('README:');
    expect(text).not.toContain('report:');
    expect(text).not.toContain('raw dump:');
    expect(text).not.toContain('archive:');
    // Device-meta + library breakdown surfaced.
    expect(text).toContain('iPod Video (60GB) (60 GB) · MA147 · serial ABC123');
    expect(text).toContain('2 songs · 1 movie · 2 playlists');
    // The raw-dump + final archive milestone lines.
    expect(text).toContain('✓ raw dump — 2 files');
    expect(text).toContain('✓ archive — 3 tracks extracted');
  });

  it('--dump-only: prints a Dumping header + raw-dump line, no README/report/archive paths', async () => {
    const ctx = makeTextContext(volume);
    const { out, stdout, stderr } = makeTextOut();
    const outputDir = path.join(dest, 'IPOD-x-20260622');
    const fakeRunDump: DeviceArchiveDeps['runDump'] = (async (_v, _d, opts) => {
      opts?.onProgress?.({ kind: 'dump:start', outputDir, deviceName: 'IPOD' });
      opts?.onProgress?.({ kind: 'dump:file', copied: 1 });
      opts?.onProgress?.({ kind: 'dump:done', fileCount: 1 });
      return {
        outputDir,
        rawDumpDir: path.join(outputDir, 'raw'),
        manifestPath: path.join(outputDir, 'raw', 'manifest.sha256'),
        identity: {},
        classification: { copy: ['iPod_Control'], junk: [], foreign: [] },
        manifest: [{ sha256: 'a'.repeat(64), relativePath: 'iPod_Control/x' }],
        failures: [],
        report: { foreignSkipped: [], dumpFailures: [] },
        reportMarkdownPath: path.join(outputDir, 'report.md'),
        reportJsonPath: path.join(outputDir, 'report.json'),
      };
    }) as DeviceArchiveDeps['runDump'];

    const deps: DeviceArchiveDeps = {
      loadCore: async () => ({}) as typeof import('@podkit/core'),
      getDeviceManager: () => fakeManager(),
      runDump: fakeRunDump,
    };

    await runWithContext(ctx, () =>
      runAction(out, () => runDeviceArchive(dest, { dumpOnly: true }, out, deps))
    );

    const text = stdout.text() + stderr.text();
    expect(text).toContain(`Dumping iPod "IPOD" → ${outputDir}`);
    expect(text).toContain('✓ raw dump — 1 file');
    expect(text).not.toContain('manifest:');
    expect(text).not.toContain('report:');
    expect(text).not.toContain('archive:');
    expect(text).not.toContain('README:');
  });

  it('--json: envelope keeps every path field and no progress text leaks to stdout', async () => {
    // In JSON mode no onProgress is passed; even if the stub emitted events, the
    // renderer is absent so stdout stays pure JSON.
    const ctx = makeContext(volume); // json: true
    const { out, stdout, stderr } = makeOut();
    const outputDir = path.join(dest, 'TERAPOD-json-20260622');
    const deps: DeviceArchiveDeps = {
      loadCore: async () => ({}) as typeof import('@podkit/core'),
      getDeviceManager: () => fakeManager(),
      runArchive: fakeRunArchiveWithProgress(outputDir),
    };

    await runWithContext(ctx, () => runAction(out, () => runDeviceArchive(dest, {}, out, deps)));

    // stdout parses cleanly as JSON — no progress/meta text mixed in.
    const result = stdout.json<{
      success: true;
      stage: string;
      outputDir: string;
      rawDumpDir: string;
      archiveDir: string;
      readmePath: string;
      reportMarkdownPath: string;
      reportJsonPath: string;
      manifestPath: string;
    }>();
    expect(result.success).toBe(true);
    expect(result.stage).toBe('both');
    // All path fields the JSON envelope carried before are still present.
    expect(result.outputDir).toBe(outputDir);
    expect(result.rawDumpDir).toBe(path.join(outputDir, 'raw'));
    expect(result.archiveDir).toBe(path.join(outputDir, 'archive'));
    expect(result.readmePath).toBe(path.join(outputDir, 'archive', 'README.md'));
    expect(result.reportMarkdownPath).toBe(path.join(outputDir, 'archive', 'report.md'));
    expect(result.reportJsonPath).toBe(path.join(outputDir, 'archive', 'report.json'));
    expect(result.manifestPath).toBe(path.join(outputDir, 'raw', 'manifest.sha256'));
    // No header text leaked to either stream.
    expect(stdout.text()).not.toContain('Archiving iPod');
    expect(stdout.text()).not.toContain('✓ archive');
    expect(stderr.text()).toBe('');
  });

  it('--quiet: no onProgress is passed, so no progress/meta/milestone text is written', async () => {
    const ctx = makeTextContext(volume);
    const { out, stdout, stderr } = makeTextOut();
    // Flip the context + output into quiet mode.
    const quietCtx: CliContext = {
      ...ctx,
      globalOpts: { ...ctx.globalOpts, quiet: true },
    };
    const quietOut = new OutputContext({
      mode: 'text',
      quiet: true,
      verbose: 0,
      color: false,
      tips: false,
      tty: false,
      stdout,
      stderr,
      exitCode: new BufferExitCodeSink(),
    });
    void out; // the quiet context uses quietOut

    let sawOnProgress = false;
    const fakeRunArchive: DeviceArchiveDeps['runArchive'] = (async (_v, _d, opts) => {
      if (opts?.onProgress) sawOnProgress = true;
      const outputDir = path.join(dest, 'Q');
      return {
        outputDir,
        dump: {
          outputDir,
          rawDumpDir: path.join(outputDir, 'raw'),
          manifestPath: path.join(outputDir, 'raw', 'manifest.sha256'),
          identity: {},
          classification: { copy: [], junk: [], foreign: [] },
          manifest: [],
          failures: [],
          report: { foreignSkipped: [], dumpFailures: [] },
          reportMarkdownPath: path.join(outputDir, 'report.md'),
          reportJsonPath: path.join(outputDir, 'report.json'),
        },
        transform: {
          archiveDir: path.join(outputDir, 'archive'),
          ipodRoot: path.join(outputDir, 'raw'),
          written: 0,
          noAudio: [],
          noArtwork: [],
          fallbackTagged: 0,
          failures: [],
          tagFailures: [],
          identity: {},
          libraryDbPath: path.join(outputDir, 'archive', 'library.sqlite'),
          readmePath: path.join(outputDir, 'archive', 'README.md'),
          reportMarkdownPath: path.join(outputDir, 'archive', 'report.md'),
          reportJsonPath: path.join(outputDir, 'archive', 'report.json'),
          playlistsWritten: [],
          playlistFailures: [],
        },
      };
    }) as DeviceArchiveDeps['runArchive'];

    const deps: DeviceArchiveDeps = {
      loadCore: async () => ({}) as typeof import('@podkit/core'),
      getDeviceManager: () => fakeManager(),
      runArchive: fakeRunArchive,
    };

    await runWithContext(quietCtx, () =>
      runAction(quietOut, () => runDeviceArchive(dest, {}, quietOut, deps))
    );

    expect(sawOnProgress).toBe(false);
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toBe('');
  });
});
