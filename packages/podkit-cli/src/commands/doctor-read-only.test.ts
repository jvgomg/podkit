/**
 * `podkit doctor` on a read-only device.
 *
 * A read-only generation (shuffle 3G/4G, nano 6G/7G) is readable: podkit
 * lists its tracks and archives it. Diagnosing it is a read too, so doctor
 * runs its whole read-only surface — host checks, the readiness cascade, and
 * the database-health checks — and reports what it finds.
 *
 * What changes is the remedy: every repair writes, so no `--repair` command
 * is offered. The findings still appear; the command is replaced by an
 * explanation.
 *
 * Tests drive `runDoctorDiagnostics` with a stubbed `@podkit/core`, so no
 * device, libgpod binding, or USB walk is involved.
 *
 * @module
 */

import { describe, it, expect } from 'bun:test';
import { identify } from '@podkit/devices-ipod';
import { runDoctorDiagnostics, runRepair, type DoctorDeps } from './doctor.js';
import { CliError } from '../errors.js';
import { READ_ONLY_NO_REPAIR_NOTE } from './readiness-display.js';
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
} from '../config/index.js';
import type { DeviceManager } from '@podkit/core';

// ── Fixtures ──────────────────────────────────────────────────────────────

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
}

interface FakeStage {
  stage: 'usb' | 'partition' | 'filesystem' | 'mount' | 'sysinfo' | 'database';
  status: CheckStatus;
  summary: string;
  details?: Record<string, unknown>;
}

const NANO_7G_REASON = {
  kind: 'unsupported-device' as const,
  headline:
    'iPod nano 7th gen can be read and archived, but not synced: writing needs the hashAB signature.',
  docsUrl: 'https://jvgomg.github.io/podkit/devices/supported-devices/',
};

interface DoctorJsonOutput {
  success: true;
  status: 'ok' | 'issues-found';
  healthy: boolean;
  access?: string;
  readiness?: { level: string; stages: Array<{ stage: string; status: string }> };
  checks: Array<{ id: string; status: string; scope?: string; repairable: boolean }>;
}

const ALL_STAGES_PASS: FakeStage[] = [
  { stage: 'usb', status: 'pass', summary: 'connected' },
  { stage: 'partition', status: 'pass', summary: 'ok' },
  { stage: 'filesystem', status: 'pass', summary: 'ok' },
  { stage: 'mount', status: 'pass', summary: 'ok' },
  { stage: 'sysinfo', status: 'pass', summary: 'ok' },
  { stage: 'database', status: 'pass', summary: 'ok' },
];

/**
 * Readiness stages where SysInfo warns. `collectReadinessIssues` mines the
 * `suggestion` string for the command it offers as `Fix:` — the exact
 * suggestion a real SysInfo stage emits.
 */
const SYSINFO_WARNS: FakeStage[] = ALL_STAGES_PASS.map((stage) =>
  stage.stage === 'sysinfo'
    ? {
        stage: 'sysinfo' as const,
        status: 'warn' as const,
        summary: 'SysInfoExtended is missing',
        details: {
          sysInfoExtendedExists: false,
          checksumType: 'hash72',
          suggestion: 'run `podkit doctor --repair sysinfo-extended`',
        },
      }
    : stage
);

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

// ── Harness ───────────────────────────────────────────────────────────────

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
    json: false,
    quiet: false,
    verbose: 0,
    color: false,
    tips: false,
    tty: false,
    device,
    config: undefined,
  };
  const configResult: LoadConfigResult = { config, configPath: undefined, configFileExists: false };
  return { config, globalOpts, configResult };
}

