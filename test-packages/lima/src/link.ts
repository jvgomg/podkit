/**
 * The `limactl` substrate link — how the harness reaches a box that Lima
 * provisioned.
 *
 * It lives in the provisioner package because reaching a Lima instance is a
 * Lima concern: the credentials, the generated ssh config and the instance
 * namespace are all Lima's, and `limactl shell` is how it lends them out.
 * ADR-028 §3 puts it exactly there — once Lima is demoted from substrate to
 * provisioner, its remaining job is "create the box and report how to reach
 * it". This module is the second half of that sentence.
 *
 * The argv it produces is byte-for-byte what the harness hand-assembled at 39
 * sites before the link existed (`limactl shell <vm> -- …`, `limactl copy
 * <host> <vm>:<path>`), which is what let the change land underneath the unit
 * tests that pin those invocations rather than through them.
 *
 * ## Telling a link failure from a guest failure
 *
 * `limactl shell` returns the GUEST's exit code, so the exit code alone cannot
 * answer "did the box refuse, or did the command fail". Two signals do:
 *
 *   - `runLimactl` REJECTS for host-level failures — limactl not installed, the
 *     bound fired, the process was signalled. None of those are a guest
 *     verdict, so all of them are link failures.
 *   - limactl's own fatal diagnostics, and the SSH vocabulary underneath them,
 *     appear on stderr. `limactl shell` against a stopped or unregistered
 *     instance never reaches a guest at all.
 *
 * Both are heuristics over text, and deliberately conservative: a miss reports
 * a link failure as the guest's, which is exactly the behaviour that existed
 * before this module and therefore cannot be a regression.
 *
 * @module
 */

import { defaultSubprocessRunner, type SubprocessRunner } from '@podkit/device-types';
import {
  SubstrateLinkError,
  describeGuestCommand,
  looksLikeLinkFailureResult,
  guestStageScript,
  resolveGuestArgv,
  settleLinkResult,
  stageExitIsOk,
  startHostLinkProcess,
  type HostSpawnFn,
  type SubstrateCommand,
  type SubstrateCopyOpts,
  type SubstrateExecOpts,
  type SubstrateExecResult,
  type SubstrateLink,
  type SubstrateProcess,
  type SubstrateLinkOperation,
  type SubstrateSpawnOpts,
  type StageTreeOpts,
} from '@podkit/substrate';

import { runLimactl } from './limactl.js';

/**
 * limactl's own fatal-diagnostic vocabulary, on top of the SSH vocabulary
 * shared with the direct-SSH link. These are the things it says when the
 * command never reached a guest.
 *
 * ## Two things this pattern has to survive, and one it must not match
 *
 * **The logrus prefix depends on the terminal.** limactl writes the bracketed
 * `FATA[0000] …` form only when stderr is a TTY. The harness captures stderr
 * through a pipe at every call site, so the string that actually arrives is
 * the key=value one, with the message embedded and its quotes escaped:
 *
 *     time="…" level=fatal msg="instance \"podkit-device\" does not exist, run …"
 *     time="…" level=fatal msg="instance \"podkit-builder-musl\" is stopped, run …"
 *
 * A pattern keyed on `FATA[` is therefore keyed on the form no production run
 * ever sees, and a pattern requiring a bare `instance "` misses the escaped
 * quotes. Both were true here, which is why the two canonical Lima failures —
 * missing instance, stopped instance — went through unclassified. That matters
 * on this repo's own hardware: the device VM is known to end up `stopped` after
 * the Mac sleeps, and a suite that loses the substrate mid-run should say the
 * box is unreachable, not diagnose the guest.
 *
 * **`level=fatal` alone is logrus, not limactl.** This tier stands alone — it
 * convicts without the empty-stdout corroboration {@link
 * looksLikeLinkFailureResult} requires — so it may only contain text a guest
 * command cannot produce. A bare `level=fatal` fails that test: `nerdctl` is
 * logrus-based too, and under capture a failing `nerdctl run` in the
 * docker-in-substrate path prints, from INSIDE a perfectly healthy guest,
 *
 *     time="…" level=fatal msg="cannot access containerd socket \"…\": no such file…"
 *
 * which this tier would read as an unreachable substrate and turn a real
 * failure into a skip. So the tier is narrowed to the sentence only limactl
 * can write — a verdict about a Lima INSTANCE — rather than gated on stdout:
 * gating would not have helped, since a failed `nerdctl run` frequently
 * produces no stdout either.
 *
 * The alternation is the wording limactl itself carries (verified against the
 * format strings in the `limactl` 2.1.1 binary: `instance %q does not exist`,
 * `instance %q is stopped`, `instance %q not found`). A future re-word degrades
 * to the conservative miss this module documents — the link failure is reported
 * as the guest's — rather than to anything unsafe.
 */
