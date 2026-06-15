/**
 * Flag-matrix coverage for `podkit doctor` (TASK-307, m-19 Phase 5b).
 *
 * This file pins the 17 ACs from `task-307`. Each describe block names the AC
 * it covers. The runner extraction (`runDoctorAction` in `doctor.ts`) lets us
 * exercise the action's flag-validation logic in-process — no live CLI
 * subprocess, no real libgpod, no real FFmpeg invocation.
 *
 * Cross-cut: where TASK-307's original wording predates TASK-308's
 * "warn → unhealthy → exit 2" decision (notably AC #4's exit-code semantics
 * for `--repair` validation), we pin against the locked-in decision recorded
 * in agents/testing.md §"Doctor exit-code & overall-health semantics".
 *
 * @see backlog/tasks/task-307 - Doctor-CLI-flag-matrix.md
 * @see packages/podkit-cli/src/commands/doctor-exit-code.test.ts — TASK-308 sibling
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runDoctorAction,
  runDoctorDiagnostics,
  DoctorErrorCodes,
  type DoctorDeps,
} from './doctor.js';
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
} from '../config/index.js';
import type { DeviceManager } from '@podkit/core';

// ── Shared fixtures & helpers ──────────────────────────────────────────────

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
  docsUrl?: string;
}

interface FakeRepairResult {
  success: boolean;
  summary: string;
  details?: Record<string, unknown>;
}

interface FakeCheckDefinition {
  id: string;
  name: string;
  scope?: 'system' | 'device-readiness' | 'database-health';
  applicableTo?: ReadonlyArray<'ipod' | 'mass-storage'>;
  repair?: {
    description: string;
    requirements: ReadonlyArray<'source-collection' | 'writable-device'>;
    run: (
      ctx: { mountPoint: string; deviceType: string; adapters: unknown[] },
      options?: { dryRun?: boolean }
    ) => Promise<FakeRepairResult>;
  };
}

interface FakeReadinessStage {
  stage: 'usb' | 'partition' | 'filesystem' | 'mount' | 'sysinfo' | 'database';
  status: CheckStatus;
  summary: string;
  details?: Record<string, unknown>;
}

interface FakeReadiness {
  level:
    | 'ready'
    | 'needs-repair'
    | 'needs-init'
    | 'needs-format'
    | 'needs-partition'
    | 'hardware-error'
    | 'unsupported'
    | 'unknown';
  stages: FakeReadinessStage[];
  unsupported?: import('@podkit/core').ReadinessUnsupportedReason;
}

interface FakeCoreOptions {
  /** Checks to register; `getDiagnosticCheck` resolves against this list. */
  registry?: FakeCheckDefinition[];
  /** Report returned by `core.runDiagnostics`. */
  report?: {
    checks: FakeCheckResult[];
    healthy?: boolean;
    /** Capture the scopes argument forwarded to runDiagnostics. */
    captureScopes?: (
      scopes: ReadonlyArray<'system' | 'device-readiness' | 'database-health'>
    ) => void;
  };
  /** Result returned from `core.checkReadiness`. */
  readiness?: FakeReadiness;
  /**
   * Spy hook for subprocess-shaped operations the doctor would otherwise
   * trigger transitively (FFmpeg encoder probe, USB descriptor read).
   * Tests assert this is NEVER called when `--no-system` is in effect.
   */
  onProbe?: (kind: 'ffmpeg' | 'usb' | 'libusb') => void;
}

