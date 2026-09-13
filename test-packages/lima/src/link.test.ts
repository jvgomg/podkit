/**
 * Unit tests for the limactl substrate link.
 *
 * The argv assertions here are not decoration: they are the bytes every helper
 * in the device harness used to hand-assemble at 39 sites, and the harness's
 * own unit tests still pin them through this link. If this module's argv
 * changes, those tests are what notices.
 *
 * The second theme is the exec contract — a link failure throws, a guest
 * failure returns — because that is the distinction the harness branches on to
 * choose between "skip, the substrate is unavailable" and "fail".
 */

import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';

import type { SubprocessRunner, SubprocessRunResult } from '@podkit/device-types';
import { isSubstrateLinkError, type HostSpawnFn } from '@podkit/substrate';

import { createLimactlLink } from './link.js';

const DEVICE = { id: 'device', instanceName: 'podkit-device' } as const;

/**
 * limactl's two canonical refusals, CAPTURED rather than written from memory.
 *
 * These are verbatim `limactl shell … 2>&1 | cat` output from limactl 2.1.1 —
 * the piped form, because that is the only form the harness ever sees. The
 * previous fixtures here were invented (`FATA[0000] instance "x" does not
 * exist`), and since limactl emits the bracketed logrus prefix only on a TTY,
 * they pinned a classifier that could not fire in production while reading as
 * though it did. Re-capture rather than edit these if limactl's wording moves.
 */
const LIMACTL_MISSING_INSTANCE =
  'time="2026-09-13T23:00:43+01:00" level=fatal ' +
  'msg="instance \\"podkit-device\\" does not exist, run `limactl create podkit-device` ' +
  'to create a new instance"';
const LIMACTL_STOPPED_INSTANCE =
  'time="2026-09-13T23:00:43+01:00" level=fatal ' +
  'msg="instance \\"podkit-device\\" is stopped, run `limactl start podkit-device` ' +
  'to start the instance"';

interface RecordedCall {
  command: string;
  args: string[];
  opts?: { timeoutMs?: number };
}

const ok = (stdout = ''): SubprocessRunResult => ({ stdout, stderr: '', exitCode: 0 });

function recorder(result: SubprocessRunResult | (() => never) = ok()): {
  runner: SubprocessRunner;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  return {
    calls,
    runner: {
      async run(command, args, opts): Promise<SubprocessRunResult> {
        calls.push({ command, args, ...(opts ? { opts } : {}) });
        if (typeof result === 'function') return result();
        return result;
      },
    },
  };
}

