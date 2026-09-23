/**
 * Named, VM-shaped adapters over the limactl `SubstrateLink`.
 *
 * Three operations, each a one-liner over the link now that the link carries
 * all five:
 *
 *   - {@link runInVm}        — run a shell command inside a VM, honouring
 *                              cwd/env/timeout.
 *   - {@link copyOut}        — copy a file OUT of a VM to the host.
 *   - {@link stageSourceTree}— rsync the host source tree into a VM-local
 *                              directory.
 *
 * They remain because they carry Lima-specific preconditions in their
 * signatures (a VM *name*; a host source path readable through Lima's home
 * mount) and because the `podkit-vm` CLI and the Linux test-suite runner call
 * them by these names. What they no longer carry is a second implementation:
 * the argv, the bounds, the exclude floor and the rsync exit-24 tolerance are
 * the link's and `@podkit/substrate`'s, so a build host reached over ssh gets
 * the same behaviour rather than a parallel one.
 *
 * Every call is routed through the injected `SubprocessRunner` so the adapters
 * stay unit-testable with scripted `limactl` outputs.
 *
 * The file was called `transport.ts`. `CONTEXT.md` reserves that word for how
 * the PRODUCT reaches an iPod's firmware (USB vs SCSI), and once these three
 * became adapters over the link, a file named for the reserved word was the
 * confusion the glossary warns about.
 *
 * @module
 */

import { type SubprocessRunner } from '@podkit/device-types';
import { FILE_COPY_TIMEOUT_MS } from '@podkit/substrate';
import { createLimactlLink } from './link.js';

// ---------------------------------------------------------------------------
// Wall-clock bounds
//
// Bounded per operation, not per module, for the reason spelled out in
// `./lifecycle.js`: a bound that fires on a legitimate slow operation is worse
// than no bound at all. The three primitives here fall into three different
// buckets on purpose.
//
//   - `runInVm` carries NO default bound. Its duration is whatever the caller's
//     command does, and callers run in-VM `bun install`s and full turbo builds
//     through it. The caller passes `timeoutMs` when it knows what it launched;
//     inventing one here would abort a build the substrate knows nothing about.
//   - `copyOut` moves ONE file whose size the substrate can reason about, so a
//     wall clock derived from a throughput floor is the right instrument
//     (`FILE_COPY_TIMEOUT_MS`, in `@podkit/substrate`).
//   - `stageSourceTree` is genuinely open-ended — the same carve-out the cold
//     create has — and is left unbounded. See the note on the function.
//
// Every bound goes through the link, and through `runLimactl` beneath it, which
// owns the descriptive `timed out after Nms` message. A bound that fires
// anonymously as execFile's generic "killed" is most of the way back to having
// no bound at all.
// ---------------------------------------------------------------------------

/**
 * The single-file copy bound. It lives in `@podkit/substrate` beside the link
 * interface now, because both links move artifacts and a second derivation of
 * the same figure is what the constant exists to prevent. Re-exported so this
 * package's existing consumers resolve unchanged.
 */
export { FILE_COPY_TIMEOUT_MS } from '@podkit/substrate';

/** Options honoured by {@link runInVm}. */
export interface RunInVmOpts {
  /** Working directory inside the VM. */
  cwd?: string;
  /** Environment variables exported before the command runs. */
  env?: Record<string, string>;
  /** Host-side timeout in milliseconds. */
  timeoutMs?: number;
  /** DI seam for `limactl`; production callers leave unset. */
  subprocess?: SubprocessRunner;
}

/** Outcome of {@link runInVm}. */
export interface RunInVmResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run a single shell command inside a VM via `limactl shell <vm> -- sh -c …`.
 *
 * A thin adapter over the limactl {@link SubstrateLink}: `cwd`/`env` are
 * realised by the link's shared guest-command wrapper, and `timeoutMs` is
 * enforced by the host-side `SubprocessRunner`. A timeout surfaces as a thrown
 * `SubstrateLinkError` carrying the `timed out after Nms` message.
 *
 * Routing through the link rather than assembling `['shell', vm, '--', 'sh',
 * '-c', …]` here is what leaves exactly ONE definition of the env/cwd wrapper
 * in the repo. There used to be two, verbatim — this one and the device
 * harness's — which is how two callers of the same primitive can drift on
 * something as load-bearing as env quoting without anything noticing.
 */
export async function runInVm(
  vmName: string,
  command: string,
  opts: RunInVmOpts = {}
): Promise<RunInVmResult> {
  if (!vmName) throw new Error('runInVm: vmName is required.');
  const link = createLimactlLink(
    { id: vmName, instanceName: vmName },
    opts.subprocess ? { subprocess: opts.subprocess } : {}
  );
  return link.exec(command, {
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    ...(opts.env !== undefined ? { env: opts.env } : {}),
    ...(typeof opts.timeoutMs === 'number' ? { timeoutMs: opts.timeoutMs } : {}),
  });
}

