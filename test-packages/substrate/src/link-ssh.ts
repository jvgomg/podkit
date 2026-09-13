/**
 * The SSH substrate link — how the harness reaches a substrate that no
 * provisioner in this repo has to have created.
 *
 * It lives in the provisioner-agnostic package rather than next to a
 * hypervisor driver because that is what it is: `ssh` names how the box is
 * REACHED, not what produced it (ADR-029 §1). A Proxmox guest, a libvirt VM, a
 * cloud instance and a spare box under a desk are all the same entry here.
 *
 * ## Connection detail is not in this file, and cannot be
 *
 * Everything that identifies the machine — address, user, port, key, jump host
 * — lives in the developer's own `~/.ssh/config` under the `Host` alias the
 * registry names. This module passes that alias to `ssh` and `scp` and nothing
 * else, which is how a public repository contains no infrastructure detail by
 * construction rather than by vigilance (ADR-029 §2). It also means a Tailscale
 * or bastion route works without this repo modelling it.
 *
 * ## Why `BatchMode=yes`
 *
 * The harness runs unattended inside a test suite. Without it, an ssh that
 * wants a passphrase or a host-key confirmation blocks on a TTY nobody is
 * watching, and the suite reports a hang rather than a misconfiguration.
 * `BatchMode` turns both into an immediate, named failure — which the link
 * then classifies as a link failure rather than as the guest saying no.
 *
 * ## Why the argv here is NOT the limactl link's argv
 *
 * See {@link sshRemoteCommand}. The two links differ in exactly one place, and
 * they have to in order to behave the same.
 *
 * @module
 */

import { defaultSubprocessRunner, type SubprocessRunner } from '@podkit/device-types';

import type { SshVmDefinition } from './registry.js';
import {
  SubstrateLinkError,
  describeGuestCommand,
  isTimeoutRejection,
  looksLikeLinkFailureResult,
  resolveGuestArgv,
  shellQuote,
  type SubstrateCommand,
  type SubstrateCopyOpts,
  type SubstrateExecOpts,
  type SubstrateExecResult,
  type SubstrateLink,
  type SubstrateProcess,
  type SubstrateSpawnOpts,
} from './link.js';
import { startHostLinkProcess, type HostSpawnFn } from './link-spawn.js';

/**
 * `ssh` options every invocation carries.
 *
 * Kept to the minimum that makes an unattended run diagnosable. Notably absent
 * is anything that relaxes host-key checking: a substrate whose key changed is
 * a substrate the operator should look at, and quietly accepting a new key
 * would turn a security-relevant surprise into a silent reconnect.
 */
const SSH_BASE_ARGS: readonly string[] = ['-o', 'BatchMode=yes'];

/**
 * `ssh`'s reserved exit code for "the error was mine, not the command's".
 * Necessary but not sufficient to call something a link failure — a guest
 * command is free to exit 255 too — so it is paired with the evidence
 * {@link looksLikeLinkFailureResult} weighs.
 */
const SSH_SELF_ERROR_EXIT = 255;

/**
 * Fold a guest argv into the single command word `ssh` actually carries.
 *
 * This is the one place the two links MUST diverge in order to behave the
 * same, so it is worth being exact about why. `limactl shell <vm> -- <argv…>`
 * shell-quotes each word on the caller's behalf before the guest login shell
 * sees it. Plain `ssh <host> <argv…>` does not: it joins its remaining
 * arguments with spaces and hands the remote shell ONE string, which that
 * shell then re-parses. Passing the argv that is correct for limactl straight
 * to `ssh` therefore loses every quote the caller wrote.
 *
 * The failure mode is not an error, which is what makes it worth a paragraph.
 * `resolveGuestArgv` produces `['sh', '-c', 'sha256sum /x | awk …']`; over
 * unquoted ssh the remote shell reads that as `sh -c sha256sum /x` piped into
 * `awk`, so `sha256sum` reads empty stdin and the pipeline prints the hash of
 * nothing and exits 0. Measured against the live device substrate, the probe
 * that should answer `f7033844…` answered `e3b0c442…` — sha256 of the empty
 * string — with exit 0 and no diagnostic anywhere. A harness built on that
 * re-copies a multi-MiB image every run and never reports a fault.
 *
 * Quoting here rather than at the call sites that happen to contain a pipe is
 * deliberate: the caller wrote a command for `/bin/sh`, and which link carries
 * it is not the caller's business.
 */
function sshRemoteCommand(guestArgv: readonly string[]): string {
  return guestArgv.map(shellQuote).join(' ');
}

/** Options for {@link createSshLink}. */
export interface CreateSshLinkOpts {
  /** DI seam for `ssh`/`scp`; production callers leave unset. */
  subprocess?: SubprocessRunner;
  /** DI seam for the host-side spawn used by `spawn`; production leaves unset. */
  spawnFn?: HostSpawnFn;
}

