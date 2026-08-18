/**
 * In-process unit tests for the `doctor` command's argv-level validation.
 *
 * The repair-requires-device / repair-requires-collection / diagnostic-only
 * paths are covered end-to-end in `doctor.e2e.test.ts`. What's left for this
 * unit tier is the Commander wiring of `--repair`'s `.choices()` list — that
 * list lives in our command definition and we want to lock its contract.
 */

import { describe, it, expect } from 'bun:test';
import { Command } from 'commander';
import {
  doctorCommand,
  resolveDoctorScopes,
  runSystemOnlyDoctor,
  runRepair,
  DoctorErrorCodes,
} from './doctor.js';
import { OutputContext, BufferExitCodeSink } from '../output/index.js';
import type { CliError } from '../errors.js';

const repairOption = doctorCommand.options.find((o) => o.long === '--repair');
if (!repairOption) {
  throw new Error('doctorCommand has no --repair option — test setup invalid');
}

describe('doctor --repair .choices()', () => {
  it.concurrent('lists exactly the supported check IDs', () => {
    expect(repairOption.argChoices).toEqual([
      'artwork-rebuild',
      'artwork-reset',
      'debris-files',
      'debris-transcode-tmp',
      'orphan-files',
      'sysinfo-consistency',
      'sysinfo-extended',
      'sysinfo-modelnum-mismatch',
      'sysinfo-modelnum-missing',
      'udev-rule',
    ]);
  });

  // Drift guard: the commander choices() list above is a hardcoded copy of
  // the canonical PUBLIC_REPAIR_IDS in @podkit/core. If the registry adds a
  // new public repair ID and the CLI's choices() isn't updated, commander
  // will reject the new ID at parse time — silently breaking the user-facing
  // surface. This pin makes that drift impossible to land green.
  it.concurrent('stays in lockstep with @podkit/core PUBLIC_REPAIR_IDS', async () => {
    const { PUBLIC_REPAIR_IDS } = await import('@podkit/core');
    expect([...(repairOption.argChoices ?? [])].sort()).toEqual([...PUBLIC_REPAIR_IDS].sort());
  });

  it.concurrent('rejects an unknown check ID at parse time, before action runs', async () => {
    // Build a throwaway parent program around a stub command that mirrors
    // doctor's --repair option. The stub action is a no-op — we only care
    // that Commander's choices() validation fires before action invocation.
    let actionRan = false;
    const stub = new Command('doctor').addOption(repairOption).action(() => {
      actionRan = true;
    });
    stub.exitOverride();
    stub.configureOutput({ writeOut: () => {}, writeErr: () => {} });

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    program.addCommand(stub);

    let err: unknown;
    try {
      await program.parseAsync(['doctor', '--repair', 'nonexistent-check'], { from: 'user' });
    } catch (e) {
      err = e;
    }

    expect(err).toBeDefined();
    expect((err as { code?: string }).code).toBe('commander.invalidArgument');
    expect((err as Error).message).toContain('nonexistent-check');
    expect(actionRan).toBe(false);
  });

  it.concurrent('accepts a known check ID at parse time', async () => {
    let actionRan = false;
    const stub = new Command('doctor').addOption(repairOption).action(() => {
      actionRan = true;
    });
    stub.exitOverride();
    stub.configureOutput({ writeOut: () => {}, writeErr: () => {} });

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    program.addCommand(stub);

    await program.parseAsync(['doctor', '--repair', 'artwork-rebuild'], { from: 'user' });
    expect(actionRan).toBe(true);
  });
});

// ── --scope flag ───────────────────────────────────────────────────────────

const scopeOption = doctorCommand.options.find((o) => o.long === '--scope');
if (!scopeOption) {
  throw new Error('doctorCommand has no --scope option — test setup invalid');
}

describe('doctor --scope option', () => {
  it.concurrent('declares system, device, all as the only valid values', () => {
    expect(scopeOption.argChoices).toEqual(['system', 'device', 'all']);
  });

  it.concurrent('has no commander-level default (defaulted at use site instead)', () => {
    // Reason: `--system-only` needs to distinguish "user wrote --scope all"
    // from "scope absent". A commander default would prevent that.
    // resolveDoctorScopes / runDoctorAction apply `scope ?? 'all'`.
    expect(scopeOption.defaultValue).toBeUndefined();
  });

  it.concurrent('rejects unknown scope values at parse time', async () => {
    let actionRan = false;
    const stub = new Command('doctor').addOption(scopeOption).action(() => {
      actionRan = true;
    });
    stub.exitOverride();
    stub.configureOutput({ writeOut: () => {}, writeErr: () => {} });

    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    program.addCommand(stub);

    let err: unknown;
    try {
      await program.parseAsync(['doctor', '--scope', 'world'], { from: 'user' });
    } catch (e) {
      err = e;
    }

    expect(err).toBeDefined();
    expect((err as { code?: string }).code).toBe('commander.invalidArgument');
    expect((err as Error).message).toContain('world');
    expect(actionRan).toBe(false);
  });
});