/** Options for {@link copyOut}. */
export interface CopyOutOpts {
  vmName: string;
  /** Absolute path inside the VM to copy from. */
  vmPath: string;
  /** Absolute host path to copy to. */
  hostPath: string;
  /** DI seam for `limactl`; production callers leave unset. */
  subprocess?: SubprocessRunner;
}

/**
 * Copy a file OUT of a VM to the host.
 *
 * A thin adapter over the limactl {@link SubstrateLink}, exactly as
 * {@link runInVm} is — the argv (`limactl copy <vm>:<vmPath> <hostPath>`) and
 * the `FILE_COPY_TIMEOUT_MS` bound are unchanged. Routing through the
 * link is what keeps ONE definition of "pull a file off a box" in the repo now
 * that a remote builder needs the same operation over ssh.
 */
export async function copyOut(opts: CopyOutOpts): Promise<void> {
  if (!opts.vmName) throw new Error('copyOut: vmName is required.');
  if (!opts.vmPath) throw new Error('copyOut: vmPath is required.');
  if (!opts.hostPath) throw new Error('copyOut: hostPath is required.');
  const link = createLimactlLink(
    { id: opts.vmName, instanceName: opts.vmName },
    opts.subprocess ? { subprocess: opts.subprocess } : {}
  );
  await link.copyOut(opts.vmPath, opts.hostPath, { timeoutMs: FILE_COPY_TIMEOUT_MS });
}

/**
 * The shared exclude floor. It lives in `@podkit/substrate` now — *what* must
 * not ride along into a staged tree is a fact about this repo's source, not
 * about the provisioner receiving it, and a remote builder needs the identical
 * list. Re-exported here so this package's existing consumers resolve
 * unchanged.
 */
export { DEFAULT_STAGE_EXCLUDES } from '@podkit/substrate';

/** Options for {@link stageSourceTree}. */
export interface StageSourceTreeOpts {
  vmName: string;
  /**
   * Absolute host path of the source tree root. Lima mounts the host, so this
   * path is reachable at the same location inside the VM — the rsync runs
   * in-VM from the mounted source to a VM-local destination.
   */
  hostSrc: string;
  /** Absolute VM-local destination directory (typically under `/tmp`). */
  vmDest: string;
  /**
   * Extra rsync `--exclude` patterns, applied ON TOP OF
   * `DEFAULT_STAGE_EXCLUDES` rather than replacing them.
   */
  excludes?: readonly string[];
  /**
   * Run the in-VM rsync under `sudo`. Needed when the destination lives outside
   * the VM user's home (e.g. `/opt`).
   */
  sudo?: boolean;
  /** DI seam for `limactl`; production callers leave unset. */
  subprocess?: SubprocessRunner;
}

/**
 * rsync the host source tree into a VM-local directory.
 *
 * A thin adapter over the limactl {@link SubstrateLink}'s `stageTree`, which is
 * where the in-VM rsync and its rationale now live. Kept as a named function
 * because the `podkit-vm stage` verb and the Linux test-suite runner call it by
 * this name, and because its Lima-specific precondition — the host source path
 * is readable inside the VM through Lima's home mount — is worth stating in a
 * signature that takes a VM name.
 *
 * **Deliberately unbounded.** A cold stage of this repo copies a multi-gigabyte
 * tree, and its duration is set by how much the host has changed since the last
 * `--delete` sync — a figure the substrate cannot predict and a user can make
 * arbitrarily large. That is the same carve-out the cold create has, and for
 * the same reason: no wall clock is simultaneously tight enough to catch a
 * wedge and loose enough to spare a legitimate stage. What it gets instead is
 * the entry point's heartbeat — the CLI's `stage` verb injects the provisioning
 * runner, so a long rsync prints `still waiting on … (Nm elapsed)` rather than
 * sitting silent.
 */
export async function stageSourceTree(opts: StageSourceTreeOpts): Promise<void> {
  if (!opts.vmName) throw new Error('stageSourceTree: vmName is required.');
  if (!opts.hostSrc) throw new Error('stageSourceTree: hostSrc is required.');
  if (!opts.vmDest) throw new Error('stageSourceTree: vmDest is required.');
  const link = createLimactlLink(
    { id: opts.vmName, instanceName: opts.vmName },
    opts.subprocess ? { subprocess: opts.subprocess } : {}
  );
  // No `timeoutMs`: see the note on this function.
  await link.stageTree(opts.hostSrc, opts.vmDest, {
    ...(opts.excludes !== undefined ? { excludes: opts.excludes } : {}),
    ...(opts.sudo !== undefined ? { sudo: opts.sudo } : {}),
  });
}
