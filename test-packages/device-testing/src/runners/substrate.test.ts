/**
 * Unit tests for substrate dispatch, readiness and the fallback announcement.
 *
 * Three behaviours are pinned, and each exists because its absence has a
 * specific cost:
 *
 *   - **Dispatch on the discriminator.** An `ssh` substrate reached with
 *     `limactl` reports "instance not found", which reads as a missing VM
 *     rather than as a provisioner that was never going to know about it.
 *   - **Readiness by provisioner.** A Lima instance this repo owns can be
 *     started; a box a hypervisor produced cannot, and pretending otherwise
 *     turns an actionable message into a failed `limactl start`.
 *   - **The announcement is rendered.** The resolver returns it as data, and an
 *     announcement nobody prints is worse than none — the code then reads as
 *     though the user was told which substrate the result came from.
 */

import { afterEach, describe, expect, it } from 'bun:test';

import type { SubprocessRunner, SubprocessRunResult } from '@podkit/device-types';
import { getVm, isSshVm, type SshVmDefinition } from '@podkit/substrate';

import {
  createSubstrateLink,
  ensureSubstrateReady,
  probeSubstrate,
  resetDeviceSubstrate,
  resolveDeviceSubstrate,
} from './substrate.js';

afterEach(() => {
  // The selection is memoised process-wide; a test that left its own decision
  // cached would silently decide the next one.
  resetDeviceSubstrate();
});

interface RecordedCall {
  command: string;
  args: string[];
}

const ok = (stdout = ''): SubprocessRunResult => ({ stdout, stderr: '', exitCode: 0 });

function recorder(reply: (call: RecordedCall) => SubprocessRunResult = () => ok()): {
  runner: SubprocessRunner;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  return {
    calls,
    runner: {
      async run(command, args): Promise<SubprocessRunResult> {
        const call = { command, args };
        calls.push(call);
        return reply(call);
      },
    },
  };
}

/** The registry's own ssh entry, so the discriminator's second branch is real. */
function remote(): SshVmDefinition {
  const def = getVm('deviceRemote');
  if (!isSshVm(def)) throw new Error('deviceRemote is no longer an ssh substrate');
  return def;
}

describe('createSubstrateLink', () => {
  it('reaches a Lima substrate with limactl', async () => {
    const { runner, calls } = recorder();
    await createSubstrateLink(getVm('device'), { subprocess: runner }).exec(['true']);
    expect(calls[0]!.command).toBe('limactl');
  });

  it('reaches an ssh substrate with ssh, through its alias and nothing else', async () => {
    const { runner, calls } = recorder();
    await createSubstrateLink(remote(), { subprocess: runner }).exec(['true']);
    expect(calls[0]!.command).toBe('ssh');
    expect(calls[0]!.args).toContain(remote().sshAlias);
    // The repo knows an alias NAME. Anything that looks like a machine here
    // would be infrastructure detail in a public repository.
    expect(calls[0]!.args.join(' ')).not.toContain('@');
  });
});

describe('probeSubstrate', () => {
  const limaList = (status: 'Running' | 'Stopped'): SubprocessRunResult =>
    ok(`${JSON.stringify({ name: 'podkit-device', status })}\n`);

  it('reads Lima metadata rather than paying for a round trip', async () => {
    const { runner, calls } = recorder(() => limaList('Running'));
    expect(await probeSubstrate(getVm('device'), { subprocess: runner })).toBe('ready');
    expect(calls[0]!.args).toEqual(['list', '--json']);
  });

  // `startable` exists so `ensureSubstrateReady` can boot a stopped instance
  // without also conjuring one that was never provisioned.
  it('distinguishes a stopped Lima instance from a missing one', async () => {
    const stopped = recorder(() => limaList('Stopped'));
    expect(await probeSubstrate(getVm('device'), { subprocess: stopped.runner })).toBe('startable');

    const missing = recorder(() => ok(''));
    expect(await probeSubstrate(getVm('device'), { subprocess: missing.runner })).toBe(
      'unreachable'
    );
  });

  it('probes an ssh substrate by asking it to run something', async () => {
    const { runner, calls } = recorder();
    expect(await probeSubstrate(remote(), { subprocess: runner })).toBe('ready');
    expect(calls[0]!.command).toBe('ssh');
    // Quoted, because the SSH link hands the alias one command word for the
    // remote login shell to re-parse rather than an argv tail.
    expect(calls[0]!.args).toContain(`'true'`);
  });

  // A probe that throws is a probe the availability gate has to wrap in a
  // catch, which is how "unavailable" becomes a suite error instead of a skip.
  it('never throws — an unreachable substrate is an answer, not an exception', async () => {
    const { runner } = recorder(() => ({
      stdout: '',
      stderr: 'ssh: connect to host podkit-substrate port 22: Connection refused',
      exitCode: 255,
    }));
    expect(await probeSubstrate(remote(), { subprocess: runner })).toBe('unreachable');
  });
});