const LIMACTL_FAILURE_PATTERNS: readonly RegExp[] = [
  /\binstance \\?"[^"\\]+\\?" (?:does not exist|is stopped|not found)/i,
];

/**
 * Whether a non-zero result is the link dying rather than the guest refusing.
 *
 * Two tiers, because the evidence differs in strength. limactl's OWN verdict
 * about a Lima instance is unambiguous — nothing inside a guest has one to
 * give — so it stands alone. The SSH vocabulary underneath is shared with
 * tools a guest might legitimately run, so it goes through {@link
 * looksLikeLinkFailureResult}, which also requires the guest to have produced
 * no output of its own. Tier one carries its own narrowness instead; see the
 * note on {@link LIMACTL_FAILURE_PATTERNS}.
 */
function looksLikeLimactlLinkFailure(result: SubstrateExecResult): boolean {
  return (
    LIMACTL_FAILURE_PATTERNS.some((p) => p.test(result.stderr)) ||
    looksLikeLinkFailureResult(result)
  );
}

/**
 * What a limactl link needs to know about the substrate it reaches.
 *
 * Narrower than a full `LimaVmDefinition` on purpose. A registry entry is
 * assignable to it, so the common case is `createLimactlLink(getVm('device'))`
 * — but `runInVm`, whose whole job is "shell into whatever instance you were
 * handed", has only a name, and forcing it to fabricate a YAML path and a
 * category to reach the same argv would be a worse lie than the narrow type.
 */
export interface LimaSubstrateTarget {
  /** Registry id, carried into every error the link raises. */
  readonly id: string;
  /** The Lima instance name `limactl` knows the box by. */
  readonly instanceName: string;
}

/** Options for {@link createLimactlLink}. */
export interface CreateLimactlLinkOpts {
  /** DI seam for `limactl`; production callers leave unset. */
  subprocess?: SubprocessRunner;
  /** DI seam for the host-side spawn used by `spawn`; production leaves unset. */
  spawnFn?: HostSpawnFn;
}

/**
 * Build a {@link SubstrateLink} that reaches `def` through `limactl`.
 *
 * Takes the registry definition rather than a bare instance name so the link
 * can carry the substrate's `id` into every error it raises: a message naming
 * only `podkit-device` says nothing about which of two configured substrates
 * the run was actually driving.
 */