describe('createLimactlLink.exec', () => {
  it('produces the argv the harness hand-assembled before the link existed', async () => {
    const { runner, calls } = recorder();
    await createLimactlLink(DEVICE, { subprocess: runner }).exec([
      'sudo',
      'install',
      '-m',
      '0755',
      '/tmp/x',
      '/usr/local/bin/x',
    ]);
    expect(calls[0]!.command).toBe('limactl');
    expect(calls[0]!.args).toEqual([
      'shell',
      'podkit-device',
      '--',
      'sudo',
      'install',
      '-m',
      '0755',
      '/tmp/x',
      '/usr/local/bin/x',
    ]);
  });

  it('wraps a command string in sh -c and forwards the bound', async () => {
    const { runner, calls } = recorder();
    await createLimactlLink(DEVICE, { subprocess: runner }).exec('echo hi', { timeoutMs: 1234 });
    expect(calls[0]!.args).toEqual(['shell', 'podkit-device', '--', 'sh', '-c', 'echo hi']);
    expect(calls[0]!.opts?.timeoutMs).toBe(1234);
  });

  it('returns a non-zero guest exit rather than throwing', async () => {
    const { runner } = recorder({ stdout: '', stderr: 'no such unit', exitCode: 5 });
    await expect(
      createLimactlLink(DEVICE, { subprocess: runner }).exec(['systemctl', 'stop', 'nope'])
    ).resolves.toMatchObject({ exitCode: 5 });
  });

  it('throws a typed link error when limactl refuses to attempt the command', async () => {
    const { runner } = recorder({
      stdout: '',
      stderr: LIMACTL_MISSING_INSTANCE,
      exitCode: 1,
    });
    let caught: unknown;
    try {
      await createLimactlLink(DEVICE, { subprocess: runner }).exec(['true']);
    } catch (err) {
      caught = err;
    }
    expect(isSubstrateLinkError(caught)).toBe(true);
    expect((caught as Error).message).toContain('podkit-device');
  });

  // The classifier's restraint, from the other side. `systemctl` reporting a
  // refused connection is the guest answering, and reading it as an
  // unreachable substrate would turn a real failure into a skip.
  it('does not mistake a guest command mentioning a refused connection for a dead link', async () => {
    const { runner } = recorder({
      stdout: '',
      stderr: 'systemctl: Failed to reload daemon: Connection refused',
      exitCode: 1,
    });
    await expect(
      createLimactlLink(DEVICE, { subprocess: runner }).exec(['sudo', 'systemctl', 'daemon-reload'])
    ).resolves.toMatchObject({ exitCode: 1 });
  });

  // The harder case, and the reason the classifier weighs the whole result
  // rather than the stderr alone: this stderr IS in the watched vocabulary,
  // because the guest ran its own ssh. Its stdout is what says the substrate
  // was there to run it.
  it('does not convict on ssh vocabulary the guest produced itself', async () => {
    const { runner } = recorder({
      stdout: 'mirroring to backup host\n',
      stderr: 'Connection reset by 192.0.2.1 port 22',
      exitCode: 255,
    });
    await expect(
      createLimactlLink(DEVICE, { subprocess: runner }).exec(['my-mirror-script'])
    ).resolves.toMatchObject({ exitCode: 255 });
  });

  // limactl's OWN verdict needs no such corroboration: nothing inside a guest
  // has a verdict to give about a Lima instance. This is the failure the Mac
  // actually produces — the device VM goes to `stopped` after the host sleeps —
  // so it has to be a "the box is gone" skip and not a guest diagnosis.
  it("convicts on limactl's own verdict even when the guest stream is not empty", async () => {
    const { runner } = recorder({
      stdout: 'partial output\n',
      stderr: LIMACTL_STOPPED_INSTANCE,
      exitCode: 1,
    });
    let caught: unknown;
    try {
      await createLimactlLink(DEVICE, { subprocess: runner }).exec(['true']);
    } catch (err) {
      caught = err;
    }
    expect(isSubstrateLinkError(caught)).toBe(true);
  });

  // The reason tier one is narrowed to an instance verdict rather than to
  // logrus' fatal level: `nerdctl` is logrus-based too, and this line was
  // captured from a failing `nerdctl run` inside a perfectly healthy guest.
  // A `level=fatal` matcher would call it an unreachable substrate and turn a
  // real docker-in-substrate failure into a skip.
  it('does not convict on a guest tool that logs at logrus fatal level', async () => {
    const { runner } = recorder({
      stdout: '',
      stderr:
        'time="2026-09-13T23:02:51+01:00" level=fatal ' +
        'msg="cannot access containerd socket \\"/run/containerd/containerd.sock\\": ' +
        'no such file or directory"',
      exitCode: 1,
    });
    await expect(
      createLimactlLink(DEVICE, { subprocess: runner }).exec(['sudo', 'nerdctl', 'run', 'x'])
    ).resolves.toMatchObject({ exitCode: 1 });
  });

  it('keeps the limactl install hint when the binary itself is missing', async () => {
    const { runner } = recorder(() => {
      throw new Error('spawn limactl ENOENT');
    });
    let caught: unknown;
    try {
      await createLimactlLink(DEVICE, { subprocess: runner }).exec(['true']);
    } catch (err) {
      caught = err;
    }
    expect(isSubstrateLinkError(caught)).toBe(true);
    expect((caught as Error).message).toMatch(/brew install lima/);
  });
});

