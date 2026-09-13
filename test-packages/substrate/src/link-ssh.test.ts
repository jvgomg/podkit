/**
 * Unit tests for the SSH substrate link.
 *
 * Assert the argv handed to `ssh`/`scp` via the injected runner — no real host,
 * no real connection. The argv is the contract: it is what a substrate nobody
 * in this project provisioned actually receives.
 *
 * It is deliberately NOT the same argv the limactl link produces, and these
 * tests are where that is stated. `limactl shell <vm> -- <argv…>` quotes each
 * word for the caller; `ssh <host> <argv…>` joins them with spaces and lets the
 * remote login shell re-parse the lot. Identical argv would therefore mean
 * divergent BEHAVIOUR — so the two links differ here, in exactly one place, in
 * order to behave the same everywhere above. Pinning the unquoted form is
 * pinning a link that silently returns wrong answers.
 */

import { describe, expect, it } from 'bun:test';

import type { SubprocessRunner, SubprocessRunResult } from '@podkit/device-types';

import { EventEmitter } from 'node:events';

import { createSshLink } from './link-ssh.js';
import { isSubstrateLinkError } from './link.js';
import type { HostSpawnFn } from './link-spawn.js';
import { getVm, isSshVm, type SshVmDefinition } from './registry.js';

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

/** The registry's own ssh entry — not a fixture, so the shape stays exercised. */
function remote(): SshVmDefinition {
  const def = getVm('deviceRemote');
  if (!isSshVm(def)) throw new Error('deviceRemote is no longer an ssh substrate');
  return def;
}

describe('createSshLink.exec', () => {
  // One command WORD, not an argv tail: everything after the alias is joined
  // with spaces by ssh and re-parsed by the remote shell, so each word is
  // quoted here to survive that second parse intact.
  it('hands the alias a single quoted command word, in batch mode', async () => {
    const { runner, calls } = recorder();
    const link = createSshLink(remote(), { subprocess: runner });
    await link.exec(['sudo', 'install', '-m', '0755', '/tmp/x', '/usr/bin/x']);

    expect(calls[0]!.command).toBe('ssh');
    expect(calls[0]!.args).toEqual([
      '-o',
      'BatchMode=yes',
      remote().sshAlias,
      `'sudo' 'install' '-m' '0755' '/tmp/x' '/usr/bin/x'`,
    ]);
  });

  it('wraps a command string in sh -c, exactly as the limactl link does', async () => {
    const { runner, calls } = recorder();
    const link = createSshLink(remote(), { subprocess: runner });
    await link.exec('echo hi', { cwd: '/work' });

    const word = calls[0]!.args.at(-1)!;
    expect(word.startsWith(`'sh' '-c' `)).toBe(true);
    expect(word).toContain(`cd '\\''/work'\\''`);
  });

  // The case the unquoted argv got wrong while exiting 0. `sh -c 'a | b'`
  // handed to ssh unquoted arrives as `sh -c a | b`, so the remote shell runs
  // `sh -c a` and pipes it into `b` — which is how the harness's sha256 probes
  // came back as the hash of empty stdin, with exit 0 and no diagnostic. The
  // pipe and the redirect must both stay inside the single quoted word.
  it('keeps a guest pipeline inside one word so the remote shell cannot split it', async () => {
    const { runner, calls } = recorder();
    const link = createSshLink(remote(), { subprocess: runner });
    await link.exec(`sha256sum '/usr/local/bin/podkit' 2>/dev/null | awk '{print $1}'`);

    const args = calls[0]!.args;
    // Nothing after the alias: the whole command is the final argument.
    expect(args.indexOf(remote().sshAlias)).toBe(args.length - 2);
    const word = args.at(-1)!;
    expect(word.startsWith(`'sh' '-c' `)).toBe(true);
    expect(word).toContain('|');
    expect(word).toContain('2>/dev/null');
  });

  it('returns a non-zero guest exit rather than throwing', async () => {
    const { runner } = recorder({ stdout: '', stderr: 'no such unit', exitCode: 5 });
    const link = createSshLink(remote(), { subprocess: runner });
    await expect(link.exec(['systemctl', 'stop', 'nope'])).resolves.toMatchObject({ exitCode: 5 });
  });

  // The distinction the whole type exists for. `ssh` reserves 255 for its own
  // errors, but a guest is free to exit 255 too, so the code alone is not
  // enough — it is paired with ssh's own stderr vocabulary and with the guest
  // having said nothing.
  it('throws a typed link error when ssh could not open the session', async () => {
    const { runner } = recorder({
      stdout: '',
      stderr: 'ssh: connect to host podkit-substrate port 22: Connection refused',
      exitCode: 255,
    });
    const link = createSshLink(remote(), { subprocess: runner });
    let caught: unknown;
    try {
      await link.exec(['true']);
    } catch (err) {
      caught = err;
    }
    expect(isSubstrateLinkError(caught)).toBe(true);
    expect((caught as Error).message).toContain(remote().sshAlias);
  });

  it('does not read a guest exit of 255 as a link failure', async () => {
    const { runner } = recorder({ stdout: '', stderr: 'my tool exploded', exitCode: 255 });
    const link = createSshLink(remote(), { subprocess: runner });
    await expect(link.exec(['my-tool'])).resolves.toMatchObject({ exitCode: 255 });
  });

  // A guest command running its own ssh against a third host prints exactly
  // the vocabulary this link watches for. It also prints its own output, which
  // is what says the substrate was there — misreading it would skip a test that
  // should have failed.
  it('does not convict when the guest spoke before failing with ssh vocabulary', async () => {
    const { runner } = recorder({
      stdout: 'mirroring to backup host\n',
      stderr: 'Connection closed by 192.0.2.1 port 22',
      exitCode: 255,
    });
    const link = createSshLink(remote(), { subprocess: runner });
    await expect(link.exec(['my-mirror-script'])).resolves.toMatchObject({ exitCode: 255 });
  });

  it('treats a host-level rejection (no ssh binary, bound fired) as a link failure', async () => {
    const { runner } = recorder(() => {
      throw new Error('spawn ssh ENOENT');
    });
    const link = createSshLink(remote(), { subprocess: runner });
    let caught: unknown;
    try {
      await link.exec(['true']);
    } catch (err) {
      caught = err;
    }
    expect(isSubstrateLinkError(caught)).toBe(true);
    expect((caught as Error).message).toContain('ENOENT');
  });

  // `execFile` kills the child when its `timeout` fires, so the rejection says
  // "killed" and never mentions the bound that was exceeded. The limactl link
  // gets the explicit wording from `runLimactl`; this one has to say it itself,
  // or it is the one substrate whose timeouts are unattributable.
  it('names the bound that fired instead of surfacing an anonymous kill', async () => {
    const { runner } = recorder(() => {
      throw Object.assign(new Error('Command failed: ssh'), {
        killed: true,
        signal: 'SIGTERM',
      });
    });
    const link = createSshLink(remote(), { subprocess: runner });
    let caught: unknown;
    try {
      await link.exec(['true'], { timeoutMs: 250 });
    } catch (err) {
      caught = err;
    }
    expect(isSubstrateLinkError(caught)).toBe(true);
    expect((caught as Error).message).toContain(`timed out after 250ms`);
    expect((caught as Error).message).toContain(remote().sshAlias);
  });
});