describe('ensureSubstrateReady', () => {
  it('is a no-op when the substrate already answers', async () => {
    const { runner, calls } = recorder(() => ok('{"name":"podkit-device","status":"Running"}\n'));
    await ensureSubstrateReady(getVm('device'), { subprocess: runner });
    expect(calls).toHaveLength(1);
  });

  // An unprovisioned instance has no binaries, no systemd unit and no sealed
  // baseline. Conjuring one trades a clear error for a mid-suite mystery.
  it('refuses to create a missing Lima instance, and names the command that would', async () => {
    const { runner } = recorder(() => ok(''));
    await expect(ensureSubstrateReady(getVm('device'), { subprocess: runner })).rejects.toThrow(
      /harness:setup/
    );
  });

  // Nothing in this repo provisions an ssh substrate, so there is no start verb
  // to reach for — saying so beats a failed `limactl start` against a box
  // limactl has never heard of.
  it('reports an unreachable ssh substrate instead of trying to start it', async () => {
    const { runner } = recorder(() => ({ stdout: '', stderr: 'nope', exitCode: 1 }));
    await expect(ensureSubstrateReady(remote(), { subprocess: runner })).rejects.toThrow(
      new RegExp(`ssh ${remote().sshAlias} true`)
    );
  });
});

describe('resolveDeviceSubstrate', () => {
  it('renders the resolver announcement through the caller-supplied sink', () => {
    const lines: string[] = [];
    const resolved = resolveDeviceSubstrate({ notice: (line) => lines.push(line), fresh: true });

    // Which substrate this machine selects is the machine's business; whether
    // the announcement was rendered is not, and that is what this asserts.
    if (resolved.selection.announcement) {
      expect(lines).toEqual([resolved.selection.announcement]);
    } else {
      expect(lines).toEqual([]);
    }
  });

  it('says it once — a decision announced twice reads as two decisions', () => {
    const lines: string[] = [];
    const notice = (line: string): void => void lines.push(line);
    const first = resolveDeviceSubstrate({ notice });
    resolveDeviceSubstrate({ notice });
    expect(lines).toHaveLength(first.selection.announcement ? 1 : 0);
  });

  it('memoises, so every helper falling back to the default shares one link', () => {
    const notice = (): void => {};
    expect(resolveDeviceSubstrate({ notice }).link).toBe(resolveDeviceSubstrate({ notice }).link);
  });

  // The default sink is what the harness singleton gets, and it is reached from
  // 29 test files that own no output surface. If it were silent, the
  // announcement would exist only as a field nobody reads.
  it('falls back to writing the announcement itself when no sink is supplied', () => {
    const written: string[] = [];
    const real = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    let announcement: string | null;
    try {
      announcement = resolveDeviceSubstrate({ fresh: true }).selection.announcement;
    } finally {
      process.stderr.write = real;
    }
    if (announcement) {
      expect(written.join('')).toContain(announcement);
      expect(written.join('')).toContain('[substrate]');
    } else {
      expect(written).toEqual([]);
    }
  });
});
