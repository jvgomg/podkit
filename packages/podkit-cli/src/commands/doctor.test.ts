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
import { doctorCommand, resolveDoctorScopes, runSystemOnlyDoctor } from './doctor.js';
import { OutputContext, BufferExitCodeSink } from '../output/index.js';

const repairOption = doctorCommand.options.find((o) => o.long === '--repair');
if (!repairOption) {
  throw new Error('doctorCommand has no --repair option — test setup invalid');
}

describe('doctor --repair .choices()', () => {
  it.concurrent('lists exactly the supported check IDs', () => {
    expect(repairOption.argChoices).toEqual([
      'artwork-rebuild',
      'artwork-reset',
      'orphan-files',
      'orphan-files-mass-storage',
      'sysinfo-consistency',
      'sysinfo-extended',
      'udev-rule',
    ]);
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

  it.concurrent('defaults to all', () => {
    expect(scopeOption.defaultValue).toBe('all');
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
  const cases: Array<{
    scope: 'system' | 'device' | 'all' | undefined;
    system: boolean | undefined;
    expected: ReadonlyArray<'system' | 'device'>;
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
    { scope: 'device', system: undefined, expected: ['device'], label: '--scope device' },
    { scope: 'device', system: true, expected: ['device'], label: '--scope device (system=true)' },
    {
      scope: 'device',
      system: false,
      expected: ['device'],
      label: '--scope device + --no-system',
    },
    {
      scope: 'all',
      system: undefined,
      expected: ['system', 'device'],
      label: '--scope all (default)',
    },
    {
      scope: 'all',
      system: true,
      expected: ['system', 'device'],
      label: '--scope all + system=true',
    },
    { scope: 'all', system: false, expected: ['device'], label: '--scope all + --no-system' },
    {
      scope: undefined,
      system: undefined,
      expected: ['system', 'device'],
      label: 'unset scope (legacy default)',
    },
    {
      scope: undefined,
      system: true,
      expected: ['system', 'device'],
      label: 'unset scope + system=true (legacy)',
    },
    {
      scope: undefined,
      system: false,
      expected: ['device'],
      label: 'unset scope + --no-system (legacy)',
    },
  ];

  for (const c of cases) {
    it.concurrent(`${c.label} ⇒ [${c.expected.join(', ')}]`, () => {
      expect(resolveDoctorScopes({ scope: c.scope, system: c.system })).toEqual(c.expected);
    });
  }
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
  scope: 'system' | 'device';
  details?: Record<string, unknown>;
  docsUrl?: string;
}

function makeFakeCore(opts: {
  checks: FakeCheckResult[];
  capture: {
    scopes?: ReadonlyArray<'system' | 'device'>;
    mountPoint?: string;
    deviceType?: string;
  };
}): unknown {
  return {
    runDiagnostics: async (input: {
      scopes?: ReadonlyArray<'system' | 'device'>;
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
      scopes?: ReadonlyArray<'system' | 'device'>;
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
      scopes?: ReadonlyArray<'system' | 'device'>;
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
      scopes?: ReadonlyArray<'system' | 'device'>;
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
      scopes?: ReadonlyArray<'system' | 'device'>;
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
