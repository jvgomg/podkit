/**
 * Generic in-VM transport primitives shared by every Lima caller.
 *
 * Three operations cover the substrate's transport needs:
 *
 *   - {@link runInVm}        — run a shell command inside a VM, honouring
 *                              cwd/env/timeout.
 *   - {@link copyOut}        — copy a file OUT of a VM to the host.
 *   - {@link stageSourceTree}— rsync the host source tree into a VM-local
 *                              directory (the "rsync repo into /tmp then build"
 *                              staging the host build wrappers perform today).
 *
 * Every call is routed through the injected `SubprocessRunner` so the transport
 * is unit-testable with scripted `limactl` outputs. The host build wrappers and
 * the Linux test runner all stage through {@link stageSourceTree}, so the
 * exclude floor and the rsync exit-24 tolerance have exactly one definition.
 *
 * @module
 */

import { defaultSubprocessRunner, type SubprocessRunner } from '@podkit/device-types';
import { limactlError, runLimactl, shellQuote } from './limactl.js';

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
//     ({@link FILE_COPY_TIMEOUT_MS}).
//   - `stageSourceTree` is genuinely open-ended — the same carve-out the cold
//     create has — and is left unbounded. See the note on the function.
//
// Every bound goes through `runLimactl`, which owns the descriptive
// `timed out after Nms` message. A bound that fires anonymously as execFile's
// generic "killed" is most of the way back to having no bound at all.
// ---------------------------------------------------------------------------

/**
 * Bound for a single-file `limactl copy` in either direction.
 *
 * The payload is one file, not a tree, and the substrate's largest one is a
 * compiled podkit binary — ~120 MB for the Linux CLI. Measured over the Lima
 * SSH loopback on this class of host, 118 MB moves in ~0.7s in either
 * direction (~170 MB/s), so the transfer itself is never the reason this would
 * be slow.
 *
 * The bound is therefore sized off a throughput FLOOR rather than the measured
 * figure: 1 MB/s, roughly two orders of magnitude below measured, which is what
 * a host deep in swap with a contended SSH channel looks like. That gives 120s
 * for a 120 MB payload, plus 30s of headroom for the SSH handshake in front of
 * it. Anything past that is a wedged session, not a slow copy.
 */
export const FILE_COPY_TIMEOUT_MS = 150_000;

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
 * `cwd`/`env` are realised by synthesising a small `sh -c` wrapper that exports
 * the env, cds, and execs the command. `timeoutMs` is enforced by the host-side
 * `SubprocessRunner`. A timeout surfaces as `exitCode = 124` (the conventional
 * `timeout(1)` exit code) via the underlying runner.
 */