describe('createLimactlLink.copyIn', () => {
  it('uses limactl copy host→guest', async () => {
    const { runner, calls } = recorder();
    await createLimactlLink(DEVICE, { subprocess: runner }).copyIn('/host/x', '/tmp/x', {
      timeoutMs: 99,
    });
    expect(calls[0]!.args).toEqual(['copy', '/host/x', 'podkit-device:/tmp/x']);
    expect(calls[0]!.opts?.timeoutMs).toBe(99);
  });

  it('reports a refused destination as a copy failure, not a link failure', async () => {
    const { runner } = recorder({ stdout: '', stderr: 'permission denied', exitCode: 1 });
    let caught: unknown;
    try {
      await createLimactlLink(DEVICE, { subprocess: runner }).copyIn('/host/x', '/etc/x');
    } catch (err) {
      caught = err;
    }
    expect(isSubstrateLinkError(caught)).toBe(false);
    expect((caught as Error).message).toContain('permission denied');
  });
});

// ---------------------------------------------------------------------------
// spawn
// ---------------------------------------------------------------------------

/** Minimal stand-in for a spawned child, enough to drive the handle's contract. */
class FakeChild extends EventEmitter {
  readonly pid = 4242;
  readonly stdout = null;
  readonly stderr = null;
  killedWith: NodeJS.Signals | undefined;
  kill(signal?: NodeJS.Signals): boolean {
    this.killedWith = signal;
    return true;
  }
}

function fakeSpawn(): {
  spawnFn: HostSpawnFn;
  calls: { command: string; args: readonly string[] }[];
  child: FakeChild;
} {
  const calls: { command: string; args: readonly string[] }[] = [];
  const child = new FakeChild();
  // The cast is the honest minimum: `FakeChild` implements the three members
  // the link touches, and reproducing the rest of `ChildProcess` would be a
  // page of nulls asserting nothing.
  const spawnFn = ((command: string, args: readonly string[]) => {
    calls.push({ command, args });
    return child;
  }) as unknown as HostSpawnFn;
  return { spawnFn, calls, child };
}

describe('createLimactlLink.spawn', () => {
  it('starts the guest command over limactl and hands back a live handle', () => {
    const { spawnFn, calls, child } = fakeSpawn();
    const proc = createLimactlLink(DEVICE, { spawnFn }).spawn('sleep 99');
    expect(calls[0]!.command).toBe('limactl');
    expect(calls[0]!.args).toEqual(['shell', 'podkit-device', '--', 'sh', '-c', 'sleep 99']);
    // The pid is the HOST-side link process. Treating it as the guest's is how
    // a later `kill` lands on an unrelated process.
    expect(proc.pid).toBe(child.pid);
  });

  it('kill() signals the host-side link process', () => {
    const { spawnFn, child } = fakeSpawn();
    const proc = createLimactlLink(DEVICE, { spawnFn }).spawn('sleep 99');
    proc.kill('SIGKILL');
    expect(child.killedWith).toBe('SIGKILL');
  });

  // `exited` settles on `close` rather than `exit` so a caller that awaits it
  // and then reads captured output is not racing the last chunk.
  it('exited resolves with the link process outcome', async () => {
    const { spawnFn, child } = fakeSpawn();
    const proc = createLimactlLink(DEVICE, { spawnFn }).spawn('true');
    child.emit('close', 0, null);
    await expect(proc.exited).resolves.toEqual({ exitCode: 0, signal: null });
  });

  // A spawn that never produced a process emits `error` and no `close`.
  // Without this, `exited` would hang forever on a missing binary — a test
  // that stops rather than fails.
  it('exited settles rather than hanging when the spawn itself failed', async () => {
    const { spawnFn, child } = fakeSpawn();
    const proc = createLimactlLink(DEVICE, { spawnFn }).spawn('true');
    child.emit('error', new Error('spawn limactl ENOENT'));
    await expect(proc.exited).resolves.toEqual({ exitCode: null, signal: null });
  });
});