function makeOut(mode: 'text' | 'json'): {
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

interface FakeCoreOptions {
  /** Generation the readiness result reports, via its USB-derived model. */
  generationId: string;
  stages?: FakeStage[];
  checks?: FakeCheck[];
  /** Records what `checkReadiness` was asked for. */
  captureRequiredAccess?: (requiredAccess: string | undefined) => void;
}

function makeFakeCore(opts: FakeCoreOptions): unknown {
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
    discoverConnectedDevices: async () => [],
    ipodFromBlock: (block: unknown) => ({ kind: 'ipod', block, matchedBy: 'block-only' }),
    checkReadiness: async (input: { requiredAccess?: string }) => {
      opts.captureRequiredAccess?.(input.requiredAccess);
      return {
        level: 'ready',
        stages: opts.stages ?? ALL_STAGES_PASS,
        usbModel: {
          generationId: opts.generationId,
          displayName: 'Test iPod',
          ...(opts.generationId === 'nano_7g' ? { unsupportedReason: NANO_7G_REASON } : {}),
        },
      };
    },
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
      supportedDevices: 'https://jvgomg.github.io/podkit/devices/supported-devices/',
      linuxFilesystems: 'https://jvgomg.github.io/podkit/devices/linux-filesystems/',
      troubleshooting: 'https://jvgomg.github.io/podkit/devices/troubleshooting/',
      artworkRepair: 'https://jvgomg.github.io/podkit/troubleshooting/artwork-repair/',
      macosMounting: 'https://jvgomg.github.io/podkit/troubleshooting/macos-mounting/',
      soundCheck: 'https://jvgomg.github.io/podkit/user-guide/syncing/sound-check/',
      userGuideConfiguration: 'https://jvgomg.github.io/podkit/user-guide/configuration/',
      cleanArtists: 'https://jvgomg.github.io/podkit/reference/clean-artists/',
    },
    resolveUsbDeviceFromPath: async () => null,
    identifyCapabilities: () => ({
      artworkSources: ['embedded', 'database'] as const,
      artworkMaxResolution: 320,
      supportedAudioCodecs: ['aac', 'mp3', 'alac'] as const,
      supportsVideo: false,
      audioNormalization: 'soundcheck' as const,
      supportsAlbumArtistBrowsing: false,
    }),
    IpodDeviceAdapter: FakeIpodDeviceAdapter,
    IpodDatabase: { open: async () => fakeIpod },
    runDiagnostics: async (input: { mountPoint: string; deviceType: string }) => {
      const checks = opts.checks ?? [];
      return {
        mountPoint: input.mountPoint,
        deviceModel: 'Test',
        deviceType: input.deviceType,
        checks,
        healthy: checks.every((c) => c.status === 'pass' || c.status === 'skip'),
      };
    },
    // Every repairable fixture below is treated as having a repair, which is
    // what makes an unsuppressed `--repair` command possible.
    getDiagnosticCheck: (id: string) => ({
      id,
      repair: { description: 'test repair', requirements: [] as string[] },
    }),
    normalizeContentPaths: (overrides: object) => ({
      musicDir: 'Music',
      moviesDir: 'Movies',
      tvShowsDir: 'TV Shows',
      ...overrides,
    }),
  };
}