/**
 * Run `ssh`/`scp` through the injected runner, giving a fired bound a name.
 *
 * The limactl link gets this for free from `runLimactl`, which exists in part
 * to stop `execFile`'s timeout surfacing as a generic "killed" with no mention
 * of the bound that was exceeded — a bound that fires anonymously is most of
 * the way back to having no bound at all. This link has no such wrapper, so it
 * does the same thing here rather than being the one substrate whose timeouts
 * are unattributable.
 *
 * The message names the alias and not the argv: a guest command can be a
 * multi-hundred-character generated script, and the caller's own error text
 * already carries a truncated render of it (see `describeGuestCommand`).
 */
async function runSshTool(
  subprocess: SubprocessRunner,
  tool: 'ssh' | 'scp',
  alias: string,
  args: readonly string[],
  timeoutMs: number | undefined
): Promise<SubstrateExecResult> {
  try {
    return await subprocess.run(
      tool,
      [...args],
      typeof timeoutMs === 'number' ? { timeoutMs } : undefined
    );
  } catch (err) {
    if (typeof timeoutMs === 'number' && isTimeoutRejection(err)) {
      throw new Error(
        `${tool} ${alias} timed out after ${timeoutMs}ms. ` +
          `The substrate is not answering — it may be down, starved of host ` +
          `CPU/memory, or its SSH session may be wedged.`,
        { cause: err }
      );
    }
    throw err;
  }
}

/**
 * Build a {@link SubstrateLink} that reaches `def` through its ssh_config
 * alias.
 */
export function createSshLink(def: SshVmDefinition, opts: CreateSshLinkOpts = {}): SubstrateLink {
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  const alias = def.sshAlias;
  const description = `ssh_config alias \`${alias}\``;

  const linkFailure = (
    operation: 'exec' | 'copyIn',
    what: string,
    detail: string,
    cause?: unknown
  ): SubstrateLinkError =>
    new SubstrateLinkError({
      substrateId: def.id,
      operation,
      message:
        `substrate '${def.id}' is unreachable over ${description}: ${detail} ` +
        `(while trying to ${what}). ` +
        `Check that the alias resolves — \`ssh ${alias} true\` — and that the host is up.`,
      cause,
    });

  return {
    substrateId: def.id,
    description,

    async exec(command: SubstrateCommand, execOpts: SubstrateExecOpts = {}) {
      const guestArgv = resolveGuestArgv(command, execOpts);
      const args = [...SSH_BASE_ARGS, alias, sshRemoteCommand(guestArgv)];
      let result: SubstrateExecResult;
      try {
        result = await runSshTool(subprocess, 'ssh', alias, args, execOpts.timeoutMs);
      } catch (err) {
        // The runner only rejects for host-level failures: `ssh` is not
        // installed, the bound fired, the process was signalled. None of those
        // are the guest's verdict.
        throw linkFailure(
          'exec',
          `run \`${describeGuestCommand(command)}\``,
          err instanceof Error ? err.message : String(err),
          err
        );
      }
      if (result.exitCode === SSH_SELF_ERROR_EXIT && looksLikeLinkFailureResult(result)) {
        throw linkFailure(
          'exec',
          `run \`${describeGuestCommand(command)}\``,
          result.stderr.trim() || `ssh exited ${SSH_SELF_ERROR_EXIT} with no output`
        );
      }
      return result;
    },

    async copyIn(hostPath: string, guestPath: string, copyOpts: SubstrateCopyOpts = {}) {
      // `-q` because scp's progress meter is written for a terminal and this
      // one is being captured. `-p` is deliberately absent: the destination's
      // mode is set by whatever installs the file into place, and inheriting
      // the host's is how a 0600 build artefact arrives unreadable.
      const args = [...SSH_BASE_ARGS, '-q', hostPath, `${alias}:${guestPath}`];
      let result: SubstrateExecResult;
      try {
        result = await runSshTool(subprocess, 'scp', alias, args, copyOpts.timeoutMs);
      } catch (err) {
        throw linkFailure(
          'copyIn',
          `copy ${hostPath} → ${guestPath}`,
          err instanceof Error ? err.message : String(err),
          err
        );
      }
      if (result.exitCode === 0) return;
      if (looksLikeLinkFailureResult(result)) {
        throw linkFailure('copyIn', `copy ${hostPath} → ${guestPath}`, result.stderr.trim());
      }
      throw new Error(
        `failed to copy ${hostPath} → ${alias}:${guestPath}: exit=${result.exitCode}: ` +
          (result.stderr.trim() || result.stdout.trim() || '(no output)')
      );
    },

    spawn(command: SubstrateCommand, spawnOpts: SubstrateSpawnOpts = {}): SubstrateProcess {
      const guestArgv = resolveGuestArgv(command, spawnOpts);
      return startHostLinkProcess({
        command: 'ssh',
        args: [...SSH_BASE_ARGS, alias, sshRemoteCommand(guestArgv)],
        stdio: spawnOpts.stdio ?? 'pipe',
        ...(opts.spawnFn ? { spawnFn: opts.spawnFn } : {}),
      });
    },
  };
}