// ── resolveDoctorScopes() matrix ───────────────────────────────────────────
//
// AC #6: cover {scope ∈ system|device|all} × {--no-system on|off} × {--json
// on|off}. --json is purely an envelope toggle — it never affects which
// checks run — so each cell asserts that property explicitly via a same-
// outcome pair (json true/false ⇒ identical scopes).

describe('resolveDoctorScopes()', () => {
  // The user-facing `--scope` flag still accepts `system | device | all`.
  // After the 3-way scope refactor, `device` expands to both device-side
  // internal scopes (`device-readiness` + `database-health`).
  type InternalScope = 'system' | 'device-readiness' | 'database-health';
  const DEVICE: ReadonlyArray<InternalScope> = ['device-readiness', 'database-health'];
  const ALL: ReadonlyArray<InternalScope> = ['system', ...DEVICE];

  const cases: Array<{
    scope: 'system' | 'device' | 'all' | undefined;
    system: boolean | undefined;
    expected: ReadonlyArray<InternalScope>;
    label: string;
  }> = [
    { scope: 'system', system: undefined, expected: ['system'], label: '--scope system' },
    { scope: 'system', system: true, expected: ['system'], label: '--scope system (system=true)' },
    {
      scope: 'system',
      system: false,
      expected: ['system'],
      label: '--scope system + --no-system (scope wins)',
    },
    { scope: 'device', system: undefined, expected: DEVICE, label: '--scope device' },
    { scope: 'device', system: true, expected: DEVICE, label: '--scope device (system=true)' },
    {
      scope: 'device',
      system: false,
      expected: DEVICE,
      label: '--scope device + --no-system',
    },
    {
      scope: 'all',
      system: undefined,
      expected: ALL,
      label: '--scope all (default)',
    },
    {
      scope: 'all',
      system: true,
      expected: ALL,
      label: '--scope all + system=true',
    },
    { scope: 'all', system: false, expected: DEVICE, label: '--scope all + --no-system' },
    {
      scope: undefined,
      system: undefined,
      expected: ALL,
      label: 'unset scope (legacy default)',
    },
    {
      scope: undefined,
      system: true,
      expected: ALL,
      label: 'unset scope + system=true (legacy)',
    },
    {
      scope: undefined,
      system: false,
      expected: DEVICE,
      label: 'unset scope + --no-system (legacy)',
    },
  ];

  for (const c of cases) {
    it.concurrent(`${c.label} ⇒ [${c.expected.join(', ')}]`, () => {
      expect(resolveDoctorScopes({ scope: c.scope, system: c.system })).toEqual(c.expected);
    });
  }

  // `--system-only` is sugar for `--scope system`. Cover that the sugar
  // wins over any other scope value the user might pass alongside it, and
  // that it's a no-op when --scope=system anyway.
  describe('--system-only sugar', () => {
    it.concurrent('--system-only ⇒ [system]', () => {
      expect(resolveDoctorScopes({ systemOnly: true })).toEqual(['system']);
    });
    it.concurrent('--system-only overrides unset scope', () => {
      expect(resolveDoctorScopes({ systemOnly: true, scope: undefined })).toEqual(['system']);
    });
    it.concurrent('--system-only with --scope system is a no-op', () => {
      expect(resolveDoctorScopes({ systemOnly: true, scope: 'system' })).toEqual(['system']);
    });
    it.concurrent('--system-only false (absent) falls through to --scope default', () => {
      expect(resolveDoctorScopes({ systemOnly: false, scope: 'device' })).toEqual(DEVICE);
    });
  });
});

// ── runSystemOnlyDoctor: scope is forwarded to runDiagnostics ─────────────

interface FakeCheckResult {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  summary: string;
  repairable: boolean;
  hasRepair: boolean;
  repairOnly: boolean;
  scope: 'system' | 'device-readiness' | 'database-health';
  details?: Record<string, unknown>;
  docsUrl?: string;
}

function makeFakeCore(opts: {
  checks: FakeCheckResult[];
  capture: {
    scopes?: ReadonlyArray<'system' | 'device-readiness' | 'database-health'>;
    mountPoint?: string;
    deviceType?: string;
  };
}): unknown {
  return {
    runDiagnostics: async (input: {
      scopes?: ReadonlyArray<'system' | 'device-readiness' | 'database-health'>;
      mountPoint: string;
      deviceType: string;
    }) => {
      opts.capture.scopes = input.scopes;
      opts.capture.mountPoint = input.mountPoint;
      opts.capture.deviceType = input.deviceType;
      const healthy = opts.checks.every((c) => c.status === 'pass' || c.status === 'skip');
      return {
        mountPoint: input.mountPoint,
        deviceModel: 'Unknown',
        deviceType: input.deviceType,
        checks: opts.checks,
        healthy,
      };
    },
  };
}

