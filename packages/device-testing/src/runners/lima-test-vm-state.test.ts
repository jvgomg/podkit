/**
 * Unit tests for the snapshot-orchestration helper (`applyState`).
 *
 * Strategy: scripted `SubprocessRunner` that fakes every `limactl` call. We
 * assert both the sequence of subcommands and the helper's return value.
 *
 * Covers AC4 (state initialisation flow works end-to-end: snapshot exists →
 * restore; snapshot missing → apply + create) and AC5 (all 6 SystemState
 * snapshots can be created from a freshly provisioned VM — exercised by the
 * "every state id" test below).
 */

import { describe, it, expect } from 'bun:test';
import { applyState } from './lima-test-vm-state.js';
import type { SubprocessRunner, SubprocessRunOpts, SubprocessRunResult } from '../subprocess.js';
import type { SystemStateId } from '../system-states/types.js';

// ---------------------------------------------------------------------------
// Scripted SubprocessRunner
// ---------------------------------------------------------------------------

interface ScriptedCall {
  command: string;
  args: string[];
  opts?: SubprocessRunOpts;
}

type Responder =
  | SubprocessRunResult
  | Error
  | ((call: ScriptedCall) => SubprocessRunResult | Promise<SubprocessRunResult>);

function makeScriptedRunner(script: Responder[]): {
  runner: SubprocessRunner;
  calls: ScriptedCall[];
} {
  const calls: ScriptedCall[] = [];
  let i = 0;
  return {
    calls,
    runner: {
      async run(command, args, opts) {
        const call: ScriptedCall = { command, args, opts };
        calls.push(call);
        const responder = script[i++];
        if (responder === undefined) {
          throw new Error(`scripted runner exhausted at call ${i}: ${command} ${args.join(' ')}`);
        }
        if (responder instanceof Error) throw responder;
        if (typeof responder === 'function') return responder(call);
        return responder;
      },
    },
  };
}

const ok = (stdout = ''): SubprocessRunResult => ({
  stdout,
  stderr: '',
  exitCode: 0,
});

const fail = (exitCode: number, stderr: string): SubprocessRunResult => ({
  stdout: '',
  stderr,
  exitCode,
});

const SCRIPT_PATH = '/fixtures/apply-state.sh';

// ---------------------------------------------------------------------------
// Fast path: snapshot already exists → restore + return.
// ---------------------------------------------------------------------------

