/**
 * Unit tests for the generic in-VM transport primitives. Assert the argv and
 * the shell body handed to `limactl` via the injected runner — no real VM.
 */

import { describe, it, expect } from 'bun:test';

import { runInVm, copyOut, stageSourceTree, DEFAULT_STAGE_EXCLUDES } from './transport.js';
import type {
  SubprocessRunner,
  SubprocessRunOpts,
  SubprocessRunResult,
} from '@podkit/device-types';

interface ScriptedCall {
  command: string;
  args: string[];
  opts?: SubprocessRunOpts;
}

function recorder(result: SubprocessRunResult): {
  runner: SubprocessRunner;
  calls: ScriptedCall[];
} {
  const calls: ScriptedCall[] = [];
  return {
    calls,
    runner: {
      async run(command, args, opts) {
        calls.push({ command, args, opts });
        return result;
      },
    },
  };
}

const ok = (stdout = ''): SubprocessRunResult => ({ stdout, stderr: '', exitCode: 0 });

describe('runInVm', () => {
  // execFile kills a timed-out child with a signal, so the raw rejection says
  // only "killed" and never names the bound that fired. A bound that reports
  // itself anonymously is barely better than no bound, so the descriptive
  // message is the point of routing this through the shared limactl wrapper
  // rather than spawning directly.
  it('names the bound that fired when a call times out', async () => {
    const timedOut: SubprocessRunner = {
      async run() {
        const err = new Error('Command failed: limactl shell vm1') as Error & {
          killed?: boolean;
          signal?: string;
        };
        err.killed = true;
        err.signal = 'SIGTERM';
        throw err;
      },
    };
    await expect(
      runInVm('vm1', 'sleep 99', { subprocess: timedOut, timeoutMs: 2_000 })
    ).rejects.toThrow(/timed out after 2000ms/);
  });

  it('keeps the install hint when limactl itself is missing', async () => {
    const missing: SubprocessRunner = {
      async run() {
        throw new Error('spawn limactl ENOENT');
      },
    };
    await expect(runInVm('vm1', 'true', { subprocess: missing })).rejects.toThrow(
      /brew install lima/
    );
  });

  it('shells into the VM and forwards the command', async () => {
    const { runner, calls } = recorder(ok('hi'));
    const res = await runInVm('vm1', 'echo hi', { subprocess: runner });
    expect(res).toEqual({ stdout: 'hi', stderr: '', exitCode: 0 });
    expect(calls[0]!.command).toBe('limactl');
    expect(calls[0]!.args.slice(0, 4)).toEqual(['shell', 'vm1', '--', 'sh']);
    expect(calls[0]!.args[4]).toBe('-c');
    expect(calls[0]!.args[5]).toBe('echo hi');
  });

  it('exports env and cds before the command', async () => {
    const { runner, calls } = recorder(ok());
    await runInVm('vm1', 'run', {
      subprocess: runner,
      env: { FOO: 'bar' },
      cwd: '/work',
    });
    const body = calls[0]!.args[5]!;
    expect(body).toContain("export FOO='bar'");
    expect(body).toContain("cd '/work'");
    expect(body.endsWith('run')).toBe(true);
  });

  it('passes a timeout through to the subprocess runner', async () => {
    const { runner, calls } = recorder(ok());
    await runInVm('vm1', 'run', { subprocess: runner, timeoutMs: 1234 });
    expect(calls[0]!.opts).toEqual({ timeoutMs: 1234 });
  });

  it('rejects an invalid env variable name', async () => {
    const { runner } = recorder(ok());
    await expect(
      runInVm('vm1', 'run', { subprocess: runner, env: { 'bad-name': 'x' } })
    ).rejects.toThrow(/invalid variable name/);
  });
});