async function runDoctor(ctx: CliContext, out: OutputContext, core: unknown): Promise<void> {
  const deps: DoctorDeps = {
    loadCore: async () => core as typeof import('@podkit/core'),
    getDeviceManager: () => fakeManager(),
  };
  await runWithContext(ctx, () =>
    runAction(out, () => runDoctorDiagnostics('/tmp/read-only-ipod', undefined, out, {}, deps))
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('doctor on a read-only device', () => {
  it('asks the readiness pipeline for a read, not a write', async () => {
    let seen: string | undefined = 'never-called';
    const { out } = makeOut('json');
    await runDoctor(
      makeContext('nano7g'),
      out,
      makeFakeCore({
        generationId: 'nano_7g',
        captureRequiredAccess: (requiredAccess) => {
          seen = requiredAccess;
        },
      })
    );

    expect(seen).toBe('read');
  });

  it('runs its checks and reports the device healthy instead of refusing', async () => {
    const { out, stdout, exitCode } = makeOut('json');
    await runDoctor(
      makeContext('nano7g'),
      out,
      makeFakeCore({
        generationId: 'nano_7g',
        checks: [
          check({ id: 'codec-encoders', status: 'pass', scope: 'system' }),
          check({ id: 'artwork-rebuild', status: 'pass' }),
          check({ id: 'orphan-files', status: 'pass' }),
        ],
      })
    );

    const payload = stdout.json<DoctorJsonOutput>();
    expect(payload.checks.map((c) => c.id)).toEqual([
      'codec-encoders',
      'artwork-rebuild',
      'orphan-files',
    ]);
    expect(payload.readiness?.level).toBe('ready');
    expect(payload.healthy).toBe(true);
    expect(payload.status).toBe('ok');
    // Being read-only is not, by itself, a problem to report.
    expect(exitCode.get() ?? 0).toBe(0);
  });

  it('marks the access tier in the JSON envelope', async () => {
    const { out, stdout } = makeOut('json');
    await runDoctor(makeContext('nano7g'), out, makeFakeCore({ generationId: 'nano_7g' }));

    expect(stdout.json<DoctorJsonOutput>().access).toBe('read-only');
  });

  it('announces the tier and why no repairs are offered', async () => {
    const { out, stdout } = makeOut('text');
    await runDoctor(makeContext('nano7g'), out, makeFakeCore({ generationId: 'nano_7g' }));

    const text = stdout.text();
    expect(text).toContain('Read-only device');
    expect(text).toContain(NANO_7G_REASON.headline);
    expect(text).toContain('podkit device archive');
  });

  it('reports a repairable finding but withholds the repair command', async () => {
    const { out, stdout, stderr, exitCode } = makeOut('text');
    await runDoctor(
      makeContext('nano7g'),
      out,
      makeFakeCore({
        generationId: 'nano_7g',
        checks: [
          check({
            id: 'artwork-rebuild',
            name: 'Artwork Integrity',
            status: 'fail',
            summary: '12 corrupt artwork entries',
            repairable: true,
            hasRepair: true,
          }),
        ],
      })
    );

    const text = `${stdout.text()}\n${stderr.text()}`;
    // The finding is reported in full — the user owns the hardware.
    expect(text).toContain('Artwork Integrity');
    expect(text).toContain('12 corrupt artwork entries');
    // ...but with no command podkit would refuse to run.
    expect(text).not.toContain('--repair');
    expect(text).toContain(READ_ONLY_NO_REPAIR_NOTE);
    // A real finding is still a non-zero exit.
    expect(exitCode.get()).toBe(2);
  });

  it('withholds readiness-stage fixes that write to the device', async () => {
    const { out, stdout, stderr } = makeOut('text');
    await runDoctor(
      makeContext('nano7g'),
      out,
      makeFakeCore({ generationId: 'nano_7g', stages: SYSINFO_WARNS })
    );

    const text = `${stdout.text()}\n${stderr.text()}`;
    expect(text).toContain('SysInfoExtended is missing');
    expect(text).not.toContain('--repair sysinfo-extended');
    expect(text).not.toContain('podkit device init');
    expect(text).toContain(READ_ONLY_NO_REPAIR_NOTE);
  });
});

describe('doctor --repair on a read-only device', () => {
  it('is refused before any device handle is opened', async () => {
    // D476 = iPod nano (7th generation) — a real read-only generation, so
    // the refusal is pinned to the access tier rather than to a hand-written
    // reason string.
    const model = identify({ from: 'sysinfo', modelNumStr: 'D476' });
    expect(model?.generationId).toBe('nano_7g');

    let opened = false;
    let repaired = false;
    const core = {
      assessIpodIdentity: async () => ({ model }),
      IpodDatabase: {
        open: async () => {
          opened = true;
          return { close: () => {} };
        },
      },
      DOCS_URLS: { supportedDevices: 'https://example.invalid/supported' },
    };
    const repairableCheck = {
      id: 'artwork-rebuild',
      name: 'Artwork Integrity',
      scope: 'database-health' as const,
      check: async () => ({ status: 'fail' as const, summary: 'corrupt', repairable: true }),
      repair: {
        description: 'rebuild artwork',
        requirements: ['writable-device', 'database'],
        run: async () => {
          repaired = true;
          return { success: true, summary: 'done' };
        },
      },
    };

    const { out } = makeOut('text');
    const promise = runRepair(
      '/tmp/read-only-ipod',
      repairableCheck as unknown as Parameters<typeof runRepair>[1],
      {},
      out,
      makeContext('nano7g').config,
      // No `assessIpodIdentity` override — the refusal must come from the
      // core surface the production path uses.
      { loadCore: async () => core as unknown as typeof import('@podkit/core') }
    );

    await expect(promise).rejects.toBeInstanceOf(CliError);
    expect(opened).toBe(false);
    expect(repaired).toBe(false);
  });
});

describe('doctor on a syncable device', () => {
  it('still offers the readiness-stage fix command', async () => {
    const { out, stdout, stderr } = makeOut('text');
    await runDoctor(
      makeContext('nano2g'),
      out,
      makeFakeCore({ generationId: 'nano_2g', stages: SYSINFO_WARNS })
    );

    const text = `${stdout.text()}\n${stderr.text()}`;
    expect(text).toContain('podkit doctor --repair sysinfo-extended -d nano2g');
    expect(text).not.toContain(READ_ONLY_NO_REPAIR_NOTE);
    expect(text).not.toContain('Read-only device');
  });

  it('still offers the repair command for a repairable finding', async () => {
    const { out, stdout, stderr } = makeOut('text');
    await runDoctor(
      makeContext('nano2g'),
      out,
      makeFakeCore({
        generationId: 'nano_2g',
        checks: [
          check({
            id: 'artwork-rebuild',
            name: 'Artwork Integrity',
            status: 'fail',
            summary: '12 corrupt artwork entries',
            repairable: true,
            hasRepair: true,
          }),
        ],
      })
    );

    const text = `${stdout.text()}\n${stderr.text()}`;
    expect(text).toContain('podkit doctor --repair artwork-rebuild -d nano2g');
    expect(text).not.toContain(READ_ONLY_NO_REPAIR_NOTE);
  });
});
