/**
 * Unit tests for the Lima snapshot helpers.
 *
 * Strategy: inject a scripted `SubprocessRunner` and assert both the
 * `limactl` argv shape and the helper's return value / error message.
 * No real `limactl`, no real VM.
 *
 * Covers AC3 (snapshot helpers exposed) and the error-propagation contract
 * for AC5 + AC7 (descriptive errors so reprovisioning users get a useful
 * message).
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  createSnapshot,
  restoreSnapshot,
  deleteSnapshot,
  snapshotExists,
  listSnapshots,
  resetSnapshotUnsupportedWarning,
} from './lima-test-vm-snapshots.js';
import type { SubprocessRunner, SubprocessRunOpts, SubprocessRunResult } from '../subprocess.js';

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

// ---------------------------------------------------------------------------
// createSnapshot
// ---------------------------------------------------------------------------

describe('createSnapshot', () => {
  it('invokes `limactl snapshot create <vm> --tag <name>`', async () => {
    const { runner, calls } = makeScriptedRunner([ok()]);
    await createSnapshot({
      vmName: 'podkit-device-harness',
      snapshotName: 'base-healthy',
      subprocess: runner,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe('limactl');
    expect(calls[0]!.args).toEqual([
      'snapshot',
      'create',
      'podkit-device-harness',
      '--tag',
      'base-healthy',
    ]);
  });

  it('throws when limactl exits non-zero (includes stderr in message)', async () => {
    const { runner } = makeScriptedRunner([fail(1, 'snapshot "base-healthy" already exists')]);
    let caught: Error | undefined;
    try {
      await createSnapshot({
        vmName: 'podkit-device-harness',
        snapshotName: 'base-healthy',
        subprocess: runner,
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain('failed to create snapshot');
    expect(caught!.message).toContain('base-healthy');
    expect(caught!.message).toContain('podkit-device-harness');
    expect(caught!.message).toContain('already exists');
  });

  it('requires vmName and snapshotName', async () => {
    await expect(createSnapshot({ vmName: '', snapshotName: 'x' })).rejects.toThrow(
      /vmName is required/
    );
    await expect(createSnapshot({ vmName: 'vm', snapshotName: '' })).rejects.toThrow(
      /snapshotName is required/
    );
  });

  it('silently no-ops when the driver does not implement snapshots (Lima vz)', async () => {
    const { runner } = makeScriptedRunner([fail(1, 'level=fatal msg=unimplemented')]);
    // Must not throw — applyState() relies on this so it can call
    // createSnapshot unconditionally on the slow path.
    await createSnapshot({
      vmName: 'podkit-device-harness',
      snapshotName: 'base-healthy',
      subprocess: runner,
    });
  });
});

// ---------------------------------------------------------------------------
// restoreSnapshot
// ---------------------------------------------------------------------------

describe('restoreSnapshot', () => {
  it('invokes `limactl snapshot apply <vm> --tag <name>`', async () => {
    const { runner, calls } = makeScriptedRunner([ok()]);
    await restoreSnapshot({
      vmName: 'podkit-device-harness',
      snapshotName: 'base-no-ffmpeg',
      subprocess: runner,
    });
    expect(calls[0]!.args).toEqual([
      'snapshot',
      'apply',
      'podkit-device-harness',
      '--tag',
      'base-no-ffmpeg',
    ]);
  });

  it('throws with a descriptive message when limactl fails', async () => {
    const { runner } = makeScriptedRunner([fail(1, 'snapshot "base-no-ffmpeg" not found')]);
    let caught: Error | undefined;
    try {
      await restoreSnapshot({
        vmName: 'podkit-device-harness',
        snapshotName: 'base-no-ffmpeg',
        subprocess: runner,
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain('failed to restore snapshot');
    expect(caught!.message).toContain('base-no-ffmpeg');
    expect(caught!.message).toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// deleteSnapshot
// ---------------------------------------------------------------------------

describe('deleteSnapshot', () => {
  it('invokes `limactl snapshot delete <vm> --tag <name>`', async () => {
    const { runner, calls } = makeScriptedRunner([ok()]);
    await deleteSnapshot({
      vmName: 'podkit-device-harness',
      snapshotName: 'base-healthy',
      subprocess: runner,
    });
    expect(calls[0]!.args).toEqual([
      'snapshot',
      'delete',
      'podkit-device-harness',
      '--tag',
      'base-healthy',
    ]);
  });

  it('propagates limactl errors', async () => {
    const { runner } = makeScriptedRunner([fail(1, 'whatever')]);
    await expect(
      deleteSnapshot({
        vmName: 'vm',
        snapshotName: 's',
        subprocess: runner,
      })
    ).rejects.toThrow(/failed to delete snapshot/);
  });
});

// ---------------------------------------------------------------------------
// listSnapshots
// ---------------------------------------------------------------------------

describe('listSnapshots', () => {
  it('returns parsed tag list from limactl --quiet output', async () => {
    const { runner, calls } = makeScriptedRunner([
      ok('base-healthy\nbase-no-ffmpeg\nbase-no-libgpod\n'),
    ]);
    const result = await listSnapshots({
      vmName: 'podkit-device-harness',
      subprocess: runner,
    });
    expect(result).toEqual(['base-healthy', 'base-no-ffmpeg', 'base-no-libgpod']);
    expect(calls[0]!.args).toEqual(['snapshot', 'list', 'podkit-device-harness', '--quiet']);
  });

  it('returns an empty array when no snapshots exist (limactl prints nothing)', async () => {
    const { runner } = makeScriptedRunner([ok('')]);
    const result = await listSnapshots({
      vmName: 'podkit-device-harness',
      subprocess: runner,
    });
    expect(result).toEqual([]);
  });

  it('trims whitespace and filters blank lines defensively', async () => {
    const { runner } = makeScriptedRunner([ok('  base-healthy  \n\n base-no-ffmpeg \n')]);
    const result = await listSnapshots({
      vmName: 'podkit-device-harness',
      subprocess: runner,
    });
    expect(result).toEqual(['base-healthy', 'base-no-ffmpeg']);
  });

  it('throws on limactl error', async () => {
    const { runner } = makeScriptedRunner([fail(1, 'instance "missing" not found')]);
    await expect(listSnapshots({ vmName: 'missing', subprocess: runner })).rejects.toThrow(
      /failed to list snapshots/
    );
  });

  it('requires vmName', async () => {
    await expect(listSnapshots({ vmName: '' })).rejects.toThrow(/vmName is required/);
  });
});

// ---------------------------------------------------------------------------
// snapshotExists
// ---------------------------------------------------------------------------

describe('snapshotExists', () => {
  it('returns true when the named tag is in the list', async () => {
    const { runner } = makeScriptedRunner([ok('base-healthy\nbase-no-ffmpeg\n')]);
    const exists = await snapshotExists({
      vmName: 'podkit-device-harness',
      snapshotName: 'base-no-ffmpeg',
      subprocess: runner,
    });
    expect(exists).toBe(true);
  });

  it('returns false when the named tag is absent', async () => {
    const { runner } = makeScriptedRunner([ok('base-healthy\n')]);
    const exists = await snapshotExists({
      vmName: 'podkit-device-harness',
      snapshotName: 'base-no-ffmpeg',
      subprocess: runner,
    });
    expect(exists).toBe(false);
  });

  it('returns false when the VM has no snapshots at all', async () => {
    const { runner } = makeScriptedRunner([ok('')]);
    const exists = await snapshotExists({
      vmName: 'podkit-device-harness',
      snapshotName: 'base-healthy',
      subprocess: runner,
    });
    expect(exists).toBe(false);
  });

  it('returns false when the instance itself is missing (does not throw)', async () => {
    const { runner } = makeScriptedRunner([fail(1, 'instance "podkit-device-harness" not found')]);
    const exists = await snapshotExists({
      vmName: 'podkit-device-harness',
      snapshotName: 'base-healthy',
      subprocess: runner,
    });
    expect(exists).toBe(false);
  });

  it('throws for limactl failures unrelated to instance lookup', async () => {
    const { runner } = makeScriptedRunner([fail(1, 'qemu-img: I/O error reading snapshot table')]);
    await expect(
      snapshotExists({
        vmName: 'podkit-device-harness',
        snapshotName: 'base-healthy',
        subprocess: runner,
      })
    ).rejects.toThrow(/failed to list snapshots/);
  });

  it('returns false when the driver does not implement snapshots (Lima vz)', async () => {
    // Lima 2.x `vz` (Apple Virtualization framework, default on Apple
    // Silicon) does not implement snapshots. `limactl snapshot list` exits
    // 1 with `level=fatal msg=unimplemented`. Treat as "no snapshot" so
    // applyState() degrades to apply-state.sh-every-time instead of
    // failing every Tier-3 test.
    const { runner } = makeScriptedRunner([
      fail(
        1,
        'level=warning msg="`limactl snapshot` is experimental"\nlevel=fatal msg=unimplemented'
      ),
    ]);
    const exists = await snapshotExists({
      vmName: 'podkit-device-harness',
      snapshotName: 'base-healthy',
      subprocess: runner,
    });
    expect(exists).toBe(false);
  });

  it('discriminates between similarly-prefixed tags', async () => {
    const { runner } = makeScriptedRunner([ok('base-healthy\nbase-healthy-old\n')]);
    // Exact match only — 'base-healthy' should not match 'base-healthy-old'
    // and vice versa.
    const a = await snapshotExists({
      vmName: 'vm',
      snapshotName: 'base-healthy',
      subprocess: runner,
    });
    expect(a).toBe(true);

    const { runner: r2 } = makeScriptedRunner([ok('base-healthy\nbase-healthy-old\n')]);
    const b = await snapshotExists({
      vmName: 'vm',
      snapshotName: 'base-missing',
      subprocess: r2,
    });
    expect(b).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// limactl transport-level failure (ENOENT)
// ---------------------------------------------------------------------------

describe('snapshot helpers: limactl missing', () => {
  it('surfaces a clear hint when limactl is not installed', async () => {
    const { runner } = makeScriptedRunner([new Error('spawn limactl ENOENT')]);
    let caught: Error | undefined;
    try {
      await createSnapshot({
        vmName: 'vm',
        snapshotName: 'base-healthy',
        subprocess: runner,
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain('brew install lima');
  });
});

// ---------------------------------------------------------------------------
// Snapshot-unsupported warning (TASK-335 Change 3)
// ---------------------------------------------------------------------------

describe('snapshot-unsupported warning', () => {
  beforeEach(() => {
    resetSnapshotUnsupportedWarning();
  });

  it('emits a warning the first time isSnapshotUnsupported returns true (via createSnapshot)', async () => {
    const warnings: string[] = [];
    const warn = (msg: string) => warnings.push(msg);
    const { runner } = makeScriptedRunner([fail(1, 'level=fatal msg=unimplemented')]);

    await createSnapshot({ vmName: 'vm', snapshotName: 'base-healthy', subprocess: runner, warn });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('[lima-test-vm]');
    expect(warnings[0]).toContain('vz');
    expect(warnings[0]).toContain('apply-state.sh');
    expect(warnings[0]).toContain('TASK-322.02.01');
  });

  it('is silent on subsequent unimplemented hits in the same session', async () => {
    const warnings: string[] = [];
    const warn = (msg: string) => warnings.push(msg);

    // First call — emits warning
    const { runner: r1 } = makeScriptedRunner([fail(1, 'level=fatal msg=unimplemented')]);
    await createSnapshot({ vmName: 'vm', snapshotName: 'base-healthy', subprocess: r1, warn });

    // Second call — should be silent
    const { runner: r2 } = makeScriptedRunner([fail(1, 'level=fatal msg=unimplemented')]);
    await createSnapshot({ vmName: 'vm', snapshotName: 'base-healthy', subprocess: r2, warn });

    expect(warnings).toHaveLength(1);
  });

  it('emits again after resetSnapshotUnsupportedWarning()', async () => {
    const warnings: string[] = [];
    const warn = (msg: string) => warnings.push(msg);

    // First hit
    const { runner: r1 } = makeScriptedRunner([fail(1, 'level=fatal msg=unimplemented')]);
    await createSnapshot({ vmName: 'vm', snapshotName: 'base-healthy', subprocess: r1, warn });
    expect(warnings).toHaveLength(1);

    // Reset
    resetSnapshotUnsupportedWarning();

    // Second hit — should emit again
    const { runner: r2 } = makeScriptedRunner([fail(1, 'level=fatal msg=unimplemented')]);
    await createSnapshot({ vmName: 'vm', snapshotName: 'base-healthy', subprocess: r2, warn });
    expect(warnings).toHaveLength(2);
  });

  it('emits warning via snapshotExists (listSnapshotsSafe path) on vz', async () => {
    const warnings: string[] = [];
    const warn = (msg: string) => warnings.push(msg);
    const { runner } = makeScriptedRunner([
      fail(
        1,
        'level=warning msg="`limactl snapshot` is experimental"\nlevel=fatal msg=unimplemented'
      ),
    ]);

    const exists = await snapshotExists({
      vmName: 'vm',
      snapshotName: 'base-healthy',
      subprocess: runner,
      warn,
    });

    expect(exists).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('TASK-322.02.01');
  });

  it('does NOT emit warning for normal (non-unimplemented) limactl failures', async () => {
    const warnings: string[] = [];
    const warn = (msg: string) => warnings.push(msg);
    const { runner } = makeScriptedRunner([fail(1, 'instance "vm" not found')]);

    // snapshotExists returns false for missing instance — no warning
    const exists = await snapshotExists({
      vmName: 'vm',
      snapshotName: 'base-healthy',
      subprocess: runner,
      warn,
    });

    expect(exists).toBe(false);
    expect(warnings).toHaveLength(0);
  });
});