describe('copyOut', () => {
  it('copies a file out of the VM to the host', async () => {
    const { runner, calls } = recorder(ok());
    await copyOut({
      vmName: 'vm1',
      vmPath: '/in/vm/file',
      hostPath: '/host/file',
      subprocess: runner,
    });
    expect(calls[0]!.args).toEqual(['copy', 'vm1:/in/vm/file', '/host/file']);
  });

  it('throws on a non-zero exit', async () => {
    const { runner } = recorder({ stdout: '', stderr: 'no such file', exitCode: 1 });
    await expect(
      copyOut({ vmName: 'vm1', vmPath: '/x', hostPath: '/y', subprocess: runner })
    ).rejects.toThrow(/failed to copy vm1:\/x.*no such file/s);
  });
});

describe('stageSourceTree', () => {
  it('runs an in-VM rsync with excludes and exit-24 tolerance', async () => {
    const { runner, calls } = recorder(ok());
    await stageSourceTree({
      vmName: 'vm1',
      hostSrc: '/repo',
      vmDest: '/tmp/build',
      excludes: ['node_modules', '.git'],
      subprocess: runner,
    });
    const body = calls[0]!.args[5]!;
    expect(calls[0]!.args.slice(0, 5)).toEqual(['shell', 'vm1', '--', 'sh', '-c']);
    expect(body).toContain('rsync -a --delete');
    expect(body).toContain("--exclude 'node_modules'");
    expect(body).toContain("--exclude '.git'");
    expect(body).toContain("'/repo/'");
    expect(body).toContain("'/tmp/build/'");
    // benign "files vanished" race is tolerated
    expect(body).toContain('-ne 24');
    // The VM-side interpreter is `sh` (dash on Debian, busybox ash on Alpine),
    // neither of which supports `set -o pipefail` — using it aborts the whole
    // staging step before rsync ever runs.
    expect(body).not.toContain('pipefail');
  });

  it('throws on a non-zero rsync exit', async () => {
    const { runner } = recorder({ stdout: '', stderr: 'rsync error 12', exitCode: 12 });
    await expect(
      stageSourceTree({ vmName: 'vm1', hostSrc: '/repo', vmDest: '/tmp/b', subprocess: runner })
    ).rejects.toThrow(/failed to stage source tree/);
  });

  it('applies the shared exclude floor even when the caller names none', async () => {
    const { runner, calls } = recorder(ok());
    await stageSourceTree({
      vmName: 'vm1',
      hostSrc: '/repo',
      vmDest: '/tmp/build',
      subprocess: runner,
    });
    const body = calls[0]!.args[5]!;
    for (const pattern of DEFAULT_STAGE_EXCLUDES) {
      expect(body).toContain(`--exclude '${pattern}'`);
    }
  });

  it('extends the floor with caller excludes rather than replacing it', async () => {
    const { runner, calls } = recorder(ok());
    await stageSourceTree({
      vmName: 'vm1',
      hostSrc: '/repo',
      vmDest: '/tmp/build',
      excludes: ['packages/libgpod-node/prebuilds'],
      subprocess: runner,
    });
    const body = calls[0]!.args[5]!;
    expect(body).toContain("--exclude 'packages/libgpod-node/prebuilds'");
    expect(body).toContain("--exclude 'node_modules'");
  });

  it('leaves prebuilds stageable by default so binary builds can embed them', () => {
    // The two prebuild wrappers prune prebuilds/ explicitly; the binary
    // wrappers must NOT, or compile.sh has no .node to embed.
    expect(DEFAULT_STAGE_EXCLUDES).not.toContain('packages/libgpod-node/prebuilds');
  });

  it('runs the rsync under sudo when asked', async () => {
    const { runner, calls } = recorder(ok());
    await stageSourceTree({
      vmName: 'vm1',
      hostSrc: '/repo',
      vmDest: '/opt/podkit',
      sudo: true,
      subprocess: runner,
    });
    const body = calls[0]!.args[5]!;
    expect(body).toContain('sudo mkdir -p');
    expect(body).toContain('sudo rsync -a --delete');
  });

  it('does not invoke sudo by default', async () => {
    const { runner, calls } = recorder(ok());
    await stageSourceTree({
      vmName: 'vm1',
      hostSrc: '/repo',
      vmDest: '/tmp/build',
      subprocess: runner,
    });
    expect(calls[0]!.args[5]!).not.toContain('sudo');
  });
});
