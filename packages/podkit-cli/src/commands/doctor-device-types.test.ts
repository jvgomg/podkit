/**
 * Doctor device-type + preset coverage (Tier-1).
 *
 * Exercises the doctor flag-parsing and check-selection logic against a stubbed
 * `@podkit/core` — no live CLI subprocess, no libgpod, no FFmpeg. Uses the
 * runner extraction (`runDoctorAction`, `runDoctorDiagnostics` in `doctor.ts`).
 *
 * # Coverage map
 *
 * - iPod check set: real `runDiagnostics` call against the real registry
 *   filtered by `deviceType: 'ipod'`. Validates that iPod-only checks
 *   (orphan-files, artwork-rebuild, sysinfo-consistency) appear and
 *   mass-storage-only checks (orphan-files-mass-storage) do NOT.
 * - iPod text section: runs in text mode against a fake report, asserts the
 *   `Database Health` + `Device Readiness` sections appear.
 * - mass-storage check set: real `runDiagnostics` against the real registry
 *   filtered by `deviceType: 'mass-storage'`. Validates orphan-files-mass-storage
 *   appears and the iPod-only checks do not.
 * - mass-storage text section: runs in text mode for an echo-mini device
 *   config, asserts `Device Health` heading via printGroupedChecks.
 * - generic preset: drives mass-storage doctor with a generic device config,
 *   asserts the contentPaths threaded into `runDiagnostics` use the preset's
 *   defaults.
 * - rockbox preset: same shape for a rockbox device config.
 * - --repair check-type mismatch: drives `runDoctorAction` with a mismatched
 *   repair on a real registry check; asserts INCOMPATIBLE_DEVICE_TYPE.
 * - deviceModel rendering: iPod path returns the libgpod model name;
 *   mass-storage path returns the preset display name.
 * - doctor against unrecognised path: drives runDoctorAction with a path
 *   that resolves to nothing; asserts DEVICE_NOT_RESOLVED.
 *
 * Personas: tests reference persona shapes by reusing the persona ID strings
 * (`'echo-mini'`, `'ipod-touch-5g-unsupported'`, etc.) without importing the
 * full persona module — the persona registry is the source of truth for what
 * each ID represents, and the doctor command operates on `deviceConfig.type`
 * rather than persona schema, so a string is sufficient at the unit tier.
 * Tier-3 coverage in `packages/device-testing/src/tier3/doctor-device-types.
 * tier3.test.ts` drives the actual personas end-to-end.
 */

import { describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDoctorAction, runDoctorDiagnostics, DoctorErrorCodes } from './doctor.js';
import { runDiagnostics, getDiagnosticCheck } from '@podkit/core';
import { BufferExitCodeSink, OutputContext } from '../output/index.js';
import { BufferSink } from '../test-utils/buffer-sink.js';
import { expectCliError } from '../test-utils/cli-error.js';
import { runWithContext, type CliContext } from '../context.js';
import { runAction } from '../errors.js';
import {
  DEFAULT_TRANSFORMS_CONFIG,
  DEFAULT_VIDEO_TRANSFORMS_CONFIG,
  type PodkitConfig,
  type GlobalOptions,
  type LoadConfigResult,
  type DeviceConfig,
} from '../config/index.js';
import type { DeviceManager } from '@podkit/core';

// ── Shared helpers (mirrors doctor-flag-matrix.test.ts) ────────────────────

type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip';

interface FakeCheckResult {
  id: string;
  name: string;
  status: CheckStatus;
  summary: string;
  repairable: boolean;
  hasRepair: boolean;
  repairOnly: boolean;
  scope: 'system' | 'device-readiness' | 'database-health';
  details?: Record<string, unknown>;
}

interface FakeCoreCapture {
  /** Forwarded scopes. */
  scopes?: ReadonlyArray<'system' | 'device-readiness' | 'database-health'>;
  /** Forwarded mountPoint. */
  mountPoint?: string;
  /** Forwarded deviceType. */
  deviceType?: string;
  /** Forwarded contentPaths (mass-storage path only). */
  contentPaths?: Record<string, unknown>;
  /** Forwarded deviceModel (mass-storage path only — explicit override). */
  deviceModel?: string;
}