export async function runInVm(
  vmName: string,
  command: string,
  opts: RunInVmOpts = {}
): Promise<RunInVmResult> {
  if (!vmName) throw new Error('runInVm: vmName is required.');
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  const wrapped = wrapCommand(command, opts);
  // Route through runLimactl rather than calling the runner directly: it owns
  // the transport-level error vocabulary, including the explicit "timed out
  // after Nms" message. Spawning here instead would bound the call but let the
  // bound fire anonymously as execFile's generic "killed", which is most of
  // the way back to having no bound at all.
  const result = await runLimactl(
    subprocess,
    ['shell', vmName, '--', 'sh', '-c', wrapped],
    typeof opts.timeoutMs === 'number' ? { timeoutMs: opts.timeoutMs } : {}
  );
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
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
 * Copy a file OUT of a VM to the host via `limactl copy <vm>:<vmPath> <hostPath>`.
 * Bounded by {@link FILE_COPY_TIMEOUT_MS}. Throws a descriptive error on any
 * non-zero exit.
 */
export async function copyOut(opts: CopyOutOpts): Promise<void> {
  if (!opts.vmName) throw new Error('copyOut: vmName is required.');
  if (!opts.vmPath) throw new Error('copyOut: vmPath is required.');
  if (!opts.hostPath) throw new Error('copyOut: hostPath is required.');
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  const result = await runLimactl(
    subprocess,
    ['copy', `${opts.vmName}:${opts.vmPath}`, opts.hostPath],
    { timeoutMs: FILE_COPY_TIMEOUT_MS }
  );
  if (result.exitCode !== 0) {
    throw limactlError(`failed to copy ${opts.vmName}:${opts.vmPath} → ${opts.hostPath}`, result);
  }
}

/**
 * The host artefacts that must never ride along into a VM-local source tree.
 *
 * Every caller that stages the repo into a VM shares this set; a caller that
 * needs more prunes passes them as `excludes`, which EXTEND (never replace)
 * these. Keeping the shared floor in one place is the point: the per-script
 * copies of this list had drifted, so one wrapper shipped host build
 * intermediates its sibling did not.
 *
 * Each entry earns its place:
 *   - `node_modules` — host-arch native bindings plus Bun's content-addressed
 *     `.bun/node-gyp@<hash>` directories. Every VM caller reinstalls in-VM so
 *     the node-gyp paths baked into a build belong to the VM's realm.
 *   - `.turbo` — task hashes computed for the host arch mean nothing in the VM.
 *   - `dist` — rebuilt in-VM.
 *   - `.git` — weight without value to a build.
 *   - `packages/libgpod-node/build` — node-gyp intermediates with absolute
 *     host paths baked into `*.d` dep files; reusing them in the VM produces
 *     stale-state link failures.
 *   - `packages/podkit-cli/bin`, `packages/demo/bin` — host binaries that would
 *     shadow the ones the VM is about to produce.
 *   - `packages/ipod-db/fixtures/databases` — large generated fixtures.
 *   - `graphify-out` — the host-local knowledge-graph output. Gitignored, read
 *     by no VM, and the single largest thing in the tree (hundreds of MB), so
 *     it dominated the transfer window of every cold stage.
 *   - `tools/libgpod-macos/build` — macOS-only build output.
 *   - `*.bun-build`, `*.img` — transient artefacts; `*.bun-build` in particular
 *     is the file most likely to vanish mid-rsync (see the exit-24 tolerance).
 *   - `src-tauri/target` — Rust build output, large and host-specific.
 *
 * Deliberately NOT here: `packages/libgpod-node/prebuilds`. The prebuild
 * wrappers exclude it (they are producing it and want a clean tree); the binary
 * wrappers must carry it in so `compile.sh` can embed it. Callers state which
 * they are.
 */
export const DEFAULT_STAGE_EXCLUDES: readonly string[] = [
  'node_modules',
  '.turbo',
  'dist',
  '.git',
  'packages/libgpod-node/build',
  'packages/podkit-cli/bin',
  'packages/demo/bin',
  'packages/ipod-db/fixtures/databases',
  'graphify-out',
  'tools/libgpod-macos/build',
  '*.bun-build',
  '*.img',
  'src-tauri/target',
];

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
   * {@link DEFAULT_STAGE_EXCLUDES} rather than replacing them.
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
 * The rsync exit code meaning "some files vanished before they could be
 * transferred". A benign race with host-side processes touching files during
 * the sync window (a `bun build --compile` dropping a `*.bun-build` temp file
 * is the classic offender), so every staging caller tolerates it — centralised
 * here rather than restated in each wrapper.
 */
const RSYNC_VANISHED_EXIT = 24;

/**
 * rsync the host source tree into a VM-local directory.
 *
 * Mirrors the staging the build wrappers perform: an in-VM `rsync -a --delete`
 * from the host-mounted source to a VM-local `/tmp` tree, with
 * {@link DEFAULT_STAGE_EXCLUDES} plus the caller's extra excludes applied.
 * rsync exit {@link RSYNC_VANISHED_EXIT} is tolerated; any other non-zero exit
 * throws.
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
 *
 * The `mkdir -p` in front of the rsync shares this call by design. Splitting it
 * out to bound it separately would buy an SSH round trip on every stage to
 * guard against a hang whose only cause — a wedged `limactl shell` — the rsync
 * that follows it would hit anyway.
 */
export async function stageSourceTree(opts: StageSourceTreeOpts): Promise<void> {
  if (!opts.vmName) throw new Error('stageSourceTree: vmName is required.');
  if (!opts.hostSrc) throw new Error('stageSourceTree: hostSrc is required.');
  if (!opts.vmDest) throw new Error('stageSourceTree: vmDest is required.');
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;

  const excludeArgs = [...DEFAULT_STAGE_EXCLUDES, ...(opts.excludes ?? [])]
    .map((pattern) => `--exclude ${shellQuote(pattern)}`)
    .join(' ');
  const maybeSudo = opts.sudo ? 'sudo ' : '';
  // Trailing slashes matter: `src/` → contents of src copied INTO dest.
  // `sh` here is the VM's /bin/sh — dash on Debian, busybox ash on Alpine —
  // so `set -o pipefail` is NOT available (dash rejects it outright). The
  // script contains no pipeline, so `set -u` alone is the portable equivalent.
  const script =
    `set -u; ` +
    `${maybeSudo}mkdir -p ${shellQuote(opts.vmDest)}; ` +
    `${maybeSudo}rsync -a --delete ${excludeArgs} ${shellQuote(`${opts.hostSrc}/`)} ${shellQuote(`${opts.vmDest}/`)}; ` +
    `rc=$?; if [ "$rc" -ne 0 ] && [ "$rc" -ne ${RSYNC_VANISHED_EXIT} ]; then exit "$rc"; fi`;

  // No `timeoutMs`: see the note on this function.
  const result = await runLimactl(subprocess, ['shell', opts.vmName, '--', 'sh', '-c', script]);
  if (result.exitCode !== 0) {
    throw limactlError(`failed to stage source tree into ${opts.vmName}:${opts.vmDest}`, result);
  }
}

/**
 * Wrap a user command so the VM-side `sh -c` honours `cwd` and `env`. Env vars
 * are exported as `K='…'` (POSIX single-quote form; embedded single quotes are
 * escaped as `'\''` by {@link shellQuote}).
 */
function wrapCommand(command: string, opts: RunInVmOpts): string {
  const segments: string[] = [];
  if (opts.env) {
    for (const [key, value] of Object.entries(opts.env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(`runInVm.env: invalid variable name '${key}'`);
      }
      segments.push(`export ${key}=${shellQuote(value)}`);
    }
  }
  if (opts.cwd) {
    segments.push(`cd ${shellQuote(opts.cwd)}`);
  }
  segments.push(command);
  return segments.join('; ');
}
