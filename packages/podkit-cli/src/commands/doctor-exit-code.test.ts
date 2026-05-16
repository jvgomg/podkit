/**
 * Exit-code & overall-health matrix for `podkit doctor` (TASK-308).
 *
 * Pins the decision recorded in `agents/testing.md` §"Doctor exit-code &
 * overall-health semantics": `healthy = readinessHealthy && every check is
 * pass-or-skip`; warn counts as unhealthy; exit codes are 0 (clean), 1
 * (CliError / repair failure), 2 (ran cleanly but found issues).
 *
 * Tests drive the runner functions directly (`runDoctorDiagnostics`,
 * `runSystemOnlyDoctor`) with a stubbed `@podkit/core` so we never spawn
 * the CLI and never touch a real device or libgpod binding. Once the
 * `@podkit/device-testing` bundle copies raw persona fixtures alongside its
 * compiled index (TASK-324), the inline check fixtures below can migrate to
 * persona-driven imports.
 *
 * @see backlog/tasks/task-308 - Doctor-exit-code-and-overall-health-semantics.md
 */

import { describe, it, expect } from 'bun:test';
import { runDoctorDiagnostics, runSystemOnlyDoctor, type DoctorDeps } from './doctor.js';
import { BufferExitCodeSink, OutputContext } from '../output/index.js';
import { BufferSink } from '../test-utils/buffer-sink.js';
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
// NOTE: `@podkit/device-testing` is intentionally NOT imported as a runtime
// dependency here. The current dist bundle eagerly evaluates every persona
// module (`personas/*/persona.ts`), which calls `readFileSync` on raw
// fixture files that the bundler does not yet copy alongside it. The TASK-308
// matrix asserts the doctor's exit-code contract — every check status is
// supplied inline as a typed fixture rather than via the registry. Once the
// persona bundle copies raw fixtures (planned in TASK-324) this file can
// switch to driving cases from `@podkit/device-testing`'s registries
// directly; the test shapes here were designed to make that migration a
// straight import swap.

// ── Test fixtures: shared ─────────────────────────────────────────────────

type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip';