function makeTestOutputContext(): { out: OutputContext; exitSink: BufferExitCodeSink } {
  const exitSink = new BufferExitCodeSink();
  const nullSink = { write: () => true };
  return {
    out: new OutputContext({
      mode: 'json',
      quiet: false,
      verbose: 0,
      color: false,
      tips: false,
      tty: false,
      stdout: nullSink,
      stderr: nullSink,
      exitCode: exitSink,
    }),
    exitSink,
  };
}

describe('runSystemOnlyDoctor()', () => {
  it.concurrent('forwards scopes=[system] and an empty mountPoint to runDiagnostics', async () => {
    const capture: {
      scopes?: ReadonlyArray<'system' | 'device-readiness' | 'database-health'>;
      mountPoint?: string;
      deviceType?: string;
    } = {};
    const fakeCore = makeFakeCore({
      checks: [
        {
          id: 'ffmpeg',
          name: 'FFmpeg',
          status: 'pass',
          summary: 'FFmpeg detected',
          repairable: false,
          hasRepair: false,
          repairOnly: false,
          scope: 'system',
        },
      ],
      capture,
    });

    const { out, exitSink } = makeTestOutputContext();
    await runSystemOnlyDoctor(
      out,
      {},
      {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
      }
    );

    expect(capture.scopes).toEqual(['system']);
    expect(capture.mountPoint).toBe('');
    expect(capture.deviceType).toBe('ipod');
    expect(exitSink.get()).toBeUndefined();
  });

  it.concurrent('sets exit code 2 when a system check fails', async () => {
    const capture: {
      scopes?: ReadonlyArray<'system' | 'device-readiness' | 'database-health'>;
      mountPoint?: string;
      deviceType?: string;
    } = {};
    const fakeCore = makeFakeCore({
      checks: [
        {
          id: 'ffmpeg',
          name: 'FFmpeg',
          status: 'fail',
          summary: 'FFmpeg not found',
          repairable: false,
          hasRepair: false,
          repairOnly: false,
          scope: 'system',
        },
      ],
      capture,
    });

    const { out, exitSink } = makeTestOutputContext();
    await runSystemOnlyDoctor(
      out,
      {},
      {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
      }
    );

    expect(exitSink.get()).toBe(2);
  });

  it.concurrent('sets exit code 2 when a system check warns', async () => {
    const capture: {
      scopes?: ReadonlyArray<'system' | 'device-readiness' | 'database-health'>;
      mountPoint?: string;
      deviceType?: string;
    } = {};
    const fakeCore = makeFakeCore({
      checks: [
        {
          id: 'codec-encoders',
          name: 'Codec Encoders',
          status: 'warn',
          summary: 'AAC encoder missing',
          repairable: false,
          hasRepair: false,
          repairOnly: false,
          scope: 'system',
        },
      ],
      capture,
    });

    const { out, exitSink } = makeTestOutputContext();
    await runSystemOnlyDoctor(
      out,
      {},
      {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
      }
    );

    // warn counts as unhealthy — matches TASK-308 / existing doctor semantics
    expect(exitSink.get()).toBe(2);
  });

  it.concurrent('emits JSON envelope containing only system checks + healthy flag', async () => {
    const capture: {
      scopes?: ReadonlyArray<'system' | 'device-readiness' | 'database-health'>;
      mountPoint?: string;
      deviceType?: string;
    } = {};
    const fakeCore = makeFakeCore({
      checks: [
        {
          id: 'ffmpeg',
          name: 'FFmpeg',
          status: 'pass',
          summary: 'ok',
          repairable: false,
          hasRepair: false,
          repairOnly: false,
          scope: 'system',
        },
        {
          id: 'inquiry-methods',
          name: 'Inquiry',
          status: 'pass',
          summary: 'ok',
          repairable: false,
          hasRepair: false,
          repairOnly: false,
          scope: 'system',
        },
      ],
      capture,
    });

    const chunks: string[] = [];
    const stdout = {
      write: (chunk: string) => {
        chunks.push(chunk);
        return true;
      },
    };
    const out = new OutputContext({
      mode: 'json',
      quiet: false,
      verbose: 0,
      color: false,
      tips: false,
      tty: false,
      stdout,
      stderr: { write: () => true },
      exitCode: new BufferExitCodeSink(),
    });
    await runSystemOnlyDoctor(
      out,
      {},
      {
        loadCore: async () => fakeCore as typeof import('@podkit/core'),
      }
    );

    const payload = JSON.parse(chunks.join(''));
    expect(payload.scope).toBe('system');
    expect(payload.healthy).toBe(true);
    expect(payload.status).toBe('ok');
    expect(Array.isArray(payload.checks)).toBe(true);
    expect(payload.checks.map((c: { id: string }) => c.id)).toEqual(['ffmpeg', 'inquiry-methods']);
    expect(payload.mountPoint).toBeUndefined();
    expect(payload.deviceType).toBeUndefined();
    expect(payload.readiness).toBeUndefined();
  });
});

