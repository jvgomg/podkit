/**
 * Unit tests for the substrate-contract driver. Assert the argv handed to
 * `limactl` via the injected runner — no real substrate, no real scripts run.
 *
 * What matters here is the shape of the interaction, because it is the shape
 * an SSH substrate has to reproduce: copy three files in, then execute them as
 * root. A test that reached into the module's internals would say nothing
 * about whether a second implementation could match it.
 */

import { describe, it, expect } from 'bun:test';

import type { SubprocessRunner, SubprocessRunResult } from '@podkit/device-types';

import {
  SUBSTRATE_SCRIPTS,
  SUBSTRATE_SCRIPT_DIR,
  copySubstrateScripts,
  provisionSubstrate,
  runSubstrateDoctor,
  substrateScriptVmPath,
} from './substrate-contract.js';

interface RecordedCall {
  command: string;
  args: string[];
}

const ok = (stdout = ''): SubprocessRunResult => ({ stdout, stderr: '', exitCode: 0 });

/** Records every invocation and replies with a fixed result. */
function recorder(result: SubprocessRunResult = ok()): {
  runner: SubprocessRunner;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  return {
    calls,
    runner: {
      async run(command, args) {
        calls.push({ command, args });
        return result;
      },
    },
  };
}

/** Replies with a failure only to invocations whose argv matches a predicate. */
function failingOn(
  predicate: (args: string[]) => boolean,
  failure: SubprocessRunResult
): SubprocessRunner {
  return {
    async run(_command, args) {
      return predicate(args) ? failure : ok();
    },
  };
}

describe('copySubstrateScripts', () => {
  it('creates the script directory before copying anything into it', async () => {
    const { runner, calls } = recorder();
    await copySubstrateScripts({ vmName: 'vm1', subprocess: runner });

    expect(calls[0]?.args).toEqual([
      'shell',
      'vm1',
      '--',
      'sudo',
      'install',
      '-d',
      '-m',
      '0755',
      SUBSTRATE_SCRIPT_DIR,
    ]);
  });

  // The contract file is sourced by the other two. A doctor reading different
  // constants from the provisioning that produced the box is worse than no
  // doctor, so all three must travel together rather than on demand.
  it('carries every contract script, not just the executable ones', async () => {
    const { runner, calls } = recorder();
    await copySubstrateScripts({ vmName: 'vm1', subprocess: runner });

    const copied = calls
      .filter((c) => c.args[0] === 'copy')
      .map((c) => c.args[1]?.split('/').pop());
    expect(copied).toEqual([...SUBSTRATE_SCRIPTS]);
  });

  // `limactl copy` runs as the unprivileged guest user, so a direct copy into
  // /usr/local/lib is refused. Stage in /tmp, then sudo install into place.
  it('stages through /tmp and installs into place with an explicit mode', async () => {
    const { runner, calls } = recorder();
    await copySubstrateScripts({ vmName: 'vm1', subprocess: runner });

    const copy = calls.find((c) => c.args[0] === 'copy');
    expect(copy?.args[2]).toBe('vm1:/tmp/substrate-contract.sh');

    const install = calls.find((c) => c.args.includes('/tmp/substrate-contract.sh'));
    expect(install?.args).toEqual([
      'shell',
      'vm1',
      '--',
      'sudo',
      'install',
      '-m',
      '0755',
      '/tmp/substrate-contract.sh',
      substrateScriptVmPath('substrate-contract.sh'),
    ]);
  });

  it('names the script that failed to copy', async () => {
    const runner = failingOn((args) => args[0] === 'copy', {
      stdout: '',
      stderr: 'no space left on device',
      exitCode: 1,
    });

    await expect(copySubstrateScripts({ vmName: 'vm1', subprocess: runner })).rejects.toThrow(
      /substrate-contract\.sh.*no space left on device/s
    );
  });
});

describe('provisionSubstrate', () => {
  it('runs the provisioning script as root from its installed path', async () => {
    const { runner, calls } = recorder();
    await provisionSubstrate({ vmName: 'vm1', subprocess: runner });

    expect(calls.at(-1)?.args).toEqual([
      'shell',
      'vm1',
      '--',
      'sudo',
      'bash',
      substrateScriptVmPath('provision-substrate.sh'),
    ]);
  });

  // Provisioning failures are surfaced with the guest's own output: "exit 1"
  // alone sends the reader to a VM shell to find out what apt said.
  it('reports the guest output when provisioning fails', async () => {
    const runner = failingOn(
      (args) => args.includes('bash') && args.some((a) => a.endsWith('provision-substrate.sh')),
      {
        stdout: '',
        stderr: 'E: Unable to locate package libgpod4',
        exitCode: 100,
      }
    );

    await expect(provisionSubstrate({ vmName: 'vm1', subprocess: runner })).rejects.toThrow(
      /exit 100.*Unable to locate package libgpod4/s
    );
  });
});

describe('runSubstrateDoctor', () => {
  // A failing doctor is an expected outcome rendered differently by each
  // caller — a gate, a setup hint, a drift report — so it is returned rather
  // than thrown.
  it('returns the verdict rather than throwing on failure', async () => {
    const runner = failingOn(
      (args) => args.includes('bash') && args.some((a) => a.endsWith('substrate-doctor.sh')),
      {
        stdout: 'FAIL     module sg is not loaded\n',
        stderr: 'substrate-doctor: FAIL — 1 assertion(s) failed\n',
        exitCode: 1,
      }
    );

    const result = await runSubstrateDoctor({ vmName: 'vm1', subprocess: runner });
    expect(result.ok).toBe(false);
    expect(result.stdout).toContain('module sg is not loaded');
  });

  it('passes the verdict through on success', async () => {
    const { runner } = recorder(ok('substrate-doctor: PASS\n'));
    const result = await runSubstrateDoctor({ vmName: 'vm1', subprocess: runner });
    expect(result.ok).toBe(true);
  });

  it('forwards --strict only when asked', async () => {
    const relaxed = recorder();
    await runSubstrateDoctor({ vmName: 'vm1', subprocess: relaxed.runner });
    expect(relaxed.calls.at(-1)?.args).not.toContain('--strict');

    const strict = recorder();
    await runSubstrateDoctor({ vmName: 'vm1', subprocess: strict.runner, strict: true });
    expect(strict.calls.at(-1)?.args.at(-1)).toBe('--strict');
  });

  // A drift check asks what the box currently satisfies. Re-seeding the
  // scripts from the host first would answer a different question.
  it('skips the copy when inspecting what is already installed', async () => {
    const { runner, calls } = recorder();
    await runSubstrateDoctor({ vmName: 'vm1', subprocess: runner, skipCopy: true });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toContain(substrateScriptVmPath('substrate-doctor.sh'));
  });
});