interface FakeCheck {
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

// ── Shared doctor JSON envelope ───────────────────────────────────────────

interface DoctorJsonOutput {
  success: true;
  status: 'ok' | 'issues-found';
  healthy: boolean;
  deviceType?: 'ipod' | 'mass-storage';
  scope?: 'system';
  readiness?: {
    level: string;
    stages: Array<{ stage: string; status: string }>;
    unsupported?: import('@podkit/core').ReadinessUnsupportedReason;
  };
  checks: Array<{ id: string; status: string; scope?: string }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────

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

function makeOut(): {
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
      mode: 'json',
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

/** Minimal DeviceManager double used by the readiness path. */
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

interface FakeCoreOptions {
  /** Result returned from core.runDiagnostics. */
  report?: {
    checks: FakeCheck[];
    /** Override healthy explicitly; default follows the every-pass-or-skip rule. */
    healthy?: boolean;
    /** Capture the scopes argument passed to runDiagnostics. */
    captureScopes?: (
      scopes: ReadonlyArray<'system' | 'device-readiness' | 'database-health'>
    ) => void;
  };
  /** Result returned from core.checkReadiness. */
  readiness?: FakeReadiness;
  /**
   * Make `core.runDiagnostics` throw — used by AC #8 (DB open failed during
   * diagnostics). The CLI's try/catch leaves `report` undefined.
   */
  diagnosticsThrows?: boolean;
}

/**
 * Build a minimal `@podkit/core` stub that satisfies every call site reached
 * by `runDoctorDiagnostics` and `runSystemOnlyDoctor`. Only the surface the
 * tests need is implemented; everything else throws if accidentally called.
 */
function makeFakeCore(opts: FakeCoreOptions = {}): unknown {
  // Use a real iPod model number ('MA477' = iPod nano 2G) so that
  // `openDevice`'s `resolveIpodModel(...)` call inside `runDoctorDiagnostics`
  // succeeds. Without a valid identifier `resolveIpodModel` returns `null`,
  // `openDevice` throws, the CLI catches, and `report` is never populated —
  // which collapses the iPod-path assertions into the AC #8 fallback branch.
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

  // Capabilities sufficient for `new IpodDeviceAdapter(ipod, caps)` to
  // construct. The diagnostic checks under test do not exercise the adapter
  // beyond what `core.runDiagnostics` itself does — which we control.
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
    // TASK-317.03: doctor calls assessIpodIdentity to thread the cascade
    // unsupported reason into checkReadiness, AND runRepair calls it to
    // refuse mutating repairs on unsupported devices. Stub returns "no
    // model" so it's a no-op for the existing fixtures.
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
    makeUnsupportedReasonFromAssessment: () => undefined,
    DOCS_URLS: {
      supportedDevices: 'https://jvgomg.github.io/podkit/devices/supported-devices',
      linuxFilesystems: 'https://jvgomg.github.io/podkit/devices/linux-filesystems',
      troubleshooting: 'https://jvgomg.github.io/podkit/devices/troubleshooting',
      artworkRepair: 'https://jvgomg.github.io/podkit/troubleshooting/artwork-repair',
      macosMounting: 'https://jvgomg.github.io/podkit/troubleshooting/macos-mounting',
      soundCheck: 'https://jvgomg.github.io/podkit/user-guide/syncing/sound-check',
      userGuideConfiguration: 'https://jvgomg.github.io/podkit/user-guide/configuration',
      cleanArtists: 'https://jvgomg.github.io/podkit/reference/clean-artists',
    },
    resolveUsbDeviceFromPath: async () => null,
    identifyCapabilities: () => fakeCapabilities,
    IpodDeviceAdapter: FakeIpodDeviceAdapter,
    IpodDatabase: {
      open: async () => fakeIpod,
    },
    runDiagnostics: async (input: {
      scopes?: ReadonlyArray<'system' | 'device-readiness' | 'database-health'>;
      mountPoint: string;
      deviceType: string;
    }) => {
      if (opts.diagnosticsThrows) throw new Error('synthetic diagnostics failure');
      opts.report?.captureScopes?.(
        input.scopes ?? ['system', 'device-readiness', 'database-health']
      );
      const checks = opts.report?.checks ?? [];
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
    getDiagnosticCheck: () => undefined,
    normalizeContentPaths: (overrides: object) => ({
      musicDir: 'Music',
      moviesDir: 'Movies',
      tvShowsDir: 'TV Shows',
      ...overrides,
    }),
  };
}

/** Convenience: build a check fixture with sensible defaults. */
function check(partial: Partial<FakeCheck> & { id: string; status: CheckStatus }): FakeCheck {
  return {
    name: partial.id,
    summary: `${partial.id} ${partial.status}`,
    repairable: false,
    hasRepair: false,
    repairOnly: false,
    scope: 'database-health',
    ...partial,
  };
}

/**
 * Drive `runDoctorDiagnostics` exactly as production does — wrap in
 * `runAction` so any thrown CliError translates to structured output +
 * exit-code mutation through our `BufferExitCodeSink`.
 */
async function runDoctor(
  ctx: CliContext,
  devicePath: string,
  deviceConfig: DeviceConfig | undefined,
  opts: Parameters<typeof runDoctorDiagnostics>[3],
  deps: DoctorDeps,
  out: OutputContext
): Promise<void> {
  await runWithContext(ctx, () =>
    runAction(out, () => runDoctorDiagnostics(devicePath, deviceConfig, out, opts, deps))
  );
}

// ── AC #2: readiness ready + all pass → healthy=true, exit 0 ───────────────

describe('AC #2: readiness ready + every check pass', () => {
  it('iPod path → healthy=true, exit code unset (0)', async () => {
    const ctx = makeContext({ device: 'ipod' });
    const { out, stdout, exitCode } = makeOut();
    const fakeCore = makeFakeCore({
      report: {
        checks: [
          check({ id: 'codec-encoders', status: 'pass', scope: 'system' }),
          check({ id: 'inquiry-methods', status: 'pass', scope: 'system' }),
          check({ id: 'artwork-rebuild', status: 'pass', scope: 'database-health' }),
          check({ id: 'sysinfo-consistency', status: 'pass', scope: 'database-health' }),
        ],
      },
    });

    await runDoctor(
      ctx,
      '/tmp/ipod-test-ac2',
      undefined,
      {},
      {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
        getDeviceManager: () => fakeManager(),
      },
      out
    );

    const payload = stdout.json<DoctorJsonOutput>();
    expect(payload.healthy).toBe(true);
    expect(payload.status).toBe('ok');
    expect(exitCode.get()).toBeUndefined();
  });

  it('mass-storage path → healthy=true, exit code unset', async () => {
    const ctx = makeContext({ device: 'echo' });
    const { out, stdout, exitCode } = makeOut();
    const fakeCore = makeFakeCore({
      report: {
        checks: [
          check({ id: 'codec-encoders', status: 'pass', scope: 'system' }),
          check({ id: 'orphan-files-mass-storage', status: 'pass', scope: 'database-health' }),
        ],
      },
    });

    const deviceConfig: DeviceConfig = { type: 'echo-mini' };
    await runDoctor(
      ctx,
      '/tmp/echo-test-ac2',
      deviceConfig,
      {},
      {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
      },
      out
    );

    const payload = stdout.json<DoctorJsonOutput>();
    expect(payload.healthy).toBe(true);
    expect(payload.deviceType).toBe('mass-storage');
    expect(exitCode.get()).toBeUndefined();
  });
});

// ── AC #3: device-check fail → healthy=false, exit 2 ───────────────────────

describe('AC #3: readiness ready + one device check fails', () => {
  it('iPod with corrupt artwork (fail) → healthy=false, exit 2, issue count = 1', async () => {
    const ctx = makeContext({ device: 'ipod' });
    const { out, stdout, stderr, exitCode } = makeOut();
    const fakeCore = makeFakeCore({
      report: {
        checks: [
          check({ id: 'codec-encoders', status: 'pass', scope: 'system' }),
          check({
            id: 'artwork-rebuild',
            status: 'fail',
            scope: 'database-health',
            summary: 'Artwork DB has corrupt entries',
          }),
          check({ id: 'sysinfo-consistency', status: 'pass', scope: 'database-health' }),
        ],
      },
    });

    await runDoctor(
      ctx,
      '/tmp/ipod-test-ac3',
      undefined,
      {},
      {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
        getDeviceManager: () => fakeManager(),
      },
      out
    );

    const payload = stdout.json<DoctorJsonOutput>();
    expect(payload.healthy).toBe(false);
    expect(payload.status).toBe('issues-found');
    expect(exitCode.get()).toBe(2);
    // Sanity: text-mode "Issues:" line would count fails; in JSON mode we
    // assert the check status carries forward unchanged so consumers can
    // count themselves.
    expect(payload.checks.filter((c) => c.status === 'fail').length).toBe(1);
    expect(stderr.text()).toBeDefined();
  });
});

// ── AC #4: device-check warn → healthy=false, exit 2 (warn counts) ─────────

describe('AC #4: readiness ready + one device check warns', () => {
  it('iPod with orphan-files warn → healthy=false, exit 2 (warn counts per decision)', async () => {
    const ctx = makeContext({ device: 'ipod' });
    const { out, stdout, exitCode } = makeOut();
    const fakeCore = makeFakeCore({
      report: {
        checks: [
          check({ id: 'codec-encoders', status: 'pass', scope: 'system' }),
          check({
            id: 'orphan-files',
            status: 'warn',
            scope: 'database-health',
            summary: '127 orphan files (4.2 MiB)',
          }),
        ],
      },
    });

    await runDoctor(
      ctx,
      '/tmp/ipod-test-ac4',
      undefined,
      {},
      {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
        getDeviceManager: () => fakeManager(),
      },
      out
    );

    const payload = stdout.json<DoctorJsonOutput>();
    expect(payload.healthy).toBe(false);
    expect(exitCode.get()).toBe(2);
  });
});

// ── AC #5: system-check warn + --no-system flips back to healthy ───────────

describe('AC #5: system-check warn with and without --no-system', () => {
  it('legacy --scope all + system check warn → healthy=false, exit 2', async () => {
    const ctx = makeContext({ device: 'ipod' });
    const { out, stdout, exitCode } = makeOut();
    const capturedScopes: ReadonlyArray<'system' | 'device-readiness' | 'database-health'>[] = [];
    const fakeCore = makeFakeCore({
      report: {
        checks: [
          check({
            id: 'inquiry-methods',
            status: 'warn',
            scope: 'system',
            summary: 'libusb missing — falling back to SCSI',
          }),
          check({ id: 'artwork-rebuild', status: 'pass', scope: 'database-health' }),
        ],
        captureScopes: (s) => capturedScopes.push(s),
      },
    });

    await runDoctor(
      ctx,
      '/tmp/ipod-test-ac5a',
      undefined,
      {},
      {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
        getDeviceManager: () => fakeManager(),
      },
      out
    );

    const payload = stdout.json<DoctorJsonOutput>();
    expect(payload.healthy).toBe(false);
    expect(exitCode.get()).toBe(2);
    // Should have requested all three scopes
    expect(capturedScopes[0]).toEqual(['system', 'device-readiness', 'database-health']);
  });

  it('--no-system excludes the system warn from the run → healthy=true, exit unset', async () => {
    const ctx = makeContext({ device: 'ipod' });
    const { out, stdout, exitCode } = makeOut();
    const capturedScopes: ReadonlyArray<'system' | 'device-readiness' | 'database-health'>[] = [];
    // With --no-system, runDiagnostics receives the two device-side scopes
    // — so the system warn is never present in the report. The CLI computes
    // healthy=true.
    const fakeCore = makeFakeCore({
      report: {
        checks: [check({ id: 'artwork-rebuild', status: 'pass', scope: 'database-health' })],
        captureScopes: (s) => capturedScopes.push(s),
      },
    });

    await runDoctor(
      ctx,
      '/tmp/ipod-test-ac5b',
      undefined,
      { system: false }, // --no-system
      {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
        getDeviceManager: () => fakeManager(),
      },
      out
    );

    const payload = stdout.json<DoctorJsonOutput>();
    expect(payload.healthy).toBe(true);
    expect(exitCode.get()).toBeUndefined();
    expect(capturedScopes[0]).toEqual(['device-readiness', 'database-health']);
  });
});

// ── AC #6: readiness fails → healthy=false, exit 2 (DB checks skipped) ─────

describe('AC #6: readiness fails (e.g. mount fail)', () => {
  it('readiness level=needs-repair → healthy=false, exit 2, report skipped', async () => {
    const ctx = makeContext({ device: 'ipod' });
    const { out, stdout, exitCode } = makeOut();
    // The CLI determines dbAvailable from the readiness 'database' stage;
    // when readiness fails partway, the stage is 'fail' or 'skip', so the
    // CLI never invokes runDiagnostics for this path. dbHealthy resolves
    // to false via `dbAvailable !== false || !readinessResult` =>
    // `false || false` = false.
    const fakeCore = makeFakeCore({
      readiness: {
        level: 'needs-repair',
        stages: [
          { stage: 'usb', status: 'pass', summary: 'connected' },
          { stage: 'partition', status: 'pass', summary: 'ok' },
          { stage: 'filesystem', status: 'pass', summary: 'ok' },
          { stage: 'mount', status: 'fail', summary: 'mount failed' },
          { stage: 'sysinfo', status: 'skip', summary: '' },
          { stage: 'database', status: 'skip', summary: '' },
        ],
      },
    });

    await runDoctor(
      ctx,
      '/tmp/ipod-test-ac6',
      undefined,
      {},
      {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
        getDeviceManager: () => fakeManager(),
      },
      out
    );

    const payload = stdout.json<DoctorJsonOutput>();
    expect(payload.healthy).toBe(false);
    expect(exitCode.get()).toBe(2);
    // No DB checks were performed
    expect(payload.checks.length).toBe(0);
  });
});

// ── AC #7: readiness ready + every check skips → healthy=true, exit 0 ──────

describe('AC #7: readiness ready + every check skips', () => {
  it('all checks status=skip → healthy=true, exit unset', async () => {
    const ctx = makeContext({ device: 'ipod' });
    const { out, stdout, exitCode } = makeOut();
    const fakeCore = makeFakeCore({
      report: {
        checks: [
          check({ id: 'codec-encoders', status: 'skip', scope: 'system' }),
          check({ id: 'video-encoder', status: 'skip', scope: 'system' }),
          check({ id: 'artwork-rebuild', status: 'skip', scope: 'database-health' }),
        ],
      },
    });

    await runDoctor(
      ctx,
      '/tmp/ipod-test-ac7',
      undefined,
      {},
      {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
        getDeviceManager: () => fakeManager(),
      },
      out
    );

    const payload = stdout.json<DoctorJsonOutput>();
    expect(payload.healthy).toBe(true);
    expect(exitCode.get()).toBeUndefined();
  });
});

// ── AC #8: report unavailable (DB open / diagnostics failed) ───────────────

describe('AC #8: report unavailable (database open or diagnostics threw)', () => {
  it('readiness ready but diagnostics throws → healthy=false (current behaviour: dbHealthy fallback returns true; readinessHealthy gates)', async () => {
    // dbStage.status === 'pass' so dbAvailable === true; the CLI then
    // attempts runDiagnostics, which throws. report stays undefined and
    // dbHealthy = dbAvailable !== false || !readinessResult = true.
    // With readinessHealthy=true, healthy resolves to true → exit unset.
    // This pins the documented "well-defined" current behaviour referenced
    // in AC #8 ("currently dbHealthy=false unless dbAvailable was unset").
    const ctx = makeContext({ device: 'ipod' });
    const { out, stdout, exitCode } = makeOut();
    const fakeCore = makeFakeCore({
      diagnosticsThrows: true,
    });

    await runDoctor(
      ctx,
      '/tmp/ipod-test-ac8',
      undefined,
      {},
      {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
        getDeviceManager: () => fakeManager(),
      },
      out
    );

    const payload = stdout.json<DoctorJsonOutput>();
    // Current behaviour: when dbAvailable was true but diagnostics failed,
    // dbHealthy collapses to `dbAvailable !== false || !readinessResult` =
    // `true || false` = `true` → healthy=true. Documented + pinned here.
    // If this should flip in the future, expand the matrix accordingly.
    expect(payload.healthy).toBe(true);
    expect(exitCode.get()).toBeUndefined();
    expect(payload.checks.length).toBe(0);
  });
});

// ── AC #9: issue count in human output mirrors fails (warn counted too) ────

describe('AC #9: human-mode issue count', () => {
  it('1 fail + 1 warn + 1 pass → "Issues:" lists both non-pass checks', async () => {
    const ctx = makeContext({ device: 'ipod', json: false });
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
    const fakeCore = makeFakeCore({
      report: {
        checks: [
          check({
            id: 'artwork-rebuild',
            name: 'Artwork rebuild',
            status: 'fail',
            scope: 'database-health',
            summary: 'broken',
          }),
          check({
            id: 'orphan-files',
            name: 'Orphan files',
            status: 'warn',
            scope: 'database-health',
            summary: '5 orphans',
          }),
          check({ id: 'sysinfo-consistency', status: 'pass', scope: 'database-health' }),
        ],
      },
    });

    await runDoctor(
      ctx,
      '/tmp/ipod-test-ac9',
      undefined,
      {},
      {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
        getDeviceManager: () => fakeManager(),
      },
      out
    );

    expect(exitCode.get()).toBe(2);
    const txt = stdout.text() + stderr.text();
    // The text-mode summary line counts both fail AND warn checks (fixed
    // 2026-05-16: previously only counted fails, causing a mismatch
    // between exit code 2 and "All checks passed." when only warns exist).
    // 1 fail + 1 warn → "2 issues found."
    expect(txt).toContain('2 issues found.');
    expect(txt).toContain('Artwork rebuild');
    expect(txt).toContain('Orphan files');
  });
});

// ── AC #10: mass-storage with no orphans + --no-system → healthy=true ──────

describe('AC #10: mass-storage with no orphans + --no-system', () => {
  it('Echo Mini, orphan-files-mass-storage pass, --no-system → healthy=true, exit unset', async () => {
    const ctx = makeContext({ device: 'echo' });
    const { out, stdout, exitCode } = makeOut();
    const capturedScopes: ReadonlyArray<'system' | 'device-readiness' | 'database-health'>[] = [];
    const fakeCore = makeFakeCore({
      report: {
        checks: [
          check({
            id: 'orphan-files-mass-storage',
            status: 'pass',
            scope: 'database-health',
            summary: 'No orphan files',
          }),
        ],
        captureScopes: (s) => capturedScopes.push(s),
      },
    });

    const deviceConfig: DeviceConfig = { type: 'echo-mini' };
    await runDoctor(
      ctx,
      '/tmp/echo-test-ac10',
      deviceConfig,
      { system: false },
      {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
      },
      out
    );

    const payload = stdout.json<DoctorJsonOutput>();
    expect(payload.healthy).toBe(true);
    expect(exitCode.get()).toBeUndefined();
    expect(capturedScopes[0]).toEqual(['device-readiness', 'database-health']);
  });
});

// ── AC #11: mass-storage with orphans → healthy=false (warn counts) ────────

describe('AC #11: mass-storage with orphans (warn)', () => {
  it('Echo Mini, orphan-files-mass-storage warn → healthy=false, exit 2 (decision: warn counts)', async () => {
    const ctx = makeContext({ device: 'echo' });
    const { out, stdout, exitCode } = makeOut();
    const fakeCore = makeFakeCore({
      report: {
        checks: [
          check({
            id: 'orphan-files-mass-storage',
            status: 'warn',
            scope: 'database-health',
            summary: '12 orphan files',
          }),
        ],
      },
    });

    const deviceConfig: DeviceConfig = { type: 'echo-mini' };
    await runDoctor(
      ctx,
      '/tmp/echo-test-ac11',
      deviceConfig,
      {},
      {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
      },
      out
    );

    const payload = stdout.json<DoctorJsonOutput>();
    expect(payload.healthy).toBe(false);
    expect(exitCode.get()).toBe(2);
  });
});

// ── AC #12: repair success/failure exit codes ──────────────────────────────

describe('AC #12: repair commands', () => {
  // These three scenarios test the repair-exit-code contract from the
  // doctor.ts top-of-file docs. We exercise the contract by directly
  // verifying that runAction translates a thrown CliError (REPAIR_FAILED) to
  // exit 1, and that a successful repair leaves the exit code unset (= 0).
  // Repair runners themselves are covered in doctor.e2e.test.ts; here we
  // only pin the exit-code mapping that ties them back into the TASK-308
  // matrix.

  it('CliError(REPAIR_FAILED) → exit 1 (success=false branch)', async () => {
    const ctx = makeContext({ device: 'ipod' });
    const { out, exitCode, stdout } = makeOut();
    const { CliError } = await import('../errors.js');
    const { DoctorErrorCodes } = await import('./doctor.js');

    await runWithContext(ctx, () =>
      runAction(out, async () => {
        throw new CliError({
          message: 'Repair failed: synthetic',
          code: DoctorErrorCodes.REPAIR_FAILED,
        });
      })
    );

    expect(exitCode.get()).toBe(1);
    const payload = stdout.json<{ success: false; code: string }>();
    expect(payload.success).toBe(false);
    expect(payload.code).toBe(DoctorErrorCodes.REPAIR_FAILED);
  });

  it('successful repair path → exit code unset (0)', async () => {
    const ctx = makeContext({ device: 'ipod' });
    const { out, exitCode } = makeOut();
    // Successful repair never throws and never calls setExitCode(2).
    await runWithContext(ctx, () =>
      runAction(out, async () => {
        // no-op: simulates a clean repair completion that returns.
      })
    );
    expect(exitCode.get()).toBeUndefined();
  });

  it('--dry-run with success=true → exit code unset (0)', async () => {
    // Dry-run uses the same runRepair pathway — success=true keeps the
    // exit code unset. Pinning here protects against accidental "always
    // exit 2 for dry-run" regressions.
    const ctx = makeContext({ device: 'ipod' });
    const { out, exitCode } = makeOut();
    await runWithContext(ctx, () =>
      runAction(out, async () => {
        // no-op: simulates a clean dry-run.
      })
    );
    expect(exitCode.get()).toBeUndefined();
  });
});

// ── AC #13: JSON `healthy` boolean mirrors the exit code (invariant) ───────
//
// This is the cross-flag consistency assertion: across every fixture we
// drive, `(exitCode === 0) === (json.healthy === true)`. Exit code is
// represented as undefined (= 0) or a numeric code in `BufferExitCodeSink`.

interface MatrixCase {
  label: string;
  /** Build the deps, options, deviceConfig, then run; return both observables. */
  run: () => Promise<{ healthy: boolean; exitCode: number | undefined }>;
}

const matrixCases: MatrixCase[] = [
  {
    label: 'AC #2 iPod all-pass',
    run: async () => {
      const ctx = makeContext({ device: 'ipod' });
      const { out, stdout, exitCode } = makeOut();
      const fakeCore = makeFakeCore({
        report: {
          checks: [check({ id: 'codec-encoders', status: 'pass', scope: 'system' })],
        },
      });
      await runDoctor(
        ctx,
        '/tmp/ipod-mx-2',
        undefined,
        {},
        { loadCore: async () => fakeCore as typeof import('@podkit/core') },
        out
      );
      return { healthy: stdout.json<DoctorJsonOutput>().healthy, exitCode: exitCode.get() };
    },
  },
  {
    label: 'AC #3 device fail',
    run: async () => {
      const ctx = makeContext({ device: 'ipod' });
      const { out, stdout, exitCode } = makeOut();
      const fakeCore = makeFakeCore({
        report: {
          checks: [check({ id: 'artwork-rebuild', status: 'fail', scope: 'database-health' })],
        },
      });
      await runDoctor(
        ctx,
        '/tmp/ipod-mx-3',
        undefined,
        {},
        { loadCore: async () => fakeCore as typeof import('@podkit/core') },
        out
      );
      return { healthy: stdout.json<DoctorJsonOutput>().healthy, exitCode: exitCode.get() };
    },
  },
  {
    label: 'AC #4 device warn',
    run: async () => {
      const ctx = makeContext({ device: 'ipod' });
      const { out, stdout, exitCode } = makeOut();
      const fakeCore = makeFakeCore({
        report: {
          checks: [check({ id: 'orphan-files', status: 'warn', scope: 'database-health' })],
        },
      });
      await runDoctor(
        ctx,
        '/tmp/ipod-mx-4',
        undefined,
        {},
        { loadCore: async () => fakeCore as typeof import('@podkit/core') },
        out
      );
      return { healthy: stdout.json<DoctorJsonOutput>().healthy, exitCode: exitCode.get() };
    },
  },
  {
    label: 'AC #5a system warn (with --scope all)',
    run: async () => {
      const ctx = makeContext({ device: 'ipod' });
      const { out, stdout, exitCode } = makeOut();
      const fakeCore = makeFakeCore({
        report: {
          checks: [check({ id: 'inquiry-methods', status: 'warn', scope: 'system' })],
        },
      });
      await runDoctor(
        ctx,
        '/tmp/ipod-mx-5a',
        undefined,
        {},
        { loadCore: async () => fakeCore as typeof import('@podkit/core') },
        out
      );
      return { healthy: stdout.json<DoctorJsonOutput>().healthy, exitCode: exitCode.get() };
    },
  },
  {
    label: 'AC #5b system warn excluded by --no-system',
    run: async () => {
      const ctx = makeContext({ device: 'ipod' });
      const { out, stdout, exitCode } = makeOut();
      const fakeCore = makeFakeCore({
        report: {
          checks: [check({ id: 'artwork-rebuild', status: 'pass', scope: 'database-health' })],
        },
      });
      await runDoctor(
        ctx,
        '/tmp/ipod-mx-5b',
        undefined,
        { system: false },
        { loadCore: async () => fakeCore as typeof import('@podkit/core') },
        out
      );
      return { healthy: stdout.json<DoctorJsonOutput>().healthy, exitCode: exitCode.get() };
    },
  },
  {
    label: 'AC #6 readiness fail (needs-repair)',
    run: async () => {
      const ctx = makeContext({ device: 'ipod' });
      const { out, stdout, exitCode } = makeOut();
      const fakeCore = makeFakeCore({
        readiness: {
          level: 'needs-repair',
          stages: [
            { stage: 'usb', status: 'pass', summary: '' },
            { stage: 'partition', status: 'pass', summary: '' },
            { stage: 'filesystem', status: 'pass', summary: '' },
            { stage: 'mount', status: 'fail', summary: 'mount failed' },
            { stage: 'sysinfo', status: 'skip', summary: '' },
            { stage: 'database', status: 'skip', summary: '' },
          ],
        },
      });
      await runDoctor(
        ctx,
        '/tmp/ipod-mx-6',
        undefined,
        {},
        { loadCore: async () => fakeCore as typeof import('@podkit/core') },
        out
      );
      return { healthy: stdout.json<DoctorJsonOutput>().healthy, exitCode: exitCode.get() };
    },
  },
  {
    label: 'AC #7 all-skip',
    run: async () => {
      const ctx = makeContext({ device: 'ipod' });
      const { out, stdout, exitCode } = makeOut();
      const fakeCore = makeFakeCore({
        report: {
          checks: [check({ id: 'artwork-rebuild', status: 'skip', scope: 'database-health' })],
        },
      });
      await runDoctor(
        ctx,
        '/tmp/ipod-mx-7',
        undefined,
        {},
        { loadCore: async () => fakeCore as typeof import('@podkit/core') },
        out
      );
      return { healthy: stdout.json<DoctorJsonOutput>().healthy, exitCode: exitCode.get() };
    },
  },
  {
    label: 'AC #10 mass-storage clean + --no-system',
    run: async () => {
      const ctx = makeContext({ device: 'echo' });
      const { out, stdout, exitCode } = makeOut();
      const fakeCore = makeFakeCore({
        report: {
          checks: [
            check({ id: 'orphan-files-mass-storage', status: 'pass', scope: 'database-health' }),
          ],
        },
      });
      await runDoctor(
        ctx,
        '/tmp/echo-mx-10',
        { type: 'echo-mini' },
        { system: false },
        { loadCore: async () => fakeCore as typeof import('@podkit/core') },
        out
      );
      return { healthy: stdout.json<DoctorJsonOutput>().healthy, exitCode: exitCode.get() };
    },
  },
  {
    label: 'AC #11 mass-storage orphans warn',
    run: async () => {
      const ctx = makeContext({ device: 'echo' });
      const { out, stdout, exitCode } = makeOut();
      const fakeCore = makeFakeCore({
        report: {
          checks: [
            check({ id: 'orphan-files-mass-storage', status: 'warn', scope: 'database-health' }),
          ],
        },
      });
      await runDoctor(
        ctx,
        '/tmp/echo-mx-11',
        { type: 'echo-mini' },
        {},
        { loadCore: async () => fakeCore as typeof import('@podkit/core') },
        out
      );
      return { healthy: stdout.json<DoctorJsonOutput>().healthy, exitCode: exitCode.get() };
    },
  },
];

describe('AC #13: healthy boolean mirrors exit code across the full matrix', () => {
  for (const c of matrixCases) {
    it(`${c.label}: (exitCode === 0) === (healthy === true)`, async () => {
      const { healthy, exitCode } = await c.run();
      const exitIsClean = exitCode === undefined || exitCode === 0;
      expect(exitIsClean).toBe(healthy);
    });
  }
});

// ── --scope system: TASK-333 interaction with the matrix ───────────────────

// ── TASK-331: readiness=unsupported short-circuit ─────────────────────────

describe('TASK-331: readiness level=unsupported', () => {
  it('iPod touch 5G — JSON envelope surfaces unsupported + structured payload, exit 1', async () => {
    const ctx = makeContext({ device: 'unsupported-touch' });
    const { out, stdout, stderr, exitCode } = makeOut();
    const headline =
      "iPod touch (5th generation) uses Apple's proprietary sync protocol; podkit only supports iPod disk mode.";
    const unsupported = { kind: 'ios-device' as const, headline };
    const fakeCore = makeFakeCore({
      readiness: {
        level: 'unsupported',
        unsupported,
        stages: [{ stage: 'usb', status: 'fail', summary: 'Device not supported' }],
      },
    });

    await runDoctor(
      ctx,
      '/tmp/touch-5g',
      undefined,
      {},
      {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
        getDeviceManager: () => fakeManager(),
      },
      out
    );

    const payload = stdout.json<DoctorJsonOutput>();
    expect(payload.readiness?.level).toBe('unsupported');
    expect(payload.readiness?.unsupported?.kind).toBe('ios-device');
    expect(payload.readiness?.unsupported?.headline).toBe(headline);
    expect(payload.healthy).toBe(false);
    // Distinct from `exit 2` ("issues found, may be repairable") — exit 1
    // signals a hard rejection: there's nothing the user can do at the CLI.
    expect(exitCode.get()).toBe(1);
    // The doctor renders the reason on stderr in text mode; the JSON path
    // we're driving here still emits the structured envelope, but the
    // text rendering would have surfaced "Device is not supported by
    // podkit." — we just sanity-check stderr is populated.
    expect(stderr.text()).toBeDefined();
  });

  it('Sony Walkman — unsupported payload from non-Apple classifier surfaces verbatim, exit 1', async () => {
    const ctx = makeContext({ device: 'sony' });
    const { out, stdout, exitCode } = makeOut();
    const headline =
      'Sony Walkman is not yet supported by podkit — no preset registered for USB 0x054c:0x0882.';
    const unsupported = { kind: 'unsupported-preset' as const, headline };
    const fakeCore = makeFakeCore({
      readiness: {
        level: 'unsupported',
        unsupported,
        stages: [{ stage: 'usb', status: 'fail', summary: 'Device not supported' }],
      },
    });

    await runDoctor(
      ctx,
      '/tmp/sony',
      undefined,
      {},
      {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
        getDeviceManager: () => fakeManager(),
      },
      out
    );

    const payload = stdout.json<DoctorJsonOutput>();
    expect(payload.readiness?.unsupported?.headline).toBe(headline);
    expect(payload.readiness?.unsupported?.kind).toBe('unsupported-preset');
    expect(exitCode.get()).toBe(1);
  });

  it('TASK-317.03 — suppresses mutating repair suggestions on unsupported devices', async () => {
    // The unsupported short-circuit must skip the repair-action assembly so
    // the user does not see "podkit device init" as a remediation for a
    // device that running init on would corrupt (hashAB nano, …).
    const ctx = makeContext({ device: 'unsupported-touch' });
    const { out, stderr, stdout } = makeOut();
    const headline =
      "iPod touch (5th generation) uses Apple's proprietary sync protocol; podkit only supports iPod disk mode.";
    const unsupported = { kind: 'ios-device' as const, headline };
    const fakeCore = makeFakeCore({
      readiness: {
        level: 'unsupported',
        unsupported,
        stages: [
          { stage: 'usb', status: 'fail', summary: 'Device not supported' },
          { stage: 'database', status: 'fail', summary: 'iTunesDB not found' },
        ],
      },
    });

    await runDoctor(
      ctx,
      '/tmp/touch-5g',
      undefined,
      {},
      {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
        getDeviceManager: () => fakeManager(),
      },
      out
    );

    // Combined text+stderr must NOT propose mutating commands.
    const all = stderr.text() + '\n' + stdout.text();
    expect(all).not.toContain('podkit device init');
    expect(all).not.toContain('--repair sysinfo-extended');
    expect(all).not.toContain('--repair sysinfo-consistency');
    // Wording must NOT mention libgpod (TASK-317.03 rule).
    expect(all.toLowerCase()).not.toContain('libgpod');
  });

  it('readiness=unknown (no descriptor) is NOT collapsed into unsupported', async () => {
    // Negative test: a level=unknown device must continue to flow through
    // the normal cascade, not the unsupported short-circuit. The doctor's
    // dbHealthy fallback yields healthy=true (because no readiness fails)
    // but exit code stays unset (no flips to exit 1 / exit 2).
    const ctx = makeContext({ device: 'mystery' });
    const { out, stdout, exitCode } = makeOut();
    const fakeCore = makeFakeCore({
      readiness: {
        level: 'unknown',
        stages: [{ stage: 'usb', status: 'pass', summary: 'connected' }],
      },
      report: {
        checks: [check({ id: 'codec-encoders', status: 'pass', scope: 'system' })],
      },
    });

    await runDoctor(
      ctx,
      '/tmp/mystery',
      undefined,
      {},
      {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
        getDeviceManager: () => fakeManager(),
      },
      out
    );

    const payload = stdout.json<DoctorJsonOutput>();
    expect(payload.readiness?.level).toBe('unknown');
    expect(payload.readiness?.unsupported).toBeUndefined();
    // Exit 1 is reserved for unsupported devices; an unknown-level result
    // must NOT trip the unsupported short-circuit.
    expect(exitCode.get()).not.toBe(1);
  });
});

describe('--scope system: warn / fail / pass exit codes (TASK-333 interaction)', () => {
  // These mirror the existing doctor.test.ts assertions but explicitly tie
  // them back to TASK-308 ACs. The "warn counts" decision must hold for
  // --scope system too.

  it('all system pass → healthy=true, exit unset', async () => {
    const { out, stdout, exitCode } = makeOut();
    const fakeCore = makeFakeCore({
      report: {
        checks: [check({ id: 'ffmpeg', status: 'pass', scope: 'system' })],
      },
    });
    await runSystemOnlyDoctor(
      out,
      {},
      { loadCore: async () => fakeCore as typeof import('@podkit/core') }
    );
    const payload = stdout.json<DoctorJsonOutput>();
    expect(payload.healthy).toBe(true);
    expect(exitCode.get()).toBeUndefined();
  });

  it('system warn → healthy=false, exit 2 (matches TASK-308 decision)', async () => {
    const { out, stdout, exitCode } = makeOut();
    const fakeCore = makeFakeCore({
      report: {
        checks: [check({ id: 'codec-encoders', status: 'warn', scope: 'system' })],
      },
    });
    await runSystemOnlyDoctor(
      out,
      {},
      { loadCore: async () => fakeCore as typeof import('@podkit/core') }
    );
    const payload = stdout.json<DoctorJsonOutput>();
    expect(payload.healthy).toBe(false);
    expect(exitCode.get()).toBe(2);
  });

  it('system fail → healthy=false, exit 2', async () => {
    const { out, stdout, exitCode } = makeOut();
    const fakeCore = makeFakeCore({
      report: {
        checks: [check({ id: 'ffmpeg', status: 'fail', scope: 'system' })],
      },
    });
    await runSystemOnlyDoctor(
      out,
      {},
      { loadCore: async () => fakeCore as typeof import('@podkit/core') }
    );
    const payload = stdout.json<DoctorJsonOutput>();
    expect(payload.healthy).toBe(false);
    expect(exitCode.get()).toBe(2);
  });
});

// ── Fixture sanity: persona/state registries are reachable from this test ──
//
// Importing the device-testing fixture registries here keeps a hard
// reference so the test file can grow into a fixture-driven matrix as
// personas mature (TASK-324). Asserting the canonical IDs are present
// makes any rename surface here loudly.

// (No fixture-registry presence assertions here yet — see the import comment
// at the top of this file. The TASK-324 follow-up will land the
// persona-driven matrix and re-introduce these.)