describe('applyState (fast path: snapshot exists)', () => {
  it('restores the snapshot when `base-<stateId>` already exists', async () => {
    const { runner, calls } = makeScriptedRunner([
      // snapshot list (existence probe): contains base-no-ffmpeg
      ok('base-healthy\nbase-no-ffmpeg\n'),
      // snapshot apply
      ok(),
    ]);

    const result = await applyState({
      vmName: 'podkit-device-harness',
      stateId: 'no-ffmpeg',
      subprocess: runner,
      applyStateScript: SCRIPT_PATH,
    });

    expect(result).toEqual({
      snapshotName: 'base-no-ffmpeg',
      created: false,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.args).toEqual(['snapshot', 'list', 'podkit-device-harness', '--quiet']);
    expect(calls[1]!.args).toEqual([
      'snapshot',
      'apply',
      'podkit-device-harness',
      '--tag',
      'base-no-ffmpeg',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Slow path: snapshot missing → restore base-healthy → copy + chmod + apply
// → create snapshot.
// ---------------------------------------------------------------------------

describe('applyState (slow path: snapshot missing, healthy exists)', () => {
  it('restores base-healthy, runs apply-state.sh, captures snapshot', async () => {
    const { runner, calls } = makeScriptedRunner([
      // probe: base-no-ffmpeg absent (only base-healthy present)
      ok('base-healthy\n'),
      // probe: base-healthy exists
      ok('base-healthy\n'),
      // restore base-healthy
      ok(),
      // limactl copy apply-state.sh
      ok(),
      // chmod
      ok(),
      // apply-state.sh no-ffmpeg
      ok('[apply-state] removed: ffmpeg\n[apply-state] applied: no-ffmpeg\n'),
      // snapshot create
      ok(),
    ]);

    const result = await applyState({
      vmName: 'podkit-device-harness',
      stateId: 'no-ffmpeg',
      subprocess: runner,
      applyStateScript: SCRIPT_PATH,
    });

    expect(result).toEqual({
      snapshotName: 'base-no-ffmpeg',
      created: true,
    });
    expect(calls).toHaveLength(7);
    // Probe + healthy probe + restore healthy + copy + chmod + apply + create.
    expect(calls[0]!.args).toContain('list');
    expect(calls[1]!.args).toContain('list');
    expect(calls[2]!.args).toEqual([
      'snapshot',
      'apply',
      'podkit-device-harness',
      '--tag',
      'base-healthy',
    ]);
    expect(calls[3]!.args[0]).toBe('copy');
    expect(calls[3]!.args[1]).toBe(SCRIPT_PATH);
    expect(calls[3]!.args[2]).toBe('podkit-device-harness:/tmp/apply-state.sh');
    expect(calls[4]!.args).toEqual([
      'shell',
      'podkit-device-harness',
      '--',
      'sudo',
      'chmod',
      '0755',
      '/tmp/apply-state.sh',
    ]);
    expect(calls[5]!.args).toEqual([
      'shell',
      'podkit-device-harness',
      '--',
      'sudo',
      '/tmp/apply-state.sh',
      'no-ffmpeg',
    ]);
    expect(calls[6]!.args).toEqual([
      'snapshot',
      'create',
      'podkit-device-harness',
      '--tag',
      'base-no-ffmpeg',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Slow path, first-ever run: base-healthy itself missing → no restore step,
// just apply directly.
// ---------------------------------------------------------------------------

describe('applyState (first run: no snapshots at all)', () => {
  it('skips healthy-restore when base-healthy itself is missing', async () => {
    const { runner, calls } = makeScriptedRunner([
      // probe: base-no-ffmpeg absent (empty list)
      ok(''),
      // probe: base-healthy also absent
      ok(''),
      // limactl copy apply-state.sh
      ok(),
      // chmod
      ok(),
      // apply-state.sh no-ffmpeg
      ok(),
      // snapshot create
      ok(),
    ]);

    const result = await applyState({
      vmName: 'podkit-device-harness',
      stateId: 'no-ffmpeg',
      subprocess: runner,
      applyStateScript: SCRIPT_PATH,
    });

    expect(result.created).toBe(true);
    expect(calls).toHaveLength(6);
    // No `snapshot apply` against `base-healthy` should appear.
    expect(
      calls.some(
        (c) => c.args[0] === 'snapshot' && c.args[1] === 'apply' && c.args.includes('base-healthy')
      )
    ).toBe(false);
  });

  it('does not probe for base-healthy when the stateId itself is `healthy`', async () => {
    // First-run healthy: probe says no snapshot, then we go straight to
    // copy → chmod → apply → create. The base-healthy existence probe must
    // not happen — that would loop on first creation.
    const { runner, calls } = makeScriptedRunner([
      // probe: base-healthy absent (empty list)
      ok(''),
      // limactl copy apply-state.sh
      ok(),
      // chmod
      ok(),
      // apply-state.sh healthy
      ok(),
      // snapshot create base-healthy
      ok(),
    ]);

    const result = await applyState({
      vmName: 'podkit-device-harness',
      stateId: 'healthy',
      subprocess: runner,
      applyStateScript: SCRIPT_PATH,
    });

    expect(result).toEqual({
      snapshotName: 'base-healthy',
      created: true,
    });
    expect(calls).toHaveLength(5);
    // Exactly one snapshot-list call (the initial probe). No second probe
    // for base-healthy as a starting point.
    const listCalls = calls.filter((c) => c.args[0] === 'snapshot' && c.args[1] === 'list');
    expect(listCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC5: every registered SystemState id can be applied
// ---------------------------------------------------------------------------

describe('applyState (AC5: every SystemState id is supported)', () => {
  const allStates: SystemStateId[] = [
    'healthy',
    'no-ffmpeg',
    'no-libgpod',
    'no-udev',
    'no-sg-perms',
    'corrupt-configfs',
  ];

  for (const stateId of allStates) {
    it(`creates base-${stateId} on first run`, async () => {
      // Two probes (target + base-healthy starting point) when non-healthy;
      // one probe for healthy. Then copy + chmod + apply + create.
      const probes = stateId === 'healthy' ? [ok('')] : [ok(''), ok('')];
      const { runner, calls } = makeScriptedRunner([
        ...probes,
        ok(), // copy
        ok(), // chmod
        ok(), // apply-state.sh
        ok(), // create snapshot
      ]);

      const result = await applyState({
        vmName: 'podkit-device-harness',
        stateId,
        subprocess: runner,
        applyStateScript: SCRIPT_PATH,
      });

      expect(result).toEqual({
        snapshotName: `base-${stateId}`,
        created: true,
      });
      // Apply call passes the stateId verbatim.
      const applyCall = calls.find(
        (c) =>
          c.args[0] === 'shell' &&
          c.args.includes('/tmp/apply-state.sh') &&
          c.args.includes(stateId)
      );
      expect(applyCall).toBeDefined();
      // Create snapshot uses the right tag.
      const createCall = calls.find((c) => c.args[0] === 'snapshot' && c.args[1] === 'create');
      expect(createCall?.args).toContain(`base-${stateId}`);
    });
  }
});

// ---------------------------------------------------------------------------
// Error propagation
// ---------------------------------------------------------------------------

describe('applyState (error propagation)', () => {
  it('propagates a copy failure with a descriptive message', async () => {
    const { runner } = makeScriptedRunner([
      ok(''), // initial probe (no snapshot)
      ok(''), // base-healthy probe (also missing)
      fail(1, 'permission denied'), // copy fails
    ]);
    let caught: Error | undefined;
    try {
      await applyState({
        vmName: 'podkit-device-harness',
        stateId: 'no-ffmpeg',
        subprocess: runner,
        applyStateScript: SCRIPT_PATH,
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain('failed to copy apply-state.sh');
    expect(caught!.message).toContain('permission denied');
  });

  it('propagates an apply-state.sh failure with the script stderr', async () => {
    const { runner } = makeScriptedRunner([
      ok(''), // probe
      ok(''), // healthy probe
      ok(), // copy
      ok(), // chmod
      fail(1, 'apply-state.sh: must be run as root (use sudo)'), // apply
    ]);
    let caught: Error | undefined;
    try {
      await applyState({
        vmName: 'podkit-device-harness',
        stateId: 'no-ffmpeg',
        subprocess: runner,
        applyStateScript: SCRIPT_PATH,
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain('apply-state.sh no-ffmpeg failed');
    expect(caught!.message).toContain('must be run as root');
  });

  it('propagates a snapshot-create failure', async () => {
    const { runner } = makeScriptedRunner([
      ok(''), // probe
      ok(''), // healthy probe
      ok(), // copy
      ok(), // chmod
      ok(), // apply
      fail(1, 'snapshot creation aborted'), // create
    ]);
    await expect(
      applyState({
        vmName: 'podkit-device-harness',
        stateId: 'no-ffmpeg',
        subprocess: runner,
        applyStateScript: SCRIPT_PATH,
      })
    ).rejects.toThrow(/failed to create snapshot/);
  });

  it('requires vmName and stateId', async () => {
    await expect(
      applyState({
        vmName: '',
        stateId: 'healthy',
      })
    ).rejects.toThrow(/vmName is required/);

    await expect(
      applyState({
        vmName: 'vm',
        // @ts-expect-error — deliberately invalid stateId
        stateId: '',
      })
    ).rejects.toThrow(/stateId is required/);
  });
});