function makeContext(
  opts: { device?: string; json?: boolean; devices?: Record<string, DeviceConfig> } = {}
): CliContext {
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
    json: opts.json ?? true,
    quiet: false,
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

function makeOut(mode: 'json' | 'text' = 'json'): {
  out: OutputContext;
  stdout: BufferSink;
  stderr: BufferSink;
  exitCode: BufferExitCodeSink;
} {
  const stdout = new BufferSink();
  const stderr = new BufferSink();
  const exitCode = new BufferExitCodeSink();
  return {
    out: new OutputContext({
      mode,
      quiet: false,
      verbose: 0,
      color: false,
      tips: false,
      tty: false,
      stdout,
      stderr,
      exitCode,
    }),
    stdout,
    stderr,
    exitCode,
  };
}

function fakeManager(overrides: Partial<DeviceManager> = {}): DeviceManager {
  const base: Partial<DeviceManager> = {
    platform: 'test',
    isSupported: true,
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

/**
 * Build a fake `@podkit/core`, with capture hooks so tests assert on the
 * arguments forwarded to `runDiagnostics`. Tests that need a real `runDiagnostics`
 * (the registry-filter ACs #1/#3) skip this fake and use the real one imported
 * from `@podkit/core` directly.
 */
function makeFakeCore(opts: {
  capture?: FakeCoreCapture;
  reportChecks?: FakeCheckResult[];
  reportHealthy?: boolean;
  reportDeviceModel?: string;
  registry?: Array<{
    id: string;
    name: string;
    applicableTo?: ReadonlyArray<'ipod' | 'mass-storage'>;
    scope?: 'system' | 'device-readiness' | 'database-health';
    repair?: {
      description: string;
      requirements: ReadonlyArray<'source-collection' | 'writable-device' | 'database'>;
      run: () => Promise<{ success: boolean; summary: string }>;
    };
  }>;
}): unknown {
  const registry = opts.registry ?? [];
  const fakeIpod = {
    getInfo: () => ({
      device: {
        modelName: opts.reportDeviceModel ?? 'iPod nano 7th generation 16GB',
        modelNumber: 'MD478',
        generation: 'nano_7g',
        capacity: 16,
      },
    }),
    close: () => {},
  };
  const fakeCapabilities = {
    artworkSources: ['embedded'] as const,
    artworkMaxResolution: 240,
    supportedAudioCodecs: ['aac', 'mp3'] as const,
    supportsVideo: false,
    audioNormalization: 'soundcheck' as const,
    supportsAlbumArtistBrowsing: true,
  };
  class FakeIpodDeviceAdapter {
    constructor(
      public ipod: unknown,
      public capabilities: unknown
    ) {}
    getTracks(): unknown[] {
      return [];
    }
    close(): void {}
  }
  return {
    getDeviceManager: () => fakeManager(),
    checkReadiness: async () => ({
      level: 'ready',
      stages: [
        { stage: 'usb', status: 'pass', summary: 'connected' },
        { stage: 'partition', status: 'pass', summary: 'ok' },
        { stage: 'filesystem', status: 'pass', summary: 'ok' },
        { stage: 'mount', status: 'pass', summary: 'ok' },
        { stage: 'sysinfo', status: 'pass', summary: 'ok' },
        { stage: 'database', status: 'pass', summary: 'ok' },
      ],
      deviceModel: { displayName: opts.reportDeviceModel ?? 'iPod nano 7th generation 16GB' },
      usbModel: undefined,
    }),
    assessIpodIdentity: async () => ({
      model: null,
      capabilities: null,
      needsChecksum: false,
      checksumType: undefined,
      firmwareInquiry: 'unwritable' as const,
      existing: null,
      usbFingerprint: null,
      sysInfoModelNumber: undefined,
    }),
    DOCS_URLS: {
      supportedDevices: 'https://example.com/supported',
      linuxFilesystems: 'https://example.com/linux',
      troubleshooting: 'https://example.com/trouble',
      artworkRepair: 'https://example.com/artwork',
      macosMounting: 'https://example.com/macos',
      soundCheck: 'https://example.com/soundcheck',
      userGuideConfiguration: 'https://example.com/config',
      cleanArtists: 'https://example.com/clean-artists',
    },
    resolveUsbDeviceFromPath: async () => null,
    identifyCapabilities: () => fakeCapabilities,
    IpodDeviceAdapter: FakeIpodDeviceAdapter,
    IpodDatabase: { open: async () => fakeIpod },
    getDiagnosticCheck: (id: string) => registry.find((c) => c.id === id),
    getDiagnosticCheckIds: () => registry.map((c) => c.id),
    runDiagnostics: async (input: {
      scopes?: ReadonlyArray<'system' | 'device-readiness' | 'database-health'>;
      mountPoint: string;
      deviceType: string;
      contentPaths?: Record<string, unknown>;
      deviceModel?: string;
    }) => {
      if (opts.capture) {
        opts.capture.scopes = input.scopes;
        opts.capture.mountPoint = input.mountPoint;
        opts.capture.deviceType = input.deviceType;
        opts.capture.contentPaths = input.contentPaths;
        opts.capture.deviceModel = input.deviceModel;
      }
      const checks = opts.reportChecks ?? [];
      const healthy =
        opts.reportHealthy ?? checks.every((c) => c.status === 'pass' || c.status === 'skip');
      return {
        mountPoint: input.mountPoint,
        deviceModel: opts.reportDeviceModel ?? input.deviceModel ?? 'Unknown',
        deviceType: input.deviceType,
        checks,
        healthy,
      };
    },
    normalizeContentPaths: (overrides: object, defaults?: object) => ({
      musicDir: 'Music',
      moviesDir: 'Movies',
      tvShowsDir: 'TV Shows',
      ...defaults,
      ...overrides,
    }),
  };
}

async function runAction1(
  ctx: CliContext,
  out: OutputContext,
  fn: () => Promise<void>
): Promise<void> {
  await runWithContext(ctx, () => runAction(out, fn));
}

// ═════════════════════════════════════════════════════════════════════════════
// iPod check set — orphan-files, artwork-rebuild, sysinfo-consistency
// included; orphan-files-mass-storage excluded.
// ═════════════════════════════════════════════════════════════════════════════

describe('iPod device check-set selection (real registry)', () => {
  it.concurrent(
    "runDiagnostics({deviceType:'ipod'}) includes iPod-only checks; excludes orphan-files-mass-storage",
    async () => {
      // Drive the REAL runner against the REAL registry so this asserts the
      // production filter behaviour, not a stub. The DB is stubbed so we don't
      // touch the filesystem.
      const report = await runDiagnostics({
        mountPoint: '/fake/mount',
        deviceType: 'ipod',
        db: {
          getInfo: () => ({ device: { modelName: 'Stub iPod' } }),
          close: () => {},
        } as never,
        scopes: ['system', 'device-readiness', 'database-health'],
      });

      const ids = new Set(report.checks.map((c) => c.id));
      // Per task description: iPod runs must include all iPod-only checks.
      expect(ids.has('orphan-files')).toBe(true);
      expect(ids.has('artwork-rebuild')).toBe(true);
      expect(ids.has('sysinfo-consistency')).toBe(true);
      expect(ids.has('artwork-reset')).toBe(true);
      expect(ids.has('sysinfo-extended')).toBe(true);
      expect(ids.has('sysinfo-modelnum-mismatch')).toBe(true);
      // Mass-storage-only check must NOT appear in an iPod run.
      expect(ids.has('orphan-files-mass-storage')).toBe(false);
      // Cross-type system checks DO appear (applicableTo: ['ipod', 'mass-storage']).
      expect(ids.has('codec-encoders')).toBe(true);
      expect(ids.has('udev-rule')).toBe(true);
    }
  );

  it.concurrent('inquiry-methods check is iPod-applicable', () => {
    const inquiry = getDiagnosticCheck('inquiry-methods');
    expect(inquiry).toBeDefined();
    expect(inquiry!.applicableTo).toEqual(['ipod']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Mass-storage check set — orphan-files-mass-storage included;
// iPod-only checks excluded.
// ═════════════════════════════════════════════════════════════════════════════

describe('mass-storage device check-set selection (real registry)', () => {
  it.concurrent(
    "runDiagnostics({deviceType:'mass-storage'}) includes orphan-files-mass-storage; excludes iPod-only checks",
    async () => {
      const report = await runDiagnostics({
        mountPoint: '/fake/echo',
        deviceType: 'mass-storage',
        deviceModel: 'Echo Mini',
        contentPaths: {
          musicDir: '',
          moviesDir: 'Video/Movies',
          tvShowsDir: 'Video/Shows',
        },
        scopes: ['system', 'device-readiness', 'database-health'],
      });

      const ids = new Set(report.checks.map((c) => c.id));
      // Mass-storage-only orphan check must appear.
      expect(ids.has('orphan-files-mass-storage')).toBe(true);
      // iPod-only checks must NOT appear in a mass-storage run.
      expect(ids.has('orphan-files')).toBe(false);
      expect(ids.has('artwork-rebuild')).toBe(false);
      expect(ids.has('artwork-reset')).toBe(false);
      expect(ids.has('sysinfo-extended')).toBe(false);
      expect(ids.has('sysinfo-consistency')).toBe(false);
      expect(ids.has('sysinfo-modelnum-mismatch')).toBe(false);
      expect(ids.has('inquiry-methods')).toBe(false);
      // Cross-type system checks DO appear (applicableTo: ['ipod', 'mass-storage']).
      expect(ids.has('codec-encoders')).toBe(true);
      expect(ids.has('udev-rule')).toBe(true);
    }
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// iPod text-mode section headers — "Device Readiness" + "Database Health".
// ═════════════════════════════════════════════════════════════════════════════

describe('iPod text output sections', () => {
  it('renders "Device Readiness" and "Database Health" headings (text mode)', async () => {
    const ctx = makeContext({ device: 'ipod', json: false });
    const { out, stdout } = makeOut('text');

    const fakeCore = makeFakeCore({
      reportChecks: [
        {
          id: 'codec-encoders',
          name: 'FFmpeg encoders',
          status: 'pass',
          summary: 'ok',
          repairable: false,
          hasRepair: false,
          repairOnly: false,
          scope: 'system',
        },
        {
          id: 'artwork-rebuild',
          name: 'Artwork DB',
          status: 'pass',
          summary: 'ok',
          repairable: false,
          hasRepair: false,
          repairOnly: false,
          scope: 'database-health',
        },
      ],
    });

    await runWithContext(ctx, () =>
      runAction(out, () =>
        runDoctorDiagnostics(
          '/tmp/ipod-ac2',
          undefined,
          out,
          {},
          {
            loadCore: async () => fakeCore as typeof import('@podkit/core'),
            getDeviceManager: () => fakeManager(),
          }
        )
      )
    );

    const text = stdout.text();
    // The iPod text renderer always emits both sections — even when System
    // contains no checks, Database Health + Device Readiness MUST render.
    expect(text).toContain('Device Readiness');
    expect(text).toContain('Database Health');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// echo-mini text-mode — uses printGroupedChecks (no "Device Readiness"
// section because mass-storage skips the readiness pipeline).
// ═════════════════════════════════════════════════════════════════════════════

describe('echo-mini text output sections (no readiness pipeline)', () => {
  it('renders grouped sections; omits "Device Readiness" because the iPod readiness pipeline does not run', async () => {
    const tmpDevice = mkdtempSync(join(tmpdir(), 'podkit-doctor-ac4-'));
    try {
      const deviceConfig: DeviceConfig = { type: 'echo-mini', path: tmpDevice };
      const ctx = makeContext({
        device: 'echo',
        json: false,
        devices: { echo: deviceConfig },
      });
      const { out, stdout } = makeOut('text');

      const fakeCore = makeFakeCore({
        reportChecks: [
          {
            id: 'codec-encoders',
            name: 'FFmpeg encoders',
            status: 'pass',
            summary: 'ok',
            repairable: false,
            hasRepair: false,
            repairOnly: false,
            scope: 'system',
          },
          {
            id: 'orphan-files-mass-storage',
            name: 'Mass-storage orphans',
            status: 'pass',
            summary: 'No orphan files',
            repairable: false,
            hasRepair: false,
            repairOnly: false,
            scope: 'database-health',
          },
        ],
      });

      await runWithContext(ctx, () =>
        runAction(out, () =>
          runDoctorDiagnostics(
            tmpDevice,
            deviceConfig,
            out,
            {},
            { loadCore: async () => fakeCore as typeof import('@podkit/core') }
          )
        )
      );

      const text = stdout.text();
      // Mass-storage device uses the unified grouped renderer with the
      // "System" + "Database Health" sections that printGroupedChecks emits.
      // It MUST include the Echo Mini label in the header.
      expect(text).toContain('Echo Mini');
      // Mass-storage doctor does NOT run the iPod readiness pipeline, so
      // "Device Readiness" must be absent.
      expect(text).not.toContain('Device Readiness');
      // The grouped renderer emits "Database Health" for the database-health-
      // scoped orphan-files-mass-storage check.
      expect(text).toContain('Database Health');
    } finally {
      rmSync(tmpDevice, { recursive: true, force: true });
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Generic preset contentPaths are forwarded to runDiagnostics.
// ═════════════════════════════════════════════════════════════════════════════

describe('generic mass-storage preset forwards default contentPaths', () => {
  it('runDiagnostics receives generic preset Music/Video/Movies + Video/Shows paths', async () => {
    const tmpDevice = mkdtempSync(join(tmpdir(), 'podkit-doctor-ac5-'));
    try {
      const deviceConfig: DeviceConfig = { type: 'generic', path: tmpDevice };
      const ctx = makeContext({
        device: 'gendev',
        devices: { gendev: deviceConfig },
      });
      const { out } = makeOut();
      const capture: FakeCoreCapture = {};

      const fakeCore = makeFakeCore({
        capture,
        reportChecks: [],
      });

      await runWithContext(ctx, () =>
        runAction(out, () =>
          runDoctorDiagnostics(
            tmpDevice,
            deviceConfig,
            out,
            {},
            { loadCore: async () => fakeCore as typeof import('@podkit/core') }
          )
        )
      );

      // Mass-storage path always threads contentPaths.
      expect(capture.deviceType).toBe('mass-storage');
      expect(capture.contentPaths).toBeDefined();
      // Generic preset defaults to DEFAULT_CONTENT_PATHS — `Music`, `Video/
      // Movies`, `Video/Shows`. The fake `normalizeContentPaths` merges
      // overrides over defaults, so the resulting object reflects exactly
      // what the preset supplies.
      expect(capture.contentPaths!.musicDir).toBe('Music');
      expect(capture.contentPaths!.moviesDir).toBe('Video/Movies');
      expect(capture.contentPaths!.tvShowsDir).toBe('Video/Shows');
    } finally {
      rmSync(tmpDevice, { recursive: true, force: true });
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Rockbox preset contentPaths.
//
// Tier-3 cannot drive a rockbox device today — no rockbox persona is captured
// in the registry. Unit coverage is the authoritative cover for this path.
// ═════════════════════════════════════════════════════════════════════════════

describe('rockbox mass-storage preset forwards default contentPaths', () => {
  it('runDiagnostics receives rockbox preset Music + Video/Movies + Video/Shows paths', async () => {
    const tmpDevice = mkdtempSync(join(tmpdir(), 'podkit-doctor-ac6-'));
    try {
      const deviceConfig: DeviceConfig = { type: 'rockbox', path: tmpDevice };
      const ctx = makeContext({
        device: 'rb',
        devices: { rb: deviceConfig },
      });
      const { out } = makeOut();
      const capture: FakeCoreCapture = {};

      const fakeCore = makeFakeCore({ capture, reportChecks: [] });

      await runWithContext(ctx, () =>
        runAction(out, () =>
          runDoctorDiagnostics(
            tmpDevice,
            deviceConfig,
            out,
            {},
            { loadCore: async () => fakeCore as typeof import('@podkit/core') }
          )
        )
      );

      expect(capture.deviceType).toBe('mass-storage');
      expect(capture.contentPaths).toBeDefined();
      // Rockbox preset uses DEFAULT_CONTENT_PATHS — same as generic.
      expect(capture.contentPaths!.musicDir).toBe('Music');
      expect(capture.contentPaths!.moviesDir).toBe('Video/Movies');
      expect(capture.contentPaths!.tvShowsDir).toBe('Video/Shows');
    } finally {
      rmSync(tmpDevice, { recursive: true, force: true });
    }
  });

  it('echo-mini preset overrides musicDir to empty (device root)', async () => {
    const tmpDevice = mkdtempSync(join(tmpdir(), 'podkit-doctor-ac6-echo-'));
    try {
      const deviceConfig: DeviceConfig = { type: 'echo-mini', path: tmpDevice };
      const ctx = makeContext({
        device: 'echo',
        devices: { echo: deviceConfig },
      });
      const { out } = makeOut();
      const capture: FakeCoreCapture = {};

      const fakeCore = makeFakeCore({ capture, reportChecks: [] });

      await runWithContext(ctx, () =>
        runAction(out, () =>
          runDoctorDiagnostics(
            tmpDevice,
            deviceConfig,
            out,
            {},
            { loadCore: async () => fakeCore as typeof import('@podkit/core') }
          )
        )
      );

      // Echo Mini preset uses `musicDir: ''` (device root) — distinguishes
      // the rockbox/generic path from the echo-mini path.
      expect(capture.contentPaths).toBeDefined();
      expect(capture.contentPaths!.musicDir).toBe('');
      expect(capture.contentPaths!.moviesDir).toBe('Video/Movies');
      expect(capture.contentPaths!.tvShowsDir).toBe('Video/Shows');
    } finally {
      rmSync(tmpDevice, { recursive: true, force: true });
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// --repair artwork-rebuild on a mass-storage device → INCOMPATIBLE_DEVICE_TYPE.
// ═════════════════════════════════════════════════════════════════════════════

describe('--repair iPod-only check on mass-storage device', () => {
  it('fails with INCOMPATIBLE_DEVICE_TYPE + exit 1 (artwork-rebuild with -c provided)', async () => {
    const tmpDevice = mkdtempSync(join(tmpdir(), 'podkit-doctor-ac8-'));
    try {
      // Register the named music collection so the COLLECTION_REQUIRED gate
      // (which fires BEFORE device resolution) passes, and the action
      // proceeds to device resolution + the applicable-types check that AC
      // #8 exercises.
      const ctx = makeContext({
        device: 'echo',
        devices: { echo: { type: 'echo-mini', path: tmpDevice } },
      });
      ctx.config.music = { main: { path: '/tmp/fake-music' } };
      const { out, stdout, exitCode } = makeOut();

      // The real registry's artwork-rebuild is iPod-only. Provide a stub
      // registry that mirrors that constraint so the action's
      // applicable-types gate fires.
      const fakeCore = makeFakeCore({
        registry: [
          {
            id: 'artwork-rebuild',
            name: 'Artwork rebuild',
            applicableTo: ['ipod'],
            scope: 'database-health',
            repair: {
              description: 'rebuild artwork from source',
              requirements: ['source-collection'],
              run: async () => ({ success: true, summary: 'never reached' }),
            },
          },
        ],
      });

      await runAction1(ctx, out, () =>
        runDoctorAction({ repair: 'artwork-rebuild', collection: 'main' }, out, {
          loadCore: async () => fakeCore as typeof import('@podkit/core'),
          getDeviceManager: () => fakeManager(),
        })
      );

      expectCliError(stdout, exitCode, {
        code: DoctorErrorCodes.INCOMPATIBLE_DEVICE_TYPE,
        error: /not available for mass-storage devices/,
        exitCode: 1,
      });
    } finally {
      rmSync(tmpDevice, { recursive: true, force: true });
    }
  });

  it('also fires for orphan-files (iPod-only, no source-collection requirement)', async () => {
    // Smoke companion: orphan-files needs neither a collection nor a
    // database; the only thing standing between this request and success
    // is the applicable-types gate. Pins that the gate works without any
    // adjacent validation noise.
    const tmpDevice = mkdtempSync(join(tmpdir(), 'podkit-doctor-ac8-orph-'));
    try {
      const ctx = makeContext({
        device: 'echo',
        devices: { echo: { type: 'echo-mini', path: tmpDevice } },
      });
      const { out, stdout, exitCode } = makeOut();

      const fakeCore = makeFakeCore({
        registry: [
          {
            id: 'orphan-files',
            name: 'Orphan files',
            applicableTo: ['ipod'],
            scope: 'database-health',
            repair: {
              description: 'delete orphans',
              requirements: ['writable-device'],
              run: async () => ({ success: true, summary: 'never reached' }),
            },
          },
        ],
      });

      await runAction1(ctx, out, () =>
        runDoctorAction({ repair: 'orphan-files' }, out, {
          loadCore: async () => fakeCore as typeof import('@podkit/core'),
          getDeviceManager: () => fakeManager(),
        })
      );

      expectCliError(stdout, exitCode, {
        code: DoctorErrorCodes.INCOMPATIBLE_DEVICE_TYPE,
        error: /not available for mass-storage devices/,
        exitCode: 1,
      });
    } finally {
      rmSync(tmpDevice, { recursive: true, force: true });
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// --repair orphan-files-mass-storage on iPod → INCOMPATIBLE_DEVICE_TYPE.
// The applicable-types gate is symmetric: iPod-only repairs on mass-storage
// devices are rejected, AND mass-storage-only repairs on iPod devices are
// rejected. Both paths surface the same error code.
// ═════════════════════════════════════════════════════════════════════════════

describe('--repair orphan-files-mass-storage on iPod device', () => {
  it('rejects with INCOMPATIBLE_DEVICE_TYPE — mass-storage-only repairs cannot target iPod', async () => {
    const tmpDevice = mkdtempSync(join(tmpdir(), 'podkit-doctor-cross-type-'));
    try {
      const deviceConfig: DeviceConfig = { type: 'ipod', path: tmpDevice };
      const ctx = makeContext({
        device: 'ipoddev',
        devices: { ipoddev: deviceConfig },
      });
      const { out, stdout, exitCode } = makeOut();

      const fakeCore = makeFakeCore({
        registry: [
          {
            id: 'orphan-files-mass-storage',
            name: 'Mass-storage orphans',
            applicableTo: ['mass-storage'],
            scope: 'database-health',
            repair: {
              description: 'delete orphan files',
              requirements: ['writable-device', 'database'],
              run: async () => ({ success: true, summary: 'fake-cleared' }),
            },
          },
        ],
      });

      await runAction1(ctx, out, () =>
        runDoctorAction({ repair: 'orphan-files-mass-storage' }, out, {
          loadCore: async () => fakeCore as typeof import('@podkit/core'),
          getDeviceManager: () => fakeManager(),
        })
      );

      const text = stdout.text();
      const payload = JSON.parse(text) as { success?: boolean; code?: string; error?: string };
      expect(payload.success).toBe(false);
      expect(payload.code).toBe(DoctorErrorCodes.INCOMPATIBLE_DEVICE_TYPE);
      expect(payload.error).toMatch(/not available for iPod/);
      expect(exitCode.get()).not.toBe(0);
    } finally {
      rmSync(tmpDevice, { recursive: true, force: true });
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// deviceModel field in JSON.
// ═════════════════════════════════════════════════════════════════════════════

describe('deviceModel field rendering', () => {
  it('iPod: deviceModel resolves to the libgpod model name from getInfo()', async () => {
    const ctx = makeContext({ device: 'ipod' });
    const { out, stdout } = makeOut();
    const fakeCore = makeFakeCore({
      reportDeviceModel: 'iPod nano 4th generation 8GB Silver',
      reportChecks: [],
    });

    await runWithContext(ctx, () =>
      runAction(out, () =>
        runDoctorDiagnostics(
          '/tmp/ipod-ac10',
          undefined,
          out,
          {},
          {
            loadCore: async () => fakeCore as typeof import('@podkit/core'),
            getDeviceManager: () => fakeManager(),
          }
        )
      )
    );

    const payload = stdout.json<{ deviceType: string; deviceModel: string }>();
    expect(payload.deviceType).toBe('ipod');
    expect(payload.deviceModel).toBe('iPod nano 4th generation 8GB Silver');
  });

  it('mass-storage: deviceModel resolves to the preset display name (e.g. "Echo Mini")', async () => {
    const tmpDevice = mkdtempSync(join(tmpdir(), 'podkit-doctor-ac10-ms-'));
    try {
      const deviceConfig: DeviceConfig = { type: 'echo-mini', path: tmpDevice };
      const ctx = makeContext({
        device: 'echo',
        devices: { echo: deviceConfig },
      });
      const { out, stdout } = makeOut();
      const fakeCore = makeFakeCore({ reportChecks: [] });

      await runWithContext(ctx, () =>
        runAction(out, () =>
          runDoctorDiagnostics(
            tmpDevice,
            deviceConfig,
            out,
            {},
            { loadCore: async () => fakeCore as typeof import('@podkit/core') }
          )
        )
      );

      const payload = stdout.json<{ deviceType: string; deviceModel: string }>();
      expect(payload.deviceType).toBe('mass-storage');
      expect(payload.deviceModel).toBe('Echo Mini');
    } finally {
      rmSync(tmpDevice, { recursive: true, force: true });
    }
  });

  it('mass-storage: rockbox preset deviceModel resolves to "Rockbox"', async () => {
    const tmpDevice = mkdtempSync(join(tmpdir(), 'podkit-doctor-ac10-rb-'));
    try {
      const deviceConfig: DeviceConfig = { type: 'rockbox', path: tmpDevice };
      const ctx = makeContext({
        device: 'rb',
        devices: { rb: deviceConfig },
      });
      const { out, stdout } = makeOut();
      const fakeCore = makeFakeCore({ reportChecks: [] });

      await runWithContext(ctx, () =>
        runAction(out, () =>
          runDoctorDiagnostics(
            tmpDevice,
            deviceConfig,
            out,
            {},
            { loadCore: async () => fakeCore as typeof import('@podkit/core') }
          )
        )
      );

      const payload = stdout.json<{ deviceModel: string }>();
      expect(payload.deviceModel).toBe('Rockbox');
    } finally {
      rmSync(tmpDevice, { recursive: true, force: true });
    }
  });

  it('mass-storage: generic preset deviceModel resolves to "Generic mass-storage"', async () => {
    const tmpDevice = mkdtempSync(join(tmpdir(), 'podkit-doctor-ac10-gen-'));
    try {
      const deviceConfig: DeviceConfig = { type: 'generic', path: tmpDevice };
      const ctx = makeContext({
        device: 'gen',
        devices: { gen: deviceConfig },
      });
      const { out, stdout } = makeOut();
      const fakeCore = makeFakeCore({ reportChecks: [] });

      await runWithContext(ctx, () =>
        runAction(out, () =>
          runDoctorDiagnostics(
            tmpDevice,
            deviceConfig,
            out,
            {},
            { loadCore: async () => fakeCore as typeof import('@podkit/core') }
          )
        )
      );

      const payload = stdout.json<{ deviceModel: string }>();
      expect(payload.deviceModel).toBe('Generic mass-storage');
    } finally {
      rmSync(tmpDevice, { recursive: true, force: true });
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Doctor against an unrecognised device path → DEVICE_NOT_RESOLVED.
// ═════════════════════════════════════════════════════════════════════════════

describe('doctor against an unrecognised device path', () => {
  it('fails with DEVICE_NOT_RESOLVED when -d points at a non-existent path', async () => {
    // /this/path/does/not/exist is a fresh randomly-generated path the device
    // resolver cannot reconcile. parseCliDeviceArg treats it as a path arg,
    // resolveEffectiveDevice surfaces it as a cliPath with no matching
    // device config, resolveDevicePath returns no `path` (because the
    // platform manager has no UUID for it), and the doctor's resolveDevice
    // returns { error }, which runDoctorAction throws as DEVICE_NOT_RESOLVED.
    const ctx = makeContext({ device: '/this/path/does/not/exist' });
    const { out, stdout, exitCode } = makeOut();
    const fakeCore = makeFakeCore({ reportChecks: [] });

    await runAction1(ctx, out, () =>
      runDoctorAction({}, out, {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
        getDeviceManager: () =>
          fakeManager({
            // Force the manager to return no matching device — guarantees
            // resolveDevicePath surfaces its no-path branch.
            findIpodDevices: async () => [],
            getUuidForMountPoint: async () => null,
          }),
      })
    );

    const payload = stdout.json<{ success: boolean; code?: string; error?: string }>();
    expect(payload.success).toBe(false);
    expect(payload.code).toBe(DoctorErrorCodes.DEVICE_NOT_RESOLVED);
    expect(exitCode.get()).toBe(1);
  });
});
