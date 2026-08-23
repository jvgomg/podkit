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
 * is unit-testable with scripted `limactl` outputs. These are the shared
 * primitives; migrating the existing build wrappers onto them is a later phase.
 *
 * @module
 */

import { defaultSubprocessRunner, type SubprocessRunner } from '@podkit/device-types';
import { limactlError, runLimactl, shellQuote, type LimactlResult } from './limactl.js';

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
  const subprocessOpts =
    typeof opts.timeoutMs === 'number' ? { timeoutMs: opts.timeoutMs } : undefined;
  let result: LimactlResult;
  try {
    result = await subprocess.run(
      'limactl',
      ['shell', vmName, '--', 'sh', '-c', wrapped],
      subprocessOpts
    );
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    const hint = /ENOENT|not found/i.test(cause)
      ? ' (is `limactl` installed? `brew install lima`)'
      : '';
    throw new Error(`limactl shell ${vmName} failed: ${cause}${hint}`);
  }
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
 * Throws a descriptive error on any non-zero exit.
 */
export async function copyOut(opts: CopyOutOpts): Promise<void> {
  if (!opts.vmName) throw new Error('copyOut: vmName is required.');
  if (!opts.vmPath) throw new Error('copyOut: vmPath is required.');
  if (!opts.hostPath) throw new Error('copyOut: hostPath is required.');
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  const result = await runLimactl(subprocess, [
    'copy',
    `${opts.vmName}:${opts.vmPath}`,
    opts.hostPath,
  ]);
  if (result.exitCode !== 0) {
    throw limactlError(`failed to copy ${opts.vmName}:${opts.vmPath} → ${opts.hostPath}`, result);
  }
}

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
  /** rsync `--exclude` patterns. */
  excludes?: readonly string[];
  /** DI seam for `limactl`; production callers leave unset. */
  subprocess?: SubprocessRunner;
}

/**
 * rsync the host source tree into a VM-local directory.
 *
 * Mirrors the staging the build wrappers perform: an in-VM `rsync -a --delete`
 * from the host-mounted source to a VM-local `/tmp` tree, with the caller's
 * excludes applied. rsync exit 24 ("some files vanished before they could be
 * transferred") is a benign race with host-side processes touching files
 * mid-sync and is tolerated; any other non-zero exit throws.
 */
export async function stageSourceTree(opts: StageSourceTreeOpts): Promise<void> {
  if (!opts.vmName) throw new Error('stageSourceTree: vmName is required.');
  if (!opts.hostSrc) throw new Error('stageSourceTree: hostSrc is required.');
  if (!opts.vmDest) throw new Error('stageSourceTree: vmDest is required.');
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;

  const excludeArgs = (opts.excludes ?? [])
    .map((pattern) => `--exclude ${shellQuote(pattern)}`)
    .join(' ');
  // Trailing slashes matter: `src/` → contents of src copied INTO dest.
  const script =
    `set -uo pipefail; ` +
    `mkdir -p ${shellQuote(opts.vmDest)}; ` +
    `rsync -a --delete ${excludeArgs} ${shellQuote(`${opts.hostSrc}/`)} ${shellQuote(`${opts.vmDest}/`)}; ` +
    `rc=$?; if [ "$rc" -ne 0 ] && [ "$rc" -ne 24 ]; then exit "$rc"; fi`;

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