describe('createSshLink.copyIn', () => {
  it('scps host→guest and nowhere else', async () => {
    const { runner, calls } = recorder();
    const link = createSshLink(remote(), { subprocess: runner });
    await link.copyIn('/host/file', '/tmp/file', { timeoutMs: 1234 });

    expect(calls[0]!.command).toBe('scp');
    expect(calls[0]!.args).toEqual([
      '-o',
      'BatchMode=yes',
      '-q',
      '/host/file',
      `${remote().sshAlias}:/tmp/file`,
    ]);
    expect(calls[0]!.opts?.timeoutMs).toBe(1234);
  });

  it('reports a refused destination as a copy failure, not a link failure', async () => {
    const { runner } = recorder({
      stdout: '',
      stderr: 'scp: /etc/x: Permission denied',
      exitCode: 1,
    });
    const link = createSshLink(remote(), { subprocess: runner });
    let caught: unknown;
    try {
      await link.copyIn('/host/file', '/etc/x');
    } catch (err) {
      caught = err;
    }
    expect(isSubstrateLinkError(caught)).toBe(false);
    expect((caught as Error).message).toContain('Permission denied');
  });
});

// ---------------------------------------------------------------------------
// spawn
// ---------------------------------------------------------------------------

/** Minimal stand-in for a spawned child, enough to drive the handle's contract. */
class FakeChild extends EventEmitter {
  readonly pid = 909;
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
  // `FakeChild` implements the three members the link touches; reproducing the
  // rest of `ChildProcess` would be a page of nulls asserting nothing.
  const spawnFn = ((command: string, args: readonly string[]) => {
    calls.push({ command, args });
    return child;
  }) as unknown as HostSpawnFn;
  return { spawnFn, calls, child };
}

describe('createSshLink.spawn', () => {
  it('starts the guest command over ssh and hands back a live handle', () => {
    const { spawnFn, calls, child } = fakeSpawn();
    const proc = createSshLink(remote(), { spawnFn }).spawn('sleep 99');
    expect(calls[0]!.command).toBe('ssh');
    // Quoted for the remote shell's re-parse, exactly as `exec` does it — a
    // long-lived process is no less likely to contain a pipe than a probe.
    expect(calls[0]!.args).toEqual([
      '-o',
      'BatchMode=yes',
      remote().sshAlias,
      `'sh' '-c' 'sleep 99'`,
    ]);
    // The HOST-side pid. Treating it as the guest's is how a later `kill`
    // lands on an unrelated process.
    expect(proc.pid).toBe(child.pid);
  });

  it('kill() signals the host-side link process', () => {
    const { spawnFn, child } = fakeSpawn();
    createSshLink(remote(), { spawnFn }).spawn('sleep 99').kill('SIGKILL');
    expect(child.killedWith).toBe('SIGKILL');
  });

  it('exited resolves with the link process outcome', async () => {
    const { spawnFn, child } = fakeSpawn();
    const proc = createSshLink(remote(), { spawnFn }).spawn('true');
    child.emit('close', 0, null);
    await expect(proc.exited).resolves.toEqual({ exitCode: 0, signal: null });
  });

  // A spawn that never produced a process emits `error` and no `close`.
  // Without this, `exited` would hang forever on a missing binary — a test
  // that stops rather than fails.
  it('exited settles rather than hanging when the spawn itself failed', async () => {
    const { spawnFn, child } = fakeSpawn();
    const proc = createSshLink(remote(), { spawnFn }).spawn('true');
    child.emit('error', new Error('spawn ssh ENOENT'));
    await expect(proc.exited).resolves.toEqual({ exitCode: null, signal: null });
  });
});

describe('createSshLink identity', () => {
  it('names both the substrate and how it is reached', () => {
    const link = createSshLink(remote());
    expect(link.substrateId).toBe('deviceRemote');
    expect(link.description).toContain(remote().sshAlias);
  });
});
