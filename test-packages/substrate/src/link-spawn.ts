/**
 * Host-side plumbing shared by both {@link SubstrateLink.spawn}
 * implementations.
 *
 * `exec` and `copyIn` go through the injected `SubprocessRunner`, which is a
 * request/response shape: it resolves once the child is finished. `spawn` is
 * the one operation that cannot, because its entire purpose is to hand back a
 * handle while the process is still running. So it reaches `node:child_process`
 * directly — with the spawn function itself injectable, so the seam the rest of
 * the substrate enjoys is not lost at exactly the operation with the most
 * interesting teardown semantics.
 *
 * @module
 */

import { spawn as nodeSpawn } from 'node:child_process';

import type { SubstrateExitStatus, SubstrateProcess, SubstrateSpawnOpts } from './link.js';

/**
 * The `node:child_process.spawn` shape, narrowed to what a link needs.
 * Production callers leave it unset; tests substitute a fake to assert argv
 * and drive teardown without a substrate.
 */
export type HostSpawnFn = typeof nodeSpawn;

/**
 * Start a host-side link process and wrap it as a {@link SubstrateProcess}.
 *
 * `exited` resolves on `close` rather than on `exit` so the promise settles
 * only once the output streams have drained — a caller that awaits `exited`
 * and then reads captured output would otherwise race the last chunk. It never
 * rejects: a link that could not start surfaces as a non-zero exit, which is
 * the same shape as the guest failing, because there is genuinely nothing to
 * distinguish at spawn time (see the teardown contract on
 * {@link SubstrateProcess}).
 */
export function startHostLinkProcess(opts: {
  command: string;
  args: readonly string[];
  stdio: NonNullable<SubstrateSpawnOpts['stdio']>;
  spawnFn?: HostSpawnFn;
}): SubstrateProcess {
  const spawnFn = opts.spawnFn ?? nodeSpawn;
  const capture = opts.stdio === 'pipe';
  const child = spawnFn(opts.command, [...opts.args], {
    stdio: ['ignore', capture ? 'pipe' : 'ignore', capture ? 'pipe' : 'ignore'],
  });

  const exited = new Promise<SubstrateExitStatus>((resolve) => {
    let settled = false;
    const settle = (status: SubstrateExitStatus): void => {
      if (settled) return;
      settled = true;
      resolve(status);
    };
    child.on('close', (code, signal) => settle({ exitCode: code, signal }));
    // A spawn that never produced a process emits `error` and no `close`.
    // Settling here keeps `exited` from hanging forever on a missing binary.
    child.on('error', () => settle({ exitCode: null, signal: null }));
  });

  return {
    pid: child.pid,
    stdout: child.stdout,
    stderr: child.stderr,
    exited,
    kill(signal?: NodeJS.Signals) {
      child.kill(signal);
    },
  };
}