export function createLimactlLink(
  def: LimaSubstrateTarget,
  opts: CreateLimactlLinkOpts = {}
): SubstrateLink {
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  const vmName = def.instanceName;
  const description = `Lima instance \`${vmName}\``;

  const linkFailure = (
    operation: SubstrateLinkOperation,
    what: string,
    detail: string,
    cause?: unknown
  ): SubstrateLinkError =>
    new SubstrateLinkError({
      substrateId: def.id,
      operation,
      // The detail leads, because when the cause is `runLimactl`'s own message
      // it already reads as a full sentence (including the `brew install lima`
      // hint and the `timed out after Nms` bound), and burying it behind a
      // preamble is how a useful diagnostic stops being read.
      message:
        `${detail} — substrate '${def.id}' is unreachable over ${description} ` +
        `(while trying to ${what}). Bring it up with \`bun run vm:up ${def.id}\`.`,
      cause,
    });

  const link: SubstrateLink = {
    substrateId: def.id,
    description,

    async exec(command: SubstrateCommand, execOpts: SubstrateExecOpts = {}) {
      const guestArgv = resolveGuestArgv(command, execOpts);
      let result: SubstrateExecResult;
      try {
        // Routed through `runLimactl` rather than the runner directly: it owns
        // the transport-level error vocabulary, including the explicit "timed
        // out after Nms" message. Spawning here instead would bound the call
        // but let the bound fire anonymously as execFile's generic "killed",
        // which is most of the way back to having no bound at all.
        result = await runLimactl(
          subprocess,
          ['shell', vmName, '--', ...guestArgv],
          typeof execOpts.timeoutMs === 'number' ? { timeoutMs: execOpts.timeoutMs } : {}
        );
      } catch (err) {
        throw linkFailure(
          'exec',
          `run \`${describeGuestCommand(command)}\``,
          err instanceof Error ? err.message : String(err),
          err
        );
      }
      if (result.exitCode !== 0 && looksLikeLimactlLinkFailure(result)) {
        throw linkFailure('exec', `run \`${describeGuestCommand(command)}\``, result.stderr.trim());
      }
      return result;
    },

    async copyIn(hostPath: string, guestPath: string, copyOpts: SubstrateCopyOpts = {}) {
      let result: SubstrateExecResult;
      try {
        result = await runLimactl(
          subprocess,
          ['copy', hostPath, `${vmName}:${guestPath}`],
          typeof copyOpts.timeoutMs === 'number' ? { timeoutMs: copyOpts.timeoutMs } : {}
        );
      } catch (err) {
        throw linkFailure(
          'copyIn',
          `copy ${hostPath} → ${guestPath}`,
          err instanceof Error ? err.message : String(err),
          err
        );
      }
      settleLinkResult({
        result,
        classify: looksLikeLimactlLinkFailure,
        linkFailure: (detail) => linkFailure('copyIn', `copy ${hostPath} → ${guestPath}`, detail),
        what: `copy ${hostPath} → ${vmName}:${guestPath}`,
      });
    },

    async copyOut(guestPath: string, hostPath: string, copyOpts: SubstrateCopyOpts = {}) {
      // `limactl copy` takes `<vm>:<path>` on whichever side is the guest, so
      // this is `copyIn` with the two operands swapped and nothing else.
      let result: SubstrateExecResult;
      try {
        result = await runLimactl(
          subprocess,
          ['copy', `${vmName}:${guestPath}`, hostPath],
          typeof copyOpts.timeoutMs === 'number' ? { timeoutMs: copyOpts.timeoutMs } : {}
        );
      } catch (err) {
        throw linkFailure(
          'copyOut',
          `copy ${guestPath} → ${hostPath}`,
          err instanceof Error ? err.message : String(err),
          err
        );
      }
      settleLinkResult({
        result,
        classify: looksLikeLimactlLinkFailure,
        linkFailure: (detail) => linkFailure('copyOut', `copy ${guestPath} → ${hostPath}`, detail),
        what: `copy ${vmName}:${guestPath} → ${hostPath}`,
      });
    },

    async stageTree(hostSrc: string, guestDest: string, stageOpts: StageTreeOpts = {}) {
      // In-GUEST rsync, reading `hostSrc` through Lima's home mount. Nothing
      // crosses the link but the command, which is why a cold stage of a
      // multi-gigabyte tree costs a VM-local copy rather than an SSH transfer.
      // The SSH link cannot do this and does not try — see the note on
      // `SubstrateLink.stageTree`.
      //
      // The `mkdir -p` shares this call by design. Splitting it out to bound it
      // separately would buy an SSH round trip on every stage to guard against
      // a hang whose only cause — a wedged `limactl shell` — the rsync that
      // follows it would hit anyway.
      const script = guestStageScript(hostSrc, guestDest, stageOpts);
      let result: SubstrateExecResult;
      try {
        result = await runLimactl(
          subprocess,
          ['shell', vmName, '--', 'sh', '-c', script],
          typeof stageOpts.timeoutMs === 'number' ? { timeoutMs: stageOpts.timeoutMs } : {}
        );
      } catch (err) {
        throw linkFailure(
          'stageTree',
          `stage ${hostSrc} → ${guestDest}`,
          err instanceof Error ? err.message : String(err),
          err
        );
      }
      // The script itself already swallows the tolerated vanished-file exit, so
      // a non-zero code here is rsync's own or the shell's. Re-checking costs
      // nothing and keeps the two links agreeing on what "staged" means.
      if (stageExitIsOk(result.exitCode)) return;
      settleLinkResult({
        result,
        classify: looksLikeLimactlLinkFailure,
        linkFailure: (detail) =>
          linkFailure('stageTree', `stage ${hostSrc} → ${guestDest}`, detail),
        what: `stage ${hostSrc} → ${vmName}:${guestDest}`,
      });
    },

    spawn(command: SubstrateCommand, spawnOpts: SubstrateSpawnOpts = {}): SubstrateProcess {
      const guestArgv = resolveGuestArgv(command, spawnOpts);
      return startHostLinkProcess({
        command: 'limactl',
        args: ['shell', vmName, '--', ...guestArgv],
        stdio: spawnOpts.stdio ?? 'pipe',
        ...(opts.spawnFn ? { spawnFn: opts.spawnFn } : {}),
      });
    },
  };
  return link;
}