function makeContext(
  opts: { device?: string; json?: boolean; collections?: string[] } = {}
): CliContext {
  const music: PodkitConfig['music'] = {};
  for (const name of opts.collections ?? []) {
    music[name] = { path: `/tmp/${name}` };
  }
  const config: PodkitConfig = {
    quality: 'medium',
    artwork: true,
    tips: true,
    transforms: DEFAULT_TRANSFORMS_CONFIG,
    videoTransforms: DEFAULT_VIDEO_TRANSFORMS_CONFIG,
    devices: {},
    music,
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
 * Build a fake `@podkit/core` module with just the surface `runDoctorAction`
 * and its callees touch. Everything else is undefined — if we accidentally
 * grow a new core dependency, the test fails loudly with a clear error.
 */
function makeFakeCore(opts: FakeCoreOptions = {}): unknown {
  const registry = opts.registry ?? [];
  const checkIds = registry.map((c) => c.id);

  const fakeIpod = {
    getInfo: () => ({
      device: {
        modelName: 'iPod nano 2nd generation',
        modelNumber: 'MA477',
        generation: 'nano_2g',
        capacity: 4,
      },
    }),
    close: () => {},
  };

  const fakeCapabilities = {
    artworkSources: ['embedded', 'database'] as const,
    artworkMaxResolution: 320,
    supportedAudioCodecs: ['aac', 'mp3', 'alac'] as const,
    supportsVideo: false,
    audioNormalization: 'soundcheck' as const,
    supportsAlbumArtistBrowsing: false,
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
    // Post-T5: doctor calls discoverConnectedDevices to get a DiscoveredDevice
    // before driving checkReadiness. The fake returns empty so doctor falls
    // back to its synthetic ipodFromBlock path.
    discoverConnectedDevices: async () => [],
    ipodFromBlock: (block: unknown) => ({ kind: 'ipod', block, matchedBy: 'block-only' }),
    checkReadiness: async () =>
      opts.readiness ?? {
        level: 'ready',
        stages: [
          { stage: 'usb', status: 'pass', summary: 'connected' },
          { stage: 'partition', status: 'pass', summary: 'ok' },
          { stage: 'filesystem', status: 'pass', summary: 'ok' },
          { stage: 'mount', status: 'pass', summary: 'ok' },
          { stage: 'sysinfo', status: 'pass', summary: 'ok' },
          { stage: 'database', status: 'pass', summary: 'ok' },
        ],
      },
    resolveUsbDeviceFromPath: async () => {
      opts.onProbe?.('usb');
      return null;
    },
    identifyCapabilities: () => fakeCapabilities,
    IpodDeviceAdapter: FakeIpodDeviceAdapter,
    getDiagnosticCheck: (id: string) => registry.find((c) => c.id === id),
    getDiagnosticCheckIds: () => checkIds,
    // Dispatch surface used by the unified `--repair orphan-files` /
    // `--repair debris-files` IDs. The fake core treats every registered
    // check as 1:1 — tests register a check at the exact ID they pass.
    PUBLIC_REPAIR_IDS: checkIds,
    resolvePublicRepairId: (publicId: string) => publicId,
    getRepairCheck: (id: string) => registry.find((c) => c.id === id),
    getRepairCheckForValidation: (id: string) => registry.find((c) => c.id === id),
    runDiagnostics: async (input: {
      scopes?: ReadonlyArray<'system' | 'device-readiness' | 'database-health'>;
      mountPoint: string;
      deviceType: string;
    }) => {
      const scopes = input.scopes ?? ['system', 'device-readiness', 'database-health'];
      opts.report?.captureScopes?.(scopes);
      // Trigger probe spies only when the scope is actually requested.
      if (scopes.includes('system')) opts.onProbe?.('ffmpeg');
      const allChecks = opts.report?.checks ?? [];
      const checks = allChecks.filter((c) => scopes.includes(c.scope));
      const healthy =
        opts.report?.healthy ?? checks.every((c) => c.status === 'pass' || c.status === 'skip');
      return {
        mountPoint: input.mountPoint,
        deviceModel: 'Test',
        deviceType: input.deviceType,
        checks,
        healthy,
      };
    },
    IpodDatabase: {
      open: async () => fakeIpod,
    },
    normalizeContentPaths: (overrides: object) => ({
      musicDir: 'Music',
      moviesDir: 'Movies',
      tvShowsDir: 'TV Shows',
      ...overrides,
    }),
  };
}

/** Compose runWithContext + runAction the way production does. */
async function runAction1(
  ctx: CliContext,
  out: OutputContext,
  fn: () => Promise<void>
): Promise<void> {
  await runWithContext(ctx, () => runAction(out, fn));
}

function fakeCheckFor(
  id: string,
  overrides: Partial<FakeCheckDefinition> = {}
): FakeCheckDefinition {
  return {
    id,
    name: id,
    ...overrides,
  };
}

function makeSourceCollectionRepair(): FakeCheckDefinition {
  return fakeCheckFor('artwork-rebuild', {
    repair: {
      description: 'Rebuild artwork from source',
      requirements: ['source-collection'],
      run: async () => ({ success: true, summary: 'Rebuilt 0 entries' }),
    },
  });
}

function makeSystemRepair(id = 'udev-rule'): FakeCheckDefinition {
  return fakeCheckFor(id, {
    scope: 'system',
    repair: {
      description: 'Install udev rule',
      requirements: [],
      run: async () => ({
        success: true,
        summary: 'Udev rule installed',
        details: { rulePath: '/etc/udev/rules.d/90-podkit.rules' },
      }),
    },
  });
}

function makeWritableDeviceRepair(id = 'sysinfo-extended'): FakeCheckDefinition {
  return fakeCheckFor(id, {
    repair: {
      description: 'Write SysInfoExtended',
      requirements: ['writable-device'],
      run: async () => ({ success: true, summary: 'Wrote SysInfoExtended' }),
    },
  });
}

function makeIpodOnlyRepair(id = 'orphan-files'): FakeCheckDefinition {
  return fakeCheckFor(id, {
    applicableTo: ['ipod'],
    repair: {
      description: 'Delete orphan files',
      requirements: ['writable-device'],
      run: async () => ({ success: true, summary: 'Deleted orphans' }),
    },
  });
}

function makeNoRepairCheck(id: string): FakeCheckDefinition {
  return fakeCheckFor(id, {
    // No `.repair` field — exercises CHECK_NOT_REPAIRABLE.
  });
}

// ── AC #1: --repair without -d fails with DEVICE_REQUIRED ──────────────────

describe('AC #1: --repair without -d', () => {
  it('fails with "Repair requires an explicit device" + exit 1', async () => {
    const ctx = makeContext({ device: undefined });
    const { out, stdout, exitCode } = makeOut();
    const fakeCore = makeFakeCore({ registry: [makeSourceCollectionRepair()] });

    await runAction1(ctx, out, () =>
      runDoctorAction({ repair: 'artwork-rebuild' }, out, {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
      })
    );

    expectCliError(stdout, exitCode, {
      code: DoctorErrorCodes.DEVICE_REQUIRED,
      error: /Repair requires an explicit device/,
      exitCode: 1,
    });
  });
});

// ── AC #2: --repair artwork-rebuild without -c → COLLECTION_REQUIRED ───────

describe('AC #2: --repair artwork-rebuild without -c', () => {
  it('fails with "requires a source collection" + lists available collections', async () => {
    const ctx = makeContext({ device: 'ipod', collections: ['main', 'extras'] });
    const { out, stdout, exitCode } = makeOut();
    const fakeCore = makeFakeCore({ registry: [makeSourceCollectionRepair()] });

    await runAction1(ctx, out, () =>
      runDoctorAction({ repair: 'artwork-rebuild' }, out, {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
      })
    );

    const payload = expectCliError(stdout, exitCode, {
      code: DoctorErrorCodes.COLLECTION_REQUIRED,
      error: /requires a source collection/,
      exitCode: 1,
    });
    expect(payload.error).toContain('main');
    expect(payload.error).toContain('extras');
    expect(payload.details).toMatchObject({
      checkId: 'artwork-rebuild',
      available: ['main', 'extras'],
    });
  });

  it('omits the "Available collections" hint when config has none', async () => {
    const ctx = makeContext({ device: 'ipod', collections: [] });
    const { out, stdout, exitCode } = makeOut();
    const fakeCore = makeFakeCore({ registry: [makeSourceCollectionRepair()] });

    await runAction1(ctx, out, () =>
      runDoctorAction({ repair: 'artwork-rebuild' }, out, {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
      })
    );

    const payload = expectCliError(stdout, exitCode, {
      code: DoctorErrorCodes.COLLECTION_REQUIRED,
      exitCode: 1,
    });
    expect(payload.error).not.toContain('Available collections');
    expect(payload.details).toMatchObject({ available: [] });
  });
});

// ── AC #3: --repair with an unknown check ID → UNKNOWN_CHECK ───────────────

describe('AC #3: --repair with an unknown check ID', () => {
  it('fails with "Unknown check ID" and lists all valid IDs', async () => {
    const ctx = makeContext({ device: 'ipod' });
    const { out, stdout, exitCode } = makeOut();
    // Mimic a runtime case where `--repair` bypasses commander's choices
    // (e.g. a known ID is removed from the registry between releases).
    const fakeCore = makeFakeCore({
      registry: [makeSystemRepair('udev-rule'), makeSourceCollectionRepair()],
    });

    await runAction1(ctx, out, () =>
      runDoctorAction({ repair: 'does-not-exist' as never }, out, {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
      })
    );

    const payload = expectCliError(stdout, exitCode, {
      code: DoctorErrorCodes.UNKNOWN_CHECK,
      error: /Unknown check ID/,
      exitCode: 1,
    });
    expect(payload.error).toContain('udev-rule');
    expect(payload.error).toContain('artwork-rebuild');
    expect(payload.details).toMatchObject({
      checkId: 'does-not-exist',
      available: ['udev-rule', 'artwork-rebuild'],
    });
  });
});

// ── AC #4: --repair with check that has no auto-repair → CHECK_NOT_REPAIRABLE
// Per TASK-308 the exit code for any CliError is 1 (REPAIR_FAILED is 1, all
// repair-validation errors are 1). Warn-counts-as-unhealthy (exit 2) does not
// apply to repair validation — that's the diagnostic path.

describe('AC #4: --repair with check that does not support auto-repair', () => {
  it('fails with "does not support automatic repair" + exit 1', async () => {
    const ctx = makeContext({ device: 'ipod' });
    const { out, stdout, exitCode } = makeOut();
    const fakeCore = makeFakeCore({ registry: [makeNoRepairCheck('detect-only')] });

    await runAction1(ctx, out, () =>
      runDoctorAction({ repair: 'detect-only' as never }, out, {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
      })
    );

    expectCliError(stdout, exitCode, {
      code: DoctorErrorCodes.CHECK_NOT_REPAIRABLE,
      error: /does not support automatic repair/,
      exitCode: 1,
    });
  });
});

// ── AC #5: --repair not applicable to device type → INCOMPATIBLE_DEVICE_TYPE

describe('AC #5: --repair check not applicable to device type', () => {
  it('iPod-only repair on mass-storage device fails with INCOMPATIBLE_DEVICE_TYPE', async () => {
    // Set up the device manager stub. The config registers a named device
    // 'echo' pointing at a temp dir; parseCliDeviceArg + resolveEffectiveDevice
    // then resolve '-d echo' to that device (type=echo-mini), and
    // resolveDevice returns deviceConfig={type:'echo-mini'}. The action's
    // isMassStorage check then trips the INCOMPATIBLE_DEVICE_TYPE branch.
    const tmpDevice = mkdtempSync(join(tmpdir(), 'podkit-doctor-ac5-'));
    try {
      const ctx = makeContext({ device: 'echo' });
      ctx.config.devices = { echo: { type: 'echo-mini', path: tmpDevice } };

      const { out, stdout, exitCode } = makeOut();
      const orphanRepair = makeIpodOnlyRepair('orphan-files');
      const fakeCore = makeFakeCore({ registry: [orphanRepair] });
      const managerStub = fakeManager();

      await runAction1(ctx, out, () =>
        runDoctorAction({ repair: 'orphan-files', collection: undefined }, out, {
          loadCore: async () => fakeCore as typeof import('@podkit/core'),
          getDeviceManager: () => managerStub,
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

// ── AC #6: --repair --dry-run → "Dry run:" + RepairOutput, no mutations ────

describe('AC #6: --repair --dry-run', () => {
  it('routes through runSystemRepair with dryRun=true; no mutations performed', async () => {
    const ctx = makeContext({ json: false });
    const { out, stdout, stderr, exitCode } = makeOut('text');

    let repairRunCount = 0;
    let observedDryRun: boolean | undefined;
    const udev = makeSystemRepair('udev-rule');
    udev.repair!.run = async (_ctx, options) => {
      repairRunCount += 1;
      observedDryRun = options?.dryRun;
      // A real udev rule repair would `writeFileSync('/etc/udev/...')` here.
      // The stub never writes; that's exactly the assertion: dry-run skips
      // mutation, the test confirms no underlying mutation primitives fire.
      return { success: true, summary: 'Would install udev rule (dry run)' };
    };
    const fakeCore = makeFakeCore({ registry: [udev] });

    await runAction1(ctx, out, () =>
      runDoctorAction({ repair: 'udev-rule', dryRun: true }, out, {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
      })
    );

    expect(repairRunCount).toBe(1);
    expect(observedDryRun).toBe(true);
    expect(stdout.text()).toContain('Dry run:');
    expect(stdout.text()).toContain('Would install udev rule');
    // Successful dry-run leaves exit code untouched (0).
    expect(exitCode.get()).toBeUndefined();
    // No stderr noise on the happy path.
    expect(stderr.text()).toBe('');
  });
});

// ── AC #7: --repair --json → only the RepairOutput JSON document on stdout ─

describe('AC #7: --repair --json shape', () => {
  it('emits exactly one JSON document with success/summary/checkId/dryRun/details', async () => {
    const ctx = makeContext({ json: true });
    const { out, stdout, stderr } = makeOut('json');

    const udev = makeSystemRepair('udev-rule');
    udev.repair!.run = async () => ({
      success: true,
      summary: 'Udev rule installed',
      details: { rulePath: '/etc/udev/rules.d/90-podkit.rules', wrote: 1 },
    });
    const fakeCore = makeFakeCore({ registry: [udev] });

    await runAction1(ctx, out, () =>
      runDoctorAction({ repair: 'udev-rule', dryRun: false }, out, {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
      })
    );

    // Parses cleanly — single document, no trailing text.
    const payload = stdout.json<{
      success: boolean;
      summary: string;
      checkId: string;
      dryRun: boolean;
      details?: Record<string, unknown>;
    }>();
    expect(payload).toEqual({
      success: true,
      summary: 'Udev rule installed',
      checkId: 'udev-rule',
      dryRun: false,
      details: { rulePath: '/etc/udev/rules.d/90-podkit.rules', wrote: 1 },
    });

    // Stdout contains exactly one JSON document — no extra "Repairing..." etc.
    expect(stdout.text().trim().split('\n}').length).toBe(2);
    // stderr may carry progress lines, but for the system-repair path it
    // stays empty on success.
    expect(stderr.text()).toBe('');
  });

  it('dry-run JSON shape carries dryRun=true verbatim', async () => {
    const ctx = makeContext({ json: true });
    const { out, stdout } = makeOut('json');
    const udev = makeSystemRepair('udev-rule');
    udev.repair!.run = async () => ({
      success: true,
      summary: 'Would install udev rule (dry run)',
    });
    const fakeCore = makeFakeCore({ registry: [udev] });

    await runAction1(ctx, out, () =>
      runDoctorAction({ repair: 'udev-rule', dryRun: true }, out, {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
      })
    );

    const payload = stdout.json<{ dryRun: boolean }>();
    expect(payload.dryRun).toBe(true);
  });
});

// ── AC #8: --no-system: system checks absent + no system probes fire ───────

describe('AC #8: --no-system skips system-scope checks and their probes', () => {
  it('checks[] omits system-scope entries and the system probe spy is never called', async () => {
    const ctx = makeContext({ device: 'ipod' });
    const { out, stdout } = makeOut('json');
    const probeCalls: string[] = [];

    const fakeCore = makeFakeCore({
      report: {
        checks: [
          // The fakeCore filters by requested scope: scopes=['device']
          // ⇒ system checks dropped before `report.checks` is returned.
          {
            id: 'codec-encoders',
            name: 'FFmpeg encoders',
            status: 'pass',
            summary: 'AAC + libx264',
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
      },
      onProbe: (kind) => probeCalls.push(kind),
    });

    await runWithContext(ctx, () =>
      runAction(out, () =>
        runDoctorDiagnostics(
          '/tmp/ipod-test-ac8',
          undefined,
          out,
          { system: false },
          {
            loadCore: async () => fakeCore as typeof import('@podkit/core'),
            getDeviceManager: () => fakeManager(),
          }
        )
      )
    );

    const payload = stdout.json<{ checks: Array<{ id: string; status: string }> }>();
    expect(payload.checks.map((c) => c.id)).toEqual(['artwork-rebuild']);
    // ffmpeg-probe spy must never have been triggered.
    expect(probeCalls).not.toContain('ffmpeg');
  });
});

// ── AC #9: strict subset of checks[] when --no-system is set ───────────────

describe('AC #9: --no-system produces a strict subset of checks[]', () => {
  function makeChecksFixture(): FakeCheckResult[] {
    return [
      {
        id: 'codec-encoders',
        name: 'FFmpeg encoders',
        status: 'pass',
        summary: '',
        repairable: false,
        hasRepair: false,
        repairOnly: false,
        scope: 'system',
      },
      {
        id: 'inquiry-methods',
        name: 'Inquiry transports',
        status: 'pass',
        summary: '',
        repairable: false,
        hasRepair: false,
        repairOnly: false,
        scope: 'system',
      },
      {
        id: 'artwork-rebuild',
        name: 'Artwork DB',
        status: 'pass',
        summary: '',
        repairable: false,
        hasRepair: false,
        repairOnly: false,
        scope: 'database-health',
      },
    ];
  }

  it('without --no-system: checks[] contains all scopes; with --no-system: strictly fewer', async () => {
    const checksWithSystem = makeChecksFixture();
    const ctx1 = makeContext({ device: 'ipod' });
    const { out: out1, stdout: stdout1 } = makeOut('json');
    const fakeCore1 = makeFakeCore({ report: { checks: checksWithSystem } });
    await runWithContext(ctx1, () =>
      runAction(out1, () =>
        runDoctorDiagnostics(
          '/tmp/ipod-test-ac9a',
          undefined,
          out1,
          {},
          {
            loadCore: async () => fakeCore1 as typeof import('@podkit/core'),
            getDeviceManager: () => fakeManager(),
          }
        )
      )
    );
    const fullChecks = stdout1.json<{ checks: Array<{ id: string }> }>().checks;

    const checksNoSystem = makeChecksFixture();
    const ctx2 = makeContext({ device: 'ipod' });
    const { out: out2, stdout: stdout2 } = makeOut('json');
    const fakeCore2 = makeFakeCore({ report: { checks: checksNoSystem } });
    await runWithContext(ctx2, () =>
      runAction(out2, () =>
        runDoctorDiagnostics(
          '/tmp/ipod-test-ac9b',
          undefined,
          out2,
          { system: false },
          {
            loadCore: async () => fakeCore2 as typeof import('@podkit/core'),
            getDeviceManager: () => fakeManager(),
          }
        )
      )
    );
    const filteredChecks = stdout2.json<{ checks: Array<{ id: string }> }>().checks;

    expect(filteredChecks.length).toBeLessThan(fullChecks.length);
    // Every filtered check must also appear in the full set.
    for (const c of filteredChecks) {
      expect(fullChecks.find((f) => f.id === c.id)).toBeDefined();
    }
    // The two unused params keep TS happy and document the intent.
    expect(ctx1).toBeDefined();
    expect(ctx2).toBeDefined();
  });
});

// ── AC #10: --format csv emits orphan list as CSV; respects --no-system ────

describe('AC #10: --format csv on doctor (no --repair)', () => {
  it('outputs orphan files as CSV (path,size + one row per orphan)', async () => {
    const ctx = makeContext({ device: 'ipod' });
    const { out, stdout } = makeOut('text');

    const fakeCore = makeFakeCore({
      report: {
        checks: [
          {
            id: 'orphan-files',
            name: 'Orphans',
            status: 'warn',
            summary: '2 orphan files',
            repairable: true,
            hasRepair: true,
            repairOnly: false,
            scope: 'database-health',
            details: {
              orphans: [
                { path: '/iPod_Control/Music/F00/abc.mp3', size: 12345 },
                { path: '/iPod_Control/Music/F01/xyz with, comma.m4a', size: 67890 },
              ],
            },
          },
        ],
      },
    });

    await runWithContext(ctx, () =>
      runAction(out, () =>
        runDoctorDiagnostics(
          '/tmp/ipod-test-ac10',
          undefined,
          out,
          { format: 'csv' },
          {
            loadCore: async () => fakeCore as typeof import('@podkit/core'),
            getDeviceManager: () => fakeManager(),
          }
        )
      )
    );

    const lines = stdout.lines();
    expect(lines[0]).toBe('path,size');
    expect(lines[1]).toBe('/iPod_Control/Music/F00/abc.mp3,12345');
    // Comma-bearing path must be CSV-escaped.
    expect(lines[2]).toBe('"/iPod_Control/Music/F01/xyz with, comma.m4a",67890');
  });

  it('respects --no-system: CSV still emitted, system probes not invoked', async () => {
    const ctx = makeContext({ device: 'ipod' });
    const { out, stdout } = makeOut('text');
    const probeCalls: string[] = [];

    const fakeCore = makeFakeCore({
      report: {
        checks: [
          {
            id: 'orphan-files',
            name: 'Orphans',
            status: 'warn',
            summary: '1 orphan file',
            repairable: true,
            hasRepair: true,
            repairOnly: false,
            scope: 'database-health',
            details: {
              orphans: [{ path: '/iPod_Control/Music/F00/abc.mp3', size: 12345 }],
            },
          },
          {
            id: 'codec-encoders',
            name: 'FFmpeg',
            status: 'pass',
            summary: 'ok',
            repairable: false,
            hasRepair: false,
            repairOnly: false,
            scope: 'system',
          },
        ],
      },
      onProbe: (k) => probeCalls.push(k),
    });

    await runWithContext(ctx, () =>
      runAction(out, () =>
        runDoctorDiagnostics(
          '/tmp/ipod-test-ac10b',
          undefined,
          out,
          { format: 'csv', system: false },
          {
            loadCore: async () => fakeCore as typeof import('@podkit/core'),
            getDeviceManager: () => fakeManager(),
          }
        )
      )
    );

    const lines = stdout.lines();
    expect(lines[0]).toBe('path,size');
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(probeCalls).not.toContain('ffmpeg');
  });
});

// ── AC #11: --format csv with no orphans → empty (no error) ────────────────

describe('AC #11: --format csv with no orphans', () => {
  it('produces empty output (no header, no rows); does not error', async () => {
    const ctx = makeContext({ device: 'ipod' });
    const { out, stdout, exitCode } = makeOut('text');

    const fakeCore = makeFakeCore({
      report: {
        checks: [
          {
            id: 'orphan-files',
            name: 'Orphans',
            status: 'pass',
            summary: 'No orphan files',
            repairable: false,
            hasRepair: false,
            repairOnly: false,
            scope: 'database-health',
            details: { orphans: [] },
          },
        ],
      },
    });

    await runWithContext(ctx, () =>
      runAction(out, () =>
        runDoctorDiagnostics(
          '/tmp/ipod-test-ac11',
          undefined,
          out,
          { format: 'csv' },
          {
            loadCore: async () => fakeCore as typeof import('@podkit/core'),
            getDeviceManager: () => fakeManager(),
          }
        )
      )
    );

    expect(stdout.text()).toBe('');
    expect(exitCode.get()).toBeUndefined();
  });
});

// ── Mass-storage CSV export (drift coverage, not part of TASK-307 ACs) ────
//
// The original CSV handling was wired only to the iPod path: the mass-
// storage branch in `runDoctorDiagnostics` returned early before the CSV
// guard, AND the iPod CSV guard looked up `id === 'orphan-files'` which
// can't match a mass-storage report (which carries `orphan-files-mass-storage`).
// Result: `podkit doctor -d echomini --format csv` printed nothing even when
// the device had orphans. These tests pin the now-symmetric behaviour.

describe('--format csv on a mass-storage device (echo-mini)', () => {
  it('emits orphans from orphan-files-mass-storage with the same path,size CSV shape', async () => {
    const tmpDevice = mkdtempSync(join(tmpdir(), 'podkit-doctor-ms-csv-'));
    try {
      const ctx = makeContext({ device: 'echo' });
      ctx.config.devices = { echo: { type: 'echo-mini', path: tmpDevice } };
      const { out, stdout } = makeOut('text');

      const fakeCore = makeFakeCore({
        report: {
          checks: [
            {
              // Mass-storage variant — the iPod-side `orphan-files` check is
              // filtered out by deviceType, so only this ID appears.
              id: 'orphan-files-mass-storage',
              name: 'Orphan Files (Mass Storage)',
              status: 'warn',
              summary: '2 orphan files',
              repairable: true,
              hasRepair: true,
              repairOnly: false,
              scope: 'database-health',
              details: {
                orphans: [
                  { path: '/Music/Artist/Album/track1.flac', size: 1024 },
                  { path: '/Music/Artist/Album/track, with comma.flac', size: 2048 },
                ],
              },
            },
          ],
        },
      });

      await runWithContext(ctx, () =>
        runAction(out, () =>
          runDoctorDiagnostics(
            tmpDevice,
            { type: 'echo-mini', path: tmpDevice },
            out,
            { format: 'csv' },
            {
              loadCore: async () => fakeCore as typeof import('@podkit/core'),
              getDeviceManager: () => fakeManager(),
            }
          )
        )
      );

      const lines = stdout.lines();
      expect(lines[0]).toBe('path,size');
      expect(lines[1]).toBe('/Music/Artist/Album/track1.flac,1024');
      // Comma-bearing path is CSV-escaped (shared escape helper).
      expect(lines[2]).toBe('"/Music/Artist/Album/track, with comma.flac",2048');
    } finally {
      rmSync(tmpDevice, { recursive: true, force: true });
    }
  });

  it('emits empty output when the mass-storage report has no orphans', async () => {
    const tmpDevice = mkdtempSync(join(tmpdir(), 'podkit-doctor-ms-csv-empty-'));
    try {
      const ctx = makeContext({ device: 'echo' });
      ctx.config.devices = { echo: { type: 'echo-mini', path: tmpDevice } };
      const { out, stdout, exitCode } = makeOut('text');

      const fakeCore = makeFakeCore({
        report: {
          checks: [
            {
              id: 'orphan-files-mass-storage',
              name: 'Orphan Files (Mass Storage)',
              status: 'pass',
              summary: 'No orphan files',
              repairable: false,
              hasRepair: false,
              repairOnly: false,
              scope: 'database-health',
              details: { orphans: [] },
            },
          ],
        },
      });

      await runWithContext(ctx, () =>
        runAction(out, () =>
          runDoctorDiagnostics(
            tmpDevice,
            { type: 'echo-mini', path: tmpDevice },
            out,
            { format: 'csv' },
            {
              loadCore: async () => fakeCore as typeof import('@podkit/core'),
              getDeviceManager: () => fakeManager(),
            }
          )
        )
      );

      // No header on an empty list — symmetrical with the iPod path's AC #11.
      expect(stdout.text()).toBe('');
      expect(exitCode.get()).toBeUndefined();
    } finally {
      rmSync(tmpDevice, { recursive: true, force: true });
    }
  });
});

// ── AC #12: --json suppresses human text; stdout is exactly one JSON doc ───

describe('AC #12: --json output is exactly one JSON document', () => {
  it('produces no plaintext "podkit doctor —" header on stdout', async () => {
    const ctx = makeContext({ device: 'ipod' });
    const { out, stdout } = makeOut('json');
    const fakeCore = makeFakeCore({
      report: {
        checks: [
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
      },
    });

    await runWithContext(ctx, () =>
      runAction(out, () =>
        runDoctorDiagnostics(
          '/tmp/ipod-test-ac12',
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
    expect(text).not.toContain('podkit doctor');
    expect(text).not.toContain('Device Readiness');
    // Exactly one JSON document — strict parse must succeed.
    const payload = JSON.parse(text) as { success: true; status: string };
    expect(payload.success).toBe(true);
    expect(payload.status).toBe('ok');
  });
});

// ── AC #13: text output structure ──────────────────────────────────────────

describe('AC #13: human-readable output structure', () => {
  it('contains header + readiness section + database section + summary line', async () => {
    const ctx = makeContext({ device: 'ipod', json: false });
    const { out, stdout } = makeOut('text');

    const fakeCore = makeFakeCore({
      report: {
        checks: [
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
      },
    });

    await runWithContext(ctx, () =>
      runAction(out, () =>
        runDoctorDiagnostics(
          '/tmp/ipod-test-ac13',
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
    expect(text).toMatch(/podkit doctor [—-]/);
    expect(text).toContain('Device Readiness');
    expect(text).toContain('Database Health');
    expect(text).toMatch(/All checks passed\.|\d+ issues? found\./);
  });

  it('issues with both fails and passes render an issue count line', async () => {
    const ctx = makeContext({ device: 'ipod', json: false });
    const { out, stdout, stderr } = makeOut('text');

    const fakeCore = makeFakeCore({
      report: {
        checks: [
          {
            id: 'artwork-rebuild',
            name: 'Artwork DB',
            status: 'fail',
            summary: 'broken',
            repairable: true,
            hasRepair: true,
            repairOnly: false,
            scope: 'database-health',
          },
        ],
      },
    });

    await runWithContext(ctx, () =>
      runAction(out, () =>
        runDoctorDiagnostics(
          '/tmp/ipod-test-ac13b',
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

    const combined = stdout.text() + stderr.text();
    expect(combined).toMatch(/\d+ issues? found\./);
  });
});

// ── AC #14: --repair sysinfo-extended runs without -c ──────────────────────

describe('AC #14: --repair sysinfo-extended (writable-device only) without -c', () => {
  it('does not throw COLLECTION_REQUIRED — collection is not in requirements', async () => {
    const ctx = makeContext({ device: 'ipod', collections: [] });
    const { out, stdout } = makeOut();

    const sysinfo = makeWritableDeviceRepair('sysinfo-extended');
    const fakeCore = makeFakeCore({ registry: [sysinfo] });

    await runAction1(ctx, out, () =>
      runDoctorAction({ repair: 'sysinfo-extended' }, out, {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
        getDeviceManager: () => fakeManager(),
      })
    );

    const payload = stdout.json<{ success: boolean; code?: string }>();
    // We don't have a real device, so resolveDevice will fail — but the
    // failure code must NOT be COLLECTION_REQUIRED. It should fall through
    // to DEVICE_NOT_RESOLVED (or, less likely, CORE_LOAD_FAILED).
    expect(payload.code).not.toBe(DoctorErrorCodes.COLLECTION_REQUIRED);
  });
});

// ── AC #15: --repair udev-rule (system-scope) runs without -d ──────────────

describe('AC #15: --repair udev-rule routes through runSystemRepair without -d', () => {
  it('succeeds with no device argument; check.repair.run called once', async () => {
    const ctx = makeContext({ device: undefined });
    const { out, stdout, exitCode } = makeOut('json');

    let calls = 0;
    const udev = makeSystemRepair('udev-rule');
    udev.repair!.run = async () => {
      calls += 1;
      return { success: true, summary: 'Udev rule installed' };
    };
    const fakeCore = makeFakeCore({ registry: [udev] });

    await runAction1(ctx, out, () =>
      runDoctorAction({ repair: 'udev-rule' }, out, {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
      })
    );

    expect(calls).toBe(1);
    expect(exitCode.get()).toBeUndefined();
    const payload = stdout.json<{ success: boolean; checkId: string }>();
    expect(payload.success).toBe(true);
    expect(payload.checkId).toBe('udev-rule');
  });
});

// ── AC #15b: --repair debris-transcode-tmp routes through runSystemRepair ──
//
// debris-transcode-tmp is the second public ID (alongside udev-rule) that
// triggers the system-repair fast-path. Pin that the fast-path evaluation
// (scope === 'system' && requirements.length === 0) reads cleanly from
// the validation-time check returned by getRepairCheckForValidation.

describe('AC #15b: --repair debris-transcode-tmp routes through runSystemRepair', () => {
  it('succeeds with no device argument; check.repair.run called once', async () => {
    const ctx = makeContext({ device: undefined });
    const { out, stdout, exitCode } = makeOut('json');

    let calls = 0;
    const debrisTmp = makeSystemRepair('debris-transcode-tmp');
    debrisTmp.repair!.run = async () => {
      calls += 1;
      return {
        success: true,
        summary: 'Removed 2 abandoned dirs, freed 1.4 MB',
      };
    };
    const fakeCore = makeFakeCore({ registry: [debrisTmp] });

    await runAction1(ctx, out, () =>
      runDoctorAction({ repair: 'debris-transcode-tmp' }, out, {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
      })
    );

    expect(calls).toBe(1);
    expect(exitCode.get()).toBeUndefined();
    const payload = stdout.json<{ success: boolean; checkId: string }>();
    expect(payload.success).toBe(true);
    expect(payload.checkId).toBe('debris-transcode-tmp');
  });
});

// ── AC #16: --scope × --json × --no-system cross-product ──────────────────

let sharedDevicePath: string;
beforeAll(() => {
  sharedDevicePath = mkdtempSync(join(tmpdir(), 'podkit-doctor-flag-matrix-'));
});
afterAll(() => {
  if (sharedDevicePath) rmSync(sharedDevicePath, { recursive: true, force: true });
});

type Scope = 'system' | 'device' | 'all';

type InternalScope = 'system' | 'device-readiness' | 'database-health';

interface MatrixCase {
  scope: Scope;
  json: boolean;
  noSystem: boolean;
  /** Scopes we expect `core.runDiagnostics` to receive. */
  expected: ReadonlyArray<InternalScope>;
  /** Whether the case requires `-d`. */
  needsDevice: boolean;
}

// The CLI's `--scope device` continues to map to "all device-side scopes",
// which now expands to the 3-way internal union's device-readiness +
// database-health pair. The user-facing scope flag is unchanged.
const DEVICE_INTERNAL: ReadonlyArray<InternalScope> = ['device-readiness', 'database-health'];
const ALL_INTERNAL: ReadonlyArray<InternalScope> = ['system', ...DEVICE_INTERNAL];

// 3 (scope) × 2 (json) × 2 (no-system) = 12 cells. `--scope system` ignores
// `--no-system` (scope=system overrides); `--scope device` always uses
// device-only; `--scope all` honours --no-system as the legacy spelling.
const matrixCases: MatrixCase[] = [
  // --scope system × {json on/off} × {no-system on/off}
  { scope: 'system', json: true, noSystem: false, expected: ['system'], needsDevice: false },
  { scope: 'system', json: false, noSystem: false, expected: ['system'], needsDevice: false },
  { scope: 'system', json: true, noSystem: true, expected: ['system'], needsDevice: false },
  { scope: 'system', json: false, noSystem: true, expected: ['system'], needsDevice: false },
  // --scope device × {json on/off} × {no-system on/off}
  { scope: 'device', json: true, noSystem: false, expected: DEVICE_INTERNAL, needsDevice: true },
  { scope: 'device', json: false, noSystem: false, expected: DEVICE_INTERNAL, needsDevice: true },
  { scope: 'device', json: true, noSystem: true, expected: DEVICE_INTERNAL, needsDevice: true },
  { scope: 'device', json: false, noSystem: true, expected: DEVICE_INTERNAL, needsDevice: true },
  // --scope all × {json on/off} × {no-system on/off}
  { scope: 'all', json: true, noSystem: false, expected: ALL_INTERNAL, needsDevice: true },
  { scope: 'all', json: false, noSystem: false, expected: ALL_INTERNAL, needsDevice: true },
  { scope: 'all', json: true, noSystem: true, expected: DEVICE_INTERNAL, needsDevice: true },
  { scope: 'all', json: false, noSystem: true, expected: DEVICE_INTERNAL, needsDevice: true },
];

describe('AC #16: --scope × --json × --no-system cross-product', () => {
  for (const c of matrixCases) {
    const label = `scope=${c.scope}, json=${c.json}, noSystem=${c.noSystem} ⇒ scopes=[${c.expected.join(', ')}]`;
    it(label, async () => {
      const ctx = makeContext({
        device: c.needsDevice ? sharedDevicePath : undefined,
        json: c.json,
      });
      const { out } = makeOut(c.json ? 'json' : 'text');
      const capturedScopes: ReadonlyArray<InternalScope>[] = [];
      const fakeCore = makeFakeCore({
        report: {
          checks: [
            {
              id: 'codec-encoders',
              name: 'FFmpeg',
              status: 'pass',
              summary: 'ok',
              repairable: false,
              hasRepair: false,
              repairOnly: false,
              scope: 'system',
            },
            {
              id: 'artwork-rebuild',
              name: 'Artwork',
              status: 'pass',
              summary: 'ok',
              repairable: false,
              hasRepair: false,
              repairOnly: false,
              scope: 'database-health',
            },
          ],
          captureScopes: (s) => capturedScopes.push(s),
        },
      });

      const opts: Parameters<typeof runDoctorAction>[0] = {
        scope: c.scope,
        system: c.noSystem ? false : undefined,
      };
      const deps: DoctorDeps = {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
        getDeviceManager: () => fakeManager(),
      };

      await runAction1(ctx, out, () => runDoctorAction(opts, out, deps));

      expect(capturedScopes.length).toBeGreaterThanOrEqual(1);
      expect(capturedScopes[0]).toEqual(c.expected);
    });
  }
});

// ── AC #17: --scope device requires -d; --scope system does not ────────────

describe('AC #17: --scope device requires -d; --scope system runs without -d', () => {
  it('--scope device without -d throws DEVICE_REQUIRED, exit 1', async () => {
    const ctx = makeContext({ device: undefined });
    const { out, stdout, exitCode } = makeOut('json');
    const fakeCore = makeFakeCore();

    await runAction1(ctx, out, () =>
      runDoctorAction({ scope: 'device' }, out, {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
      })
    );

    expectCliError(stdout, exitCode, {
      code: DoctorErrorCodes.DEVICE_REQUIRED,
      error: /requires an explicit device/,
      exitCode: 1,
    });
  });

  it('--scope system without -d runs cleanly to a system-only JSON envelope', async () => {
    const ctx = makeContext({ device: undefined });
    const { out, stdout, exitCode } = makeOut('json');
    const fakeCore = makeFakeCore({
      report: {
        checks: [
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
        ],
      },
    });

    await runAction1(ctx, out, () =>
      runDoctorAction({ scope: 'system' }, out, {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
      })
    );

    const payload = stdout.json<{
      success: boolean;
      scope: 'system';
      healthy: boolean;
      checks: Array<{ id: string }>;
    }>();
    expect(payload.success).toBe(true);
    expect(payload.scope).toBe('system');
    expect(payload.healthy).toBe(true);
    expect(payload.checks.map((c) => c.id)).toEqual(['codec-encoders']);
    expect(exitCode.get()).toBeUndefined();
    expect('category' in payload).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TASK-305 — orphan-files (iPod) CLI rendering coverage
//
// The check-level matrix in `packages/podkit-core/src/diagnostics/checks/
// orphans-matrix.test.ts` pins AC #1..#5, #10..#14. The CLI-rendering ACs
// land here because the CSV escape branch and the verbose orphan summary
// live in `commands/doctor.ts` (escapeCsvField, printOrphanSummary — both
// internal; we drive them through the public `runDoctorDiagnostics`).
//
// AC mapping:
//   AC #6  — CSV escape: commas + quotes
//   AC #7  — verbose text groups orphans by F* directory
//   AC #8  — verbose text groups orphans by extension
//   AC #9  — verbose text lists the 10 largest orphans, descending
//
// @see backlog/tasks/task-305 - orphan-files-iPod-detection-and-repair-coverage.md
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Variant of `makeOut` that allows the verbose level to be set — needed for
 * AC #7..#9 where the orphan summary only renders at verbose1+.
 */
function makeVerboseOut(level: number): {
  out: OutputContext;
  stdout: BufferSink;
  stderr: BufferSink;
} {
  const stdout = new BufferSink();
  const stderr = new BufferSink();
  return {
    out: new OutputContext({
      mode: 'text',
      quiet: false,
      verbose: level,
      color: false,
      tips: false,
      tty: false,
      stdout,
      stderr,
      exitCode: new BufferExitCodeSink(),
    }),
    stdout,
    stderr,
  };
}

describe('TASK-305 AC #6: --format csv escapes commas AND quotes', () => {
  it('quotes a path containing a comma and a path containing a double-quote', async () => {
    const ctx = makeContext({ device: 'ipod' });
    const { out, stdout } = makeOut('text');

    const fakeCore = makeFakeCore({
      report: {
        checks: [
          {
            id: 'orphan-files',
            name: 'Orphans',
            status: 'warn',
            summary: '3 orphan files',
            repairable: true,
            hasRepair: true,
            repairOnly: false,
            scope: 'database-health',
            details: {
              orphans: [
                { path: '/iPod_Control/Music/F00/plain.mp3', size: 100 },
                { path: '/iPod_Control/Music/F00/has, comma.m4a', size: 200 },
                {
                  path: '/iPod_Control/Music/F01/has "quoted" name.m4a',
                  size: 300,
                },
              ],
            },
          },
        ],
      },
    });

    await runWithContext(ctx, () =>
      runAction(out, () =>
        runDoctorDiagnostics(
          '/tmp/ipod-test-305-ac6',
          undefined,
          out,
          { format: 'csv' },
          {
            loadCore: async () => fakeCore as typeof import('@podkit/core'),
            getDeviceManager: () => fakeManager(),
          }
        )
      )
    );

    const lines = stdout.lines();
    // Header.
    expect(lines[0]).toBe('path,size');
    // Plain path: no quoting.
    expect(lines[1]).toBe('/iPod_Control/Music/F00/plain.mp3,100');
    // Comma in path: whole field wrapped in double-quotes.
    expect(lines[2]).toBe('"/iPod_Control/Music/F00/has, comma.m4a",200');
    // Quote in path: wrapped AND each internal quote doubled per RFC 4180.
    expect(lines[3]).toBe('"/iPod_Control/Music/F01/has ""quoted"" name.m4a",300');
  });
});

describe('TASK-305 AC #7..#9: verbose orphan summary', () => {
  // Construct an orphan set that exercises all three groupings deterministically.
  //
  // - 2 F* directories (F00, F01) → AC #7 byDir grouping
  // - 3 extensions (.m4a, .mp3, .flac) → AC #8 byExt grouping
  // - 12 orphans total, sizes 1..12 KiB → AC #9 top-10-largest descending
  function buildOrphans(): Array<{ path: string; size: number }> {
    return [
      // F00: 4 m4a + 2 mp3 + 1 flac (7 entries)
      { path: '/iPod_Control/Music/F00/a.m4a', size: 1 * 1024 },
      { path: '/iPod_Control/Music/F00/b.m4a', size: 2 * 1024 },
      { path: '/iPod_Control/Music/F00/c.m4a', size: 3 * 1024 },
      { path: '/iPod_Control/Music/F00/d.m4a', size: 4 * 1024 },
      { path: '/iPod_Control/Music/F00/e.mp3', size: 5 * 1024 },
      { path: '/iPod_Control/Music/F00/f.mp3', size: 6 * 1024 },
      { path: '/iPod_Control/Music/F00/g.flac', size: 7 * 1024 },
      // F01: 2 m4a + 1 mp3 + 2 flac (5 entries)
      { path: '/iPod_Control/Music/F01/h.m4a', size: 8 * 1024 },
      { path: '/iPod_Control/Music/F01/i.m4a', size: 9 * 1024 },
      { path: '/iPod_Control/Music/F01/j.mp3', size: 10 * 1024 },
      { path: '/iPod_Control/Music/F01/k.flac', size: 11 * 1024 },
      { path: '/iPod_Control/Music/F01/l.flac', size: 12 * 1024 },
    ];
  }

  async function runVerboseDoctor(): Promise<string> {
    const ctx = makeContext({ device: 'ipod', json: false });
    const { out, stdout } = makeVerboseOut(1);

    const fakeCore = makeFakeCore({
      report: {
        checks: [
          {
            id: 'orphan-files',
            name: 'Orphans',
            status: 'warn',
            summary: '12 orphan files (78.0 KB wasted)',
            repairable: true,
            hasRepair: true,
            repairOnly: false,
            scope: 'database-health',
            details: {
              orphanCount: 12,
              totalFiles: 12,
              wastedBytes: 78 * 1024,
              wastedFormatted: '78.0 KB',
              orphans: buildOrphans(),
            },
          },
        ],
      },
    });

    await runWithContext(ctx, () =>
      runAction(out, () =>
        runDoctorDiagnostics(
          '/tmp/ipod-test-305-verbose',
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

    return stdout.text();
  }

  it('AC #7: groups orphans by F* directory with count and total size', async () => {
    const text = await runVerboseDoctor();

    // The "By directory:" section appears verbatim.
    expect(text).toContain('By directory:');
    // F00 has 7 entries totaling (1+2+3+4+5+6+7) KiB = 28 KiB → "28.0 KB".
    expect(text).toMatch(/F00\s+7 files\s+28\.0 KB/);
    // F01 has 5 entries totaling (8+9+10+11+12) KiB = 50 KiB → "50.0 KB".
    expect(text).toMatch(/F01\s+5 files\s+50\.0 KB/);
  });

  it('AC #8: groups orphans by file extension with count and total size', async () => {
    const text = await runVerboseDoctor();

    expect(text).toContain('By extension:');
    // .m4a × 6 = (1+2+3+4+8+9) KiB = 27 KiB → "27.0 KB"
    expect(text).toMatch(/\.m4a\s+6 files\s+27\.0 KB/);
    // .mp3 × 3 = (5+6+10) KiB = 21 KiB → "21.0 KB"
    expect(text).toMatch(/\.mp3\s+3 files\s+21\.0 KB/);
    // .flac × 3 = (7+11+12) KiB = 30 KiB → "30.0 KB"
    expect(text).toMatch(/\.flac\s+3 files\s+30\.0 KB/);
  });

  it('AC #9: lists the 10 largest orphans, descending by size', async () => {
    const text = await runVerboseDoctor();

    expect(text).toContain('Largest orphans:');

    // Extract just the "Largest orphans:" block.
    const startIdx = text.indexOf('Largest orphans:');
    expect(startIdx).toBeGreaterThanOrEqual(0);
    // Capture the next ~12 lines worth.
    const block = text.slice(startIdx).split('\n').slice(1, 13);

    // The first 10 lines under the header are the orphan rows.
    const rows = block.filter((l) => /\d+\.\d KB/.test(l));
    expect(rows.length).toBe(10);

    // Parse size from each row and assert descending order.
    const sizes = rows.map((l) => {
      const m = l.match(/(\d+(?:\.\d+)?)\s*KB/);
      return m ? Number(m[1]) : NaN;
    });
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]!).toBeLessThanOrEqual(sizes[i - 1]!);
    }
    // Top row is the 12-KiB orphan (the largest); 11th-largest (3 KiB) is
    // excluded — verifies the 10-cap.
    expect(sizes[0]).toBe(12);
    expect(sizes[9]).toBe(3);
    // The two smallest (1 KiB, 2 KiB) must not appear in the top-10 block.
    expect(rows.find((l) => /^\s*1\.0 KB/.test(l.trim().replace(/^\s+/, '')))).toBeUndefined();
  });
});

// ── --system-only sugar + scope conflict ────────────────────────────────────

describe('--system-only flag (sugar for --scope system)', () => {
  it('throws SCOPE_CONFLICT when paired with --scope all', async () => {
    const ctx = makeContext({ device: undefined });
    const { out, stdout, exitCode } = makeOut();

    await runAction1(ctx, out, () =>
      runDoctorAction({ systemOnly: true, scope: 'all' }, out, {
        loadCore: async () => makeFakeCore({}) as typeof import('@podkit/core'),
      })
    );

    expectCliError(stdout, exitCode, {
      code: DoctorErrorCodes.SCOPE_CONFLICT,
      error: /--system-only conflicts with --scope all/,
      exitCode: 1,
    });
  });

  it('throws SCOPE_CONFLICT when paired with --scope device', async () => {
    const ctx = makeContext({ device: undefined });
    const { out, stdout, exitCode } = makeOut();

    await runAction1(ctx, out, () =>
      runDoctorAction({ systemOnly: true, scope: 'device' }, out, {
        loadCore: async () => makeFakeCore({}) as typeof import('@podkit/core'),
      })
    );

    expectCliError(stdout, exitCode, {
      code: DoctorErrorCodes.SCOPE_CONFLICT,
      error: /--system-only conflicts with --scope device/,
      exitCode: 1,
    });
  });

  it('is a no-op when paired with --scope system (both explicit and consistent)', async () => {
    const ctx = makeContext({ device: undefined });
    const { out, exitCode } = makeOut();
    const fakeCore = makeFakeCore({ report: { checks: [] } });

    await runAction1(ctx, out, () =>
      runDoctorAction({ systemOnly: true, scope: 'system' }, out, {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
      })
    );

    expect(exitCode.get() ?? 0).toBe(0);
  });
});

// ── TASK-342 AC #5: macOS persona shape ────────────────────────────────────

describe('runDoctor — macOS persona shape (TASK-342 AC #5)', () => {
  it('iPod on darwin: text-mode renders System → Device Readiness → Database Health in order', async () => {
    const ctx = makeContext({ device: 'ipod', json: false });
    const { out, stdout } = makeOut('text');

    const fakeCore = makeFakeCore({
      report: {
        checks: [
          {
            id: 'codec-encoders',
            name: 'Codec Encoders',
            status: 'pass',
            summary: 'AAC + libx264',
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
      },
    });

    await runWithContext(ctx, () =>
      runAction(out, () =>
        runDoctorDiagnostics(
          '/tmp/ipod-darwin-ac5a',
          undefined,
          out,
          {},
          {
            loadCore: async () => fakeCore as typeof import('@podkit/core'),
            getDeviceManager: () => fakeManager({ platform: 'darwin' }),
          }
        )
      )
    );

    const text = stdout.text();
    expect(text).toContain('System');
    expect(text).toContain('Device Readiness');
    expect(text).toContain('Database Health');
    // Assert ordering: System before Device Readiness before Database Health.
    expect(text.indexOf('System')).toBeLessThan(text.indexOf('Device Readiness'));
    expect(text.indexOf('Device Readiness')).toBeLessThan(text.indexOf('Database Health'));
  });

  it('echo-mini on darwin: text-mode renders System + Database Health, no Device Readiness, iPod-only checks absent', async () => {
    const tmpDevice = mkdtempSync(join(tmpdir(), 'podkit-doctor-darwin-ms-'));
    try {
      const ctx = makeContext({ device: 'echo', json: false });
      ctx.config.devices = { echo: { type: 'echo-mini', path: tmpDevice } };
      const { out, stdout } = makeOut('text');

      const fakeCore = makeFakeCore({
        report: {
          checks: [
            {
              id: 'codec-encoders',
              name: 'Codec Encoders',
              status: 'pass',
              summary: 'AAC ok',
              repairable: false,
              hasRepair: false,
              repairOnly: false,
              scope: 'system',
            },
            {
              id: 'video-encoder',
              name: 'Video Encoder',
              status: 'pass',
              summary: 'libx264 ok',
              repairable: false,
              hasRepair: false,
              repairOnly: false,
              scope: 'system',
            },
            {
              id: 'orphan-files-mass-storage',
              name: 'Orphan Files (Mass Storage)',
              status: 'pass',
              summary: 'No orphan files',
              repairable: false,
              hasRepair: false,
              repairOnly: false,
              scope: 'database-health',
            },
          ],
        },
      });

      await runWithContext(ctx, () =>
        runAction(out, () =>
          runDoctorDiagnostics(
            tmpDevice,
            { type: 'echo-mini', path: tmpDevice },
            out,
            {},
            {
              loadCore: async () => fakeCore as typeof import('@podkit/core'),
              getDeviceManager: () => fakeManager({ platform: 'darwin' }),
            }
          )
        )
      );

      const text = stdout.text();
      expect(text).toContain('System');
      expect(text).toContain('Codec Encoders');
      expect(text).toContain('Video Encoder');
      expect(text).toContain('Database Health');
      expect(text).toContain('Orphan Files (Mass Storage)');
      expect(text).not.toContain('Device Readiness');
      expect(text).not.toContain('iPod Firmware Inquiry Methods');
    } finally {
      rmSync(tmpDevice, { recursive: true, force: true });
    }
  });

  it('iPod on darwin with --no-system: only device sections render', async () => {
    const ctx = makeContext({ device: 'ipod', json: false });
    const { out, stdout } = makeOut('text');

    const fakeCore = makeFakeCore({
      report: {
        checks: [
          {
            id: 'codec-encoders',
            name: 'Codec Encoders',
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
      },
    });

    await runWithContext(ctx, () =>
      runAction(out, () =>
        runDoctorDiagnostics(
          '/tmp/ipod-darwin-ac5c',
          undefined,
          out,
          { system: false },
          {
            loadCore: async () => fakeCore as typeof import('@podkit/core'),
            getDeviceManager: () => fakeManager({ platform: 'darwin' }),
          }
        )
      )
    );

    const text = stdout.text();
    expect(text).toContain('Device Readiness');
    expect(text).toContain('Database Health');
    expect(text).not.toContain('System');
  });

  it('iPod on darwin with --scope system: only System renders', async () => {
    const ctx = makeContext({ device: undefined, json: false });
    const { out, stdout } = makeOut('text');

    const fakeCore = makeFakeCore({
      report: {
        checks: [
          {
            id: 'codec-encoders',
            name: 'Codec Encoders',
            status: 'pass',
            summary: 'ok',
            repairable: false,
            hasRepair: false,
            repairOnly: false,
            scope: 'system',
          },
        ],
      },
    });

    await runAction1(ctx, out, () =>
      runDoctorAction({ scope: 'system' }, out, {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
        getDeviceManager: () => fakeManager({ platform: 'darwin' }),
      })
    );

    const text = stdout.text();
    expect(text).toContain('System');
    expect(text).not.toContain('Device Readiness');
    expect(text).not.toContain('Database Health');
  });
});
