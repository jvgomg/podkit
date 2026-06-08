/**
 * Unit tests for the apply-state orchestrator (`applyState`).
 *
 * Strategy: scripted `SubprocessRunner` that fakes every `limactl` call. We
 * assert both the sequence of subcommands and error propagation.
 *
 * `applyState` is a single path: copy apply-state.sh → chmod → exec.
 * No snapshot fast/slow paths exist; those were deleted in May 2026 (see
 * ADR-016 §"Snapshot-based state layering (historical)").
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
// Copy → chmod → exec sequence
// ---------------------------------------------------------------------------

describe('applyState: copy → chmod → exec sequence', () => {
  it('issues copy, chmod, and exec in order', async () => {
    const { runner, calls } = makeScriptedRunner([
      ok(), // limactl copy apply-state.sh
      ok(), // chmod
      ok('[apply-state] applied: no-ffmpeg\n'), // exec
    ]);

    await applyState({
      vmName: 'podkit-device-harness',
      stateId: 'no-ffmpeg',
      subprocess: runner,
      applyStateScript: SCRIPT_PATH,
    });

    expect(calls).toHaveLength(3);

    expect(calls[0]!.args[0]).toBe('copy');
    expect(calls[0]!.args[1]).toBe(SCRIPT_PATH);
    expect(calls[0]!.args[2]).toBe('podkit-device-harness:/tmp/apply-state.sh');

    expect(calls[1]!.args).toEqual([
      'shell',
      'podkit-device-harness',
      '--',
      'sudo',
      'chmod',
      '0755',
      '/tmp/apply-state.sh',
    ]);

    expect(calls[2]!.args).toEqual([
      'shell',
      'podkit-device-harness',
      '--',
      'sudo',
      '/tmp/apply-state.sh',
      'no-ffmpeg',
    ]);
  });

  it('returns void (no snapshot metadata in the result)', async () => {
    const { runner } = makeScriptedRunner([ok(), ok(), ok()]);
    const result = await applyState({
      vmName: 'podkit-device-harness',
      stateId: 'healthy',
      subprocess: runner,
      applyStateScript: SCRIPT_PATH,
    });
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Every registered SystemState id is supported
// ---------------------------------------------------------------------------

describe('applyState: every SystemState id is supported', () => {
  const allStates: SystemStateId[] = [
    'healthy',
    'no-ffmpeg',
    'no-libgpod',
    'no-udev',
    'no-sg-perms',
    'corrupt-configfs',
    'device-mount-near-full',
    'device-mount-fits-estimate-failed-sweep',
    'device-mount-fits-estimate-source-drifts',
  ];

  for (const stateId of allStates) {
    it(`applies ${stateId} via copy → chmod → exec`, async () => {
      const { runner, calls } = makeScriptedRunner([
        ok(), // copy
        ok(), // chmod
        ok(), // exec
      ]);

      await applyState({
        vmName: 'podkit-device-harness',
        stateId,
        subprocess: runner,
        applyStateScript: SCRIPT_PATH,
      });

      expect(calls).toHaveLength(3);
      // The exec call must pass the stateId verbatim.
      expect(calls[2]!.args).toContain(stateId);
      expect(calls[2]!.args).toContain('/tmp/apply-state.sh');
    });
  }
});

// ---------------------------------------------------------------------------
// Error propagation
// ---------------------------------------------------------------------------

describe('applyState: error propagation', () => {
  it('propagates a copy failure with a descriptive message', async () => {
    const { runner } = makeScriptedRunner([
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

  it('propagates a chmod failure', async () => {
    const { runner } = makeScriptedRunner([
      ok(), // copy succeeds
      fail(1, 'chmod: operation not permitted'), // chmod fails
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
    expect(caught!.message).toContain('failed to chmod');
    expect(caught!.message).toContain('operation not permitted');
  });

  it('propagates an apply-state.sh failure with the script stderr', async () => {
    const { runner } = makeScriptedRunner([
      ok(), // copy
      ok(), // chmod
      fail(1, 'apply-state.sh: must be run as root (use sudo)'), // exec fails
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