// ── Bug 2: runRepair must not open the iTunesDB unless the repair needs it ──

describe('runRepair — database gate (Bug 2: chicken-and-egg)', () => {
  function makeOut(): OutputContext {
    const exitSink = new BufferExitCodeSink();
    const nullSink = { write: () => true };
    return new OutputContext({
      mode: 'json',
      quiet: true,
      verbose: 0,
      color: false,
      tips: false,
      tty: false,
      stdout: nullSink,
      stderr: nullSink,
      exitCode: exitSink,
    });
  }

  // Build a fake `@podkit/core`-shape just rich enough for `runRepair` to
  // execute. The IpodDatabase.open() stub throws to prove the gate is
  // working — if the gate fails, the test bubbles IPOD_DATABASE_OPEN_FAILED.
  function makeFakeCore(opts: { dbThrows?: boolean } = {}) {
    return {
      IpodDatabase: {
        open: async () => {
          if (opts.dbThrows) {
            throw new Error("Couldn't find an iPod database on /tmp/fresh-ipod");
          }
          return { close: () => {} };
        },
      },
    } as unknown as typeof import('@podkit/core');
  }

  it('does NOT open the iTunesDB when the repair lacks a database requirement', async () => {
    let openCalls = 0;
    const fakeCore = {
      IpodDatabase: {
        open: async () => {
          openCalls += 1;
          throw new Error("Couldn't find an iPod database");
        },
      },
    } as unknown as typeof import('@podkit/core');

    let repairRan = false;
    const check = {
      id: 'sysinfo-extended',
      name: 'SysInfoExtended',
      repairOnly: true,
      repair: {
        description: 'fake',
        requirements: ['writable-device'] as const,
        async run() {
          repairRan = true;
          return { success: true, summary: 'ok' };
        },
      },
    } as unknown as Parameters<typeof runRepair>[1];

    await runRepair(
      '/tmp/fresh-ipod',
      check,
      { dryRun: true },
      makeOut(),
      // Minimal config — runRepair only reads config.music when the repair
      // requires a source-collection, which this one doesn't.
      { music: {} } as unknown as Parameters<typeof runRepair>[4],
      { loadCore: async () => fakeCore }
    );

    expect(openCalls).toBe(0);
    expect(repairRan).toBe(true);
  });

  it('DOES open the iTunesDB when the repair declares the database requirement', async () => {
    let openCalls = 0;
    const fakeCore = {
      IpodDatabase: {
        open: async () => {
          openCalls += 1;
          return { close: () => {} };
        },
      },
    } as unknown as typeof import('@podkit/core');

    let repairRan = false;
    const check = {
      id: 'orphan-files',
      name: 'Orphan files',
      repair: {
        description: 'fake',
        requirements: ['writable-device', 'database'] as const,
        async run() {
          repairRan = true;
          return { success: true, summary: 'ok' };
        },
      },
    } as unknown as Parameters<typeof runRepair>[1];

    await runRepair(
      '/tmp/some-ipod',
      check,
      { dryRun: true },
      makeOut(),
      { music: {} } as unknown as Parameters<typeof runRepair>[4],
      { loadCore: async () => fakeCore }
    );

    expect(openCalls).toBe(1);
    expect(repairRan).toBe(true);
  });

  it('surfaces the open failure with IPOD_DATABASE_OPEN_FAILED only when the database is required', async () => {
    // Negative regression: if a repair declares `'database'` and the open
    // genuinely fails, the user should see the dedicated error code so the
    // CLI can recommend `podkit device init`.
    const fakeCore = makeFakeCore({ dbThrows: true });
    const check = {
      id: 'orphan-files',
      name: 'Orphan files',
      repair: {
        description: 'fake',
        requirements: ['writable-device', 'database'] as const,
        async run() {
          return { success: true, summary: 'ok' };
        },
      },
    } as unknown as Parameters<typeof runRepair>[1];

    let caught: CliError | undefined;
    try {
      await runRepair(
        '/tmp/some-ipod',
        check,
        { dryRun: true },
        makeOut(),
        { music: {} } as unknown as Parameters<typeof runRepair>[4],
        { loadCore: async () => fakeCore }
      );
    } catch (err) {
      caught = err as CliError;
    }
    expect(caught).toBeDefined();
    expect((caught as unknown as { code?: string }).code).toBe(
      DoctorErrorCodes.IPOD_DATABASE_OPEN_FAILED
    );
  });
});
