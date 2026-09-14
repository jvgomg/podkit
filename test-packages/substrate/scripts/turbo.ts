#!/usr/bin/env bun
/**
 * `turbo`, with the target architecture materialised into the environment
 * first.
 *
 * ## Why this wrapper exists
 *
 * `turbo.json` declares `PODKIT_TARGET_ARCH` as an input of every task that
 * produces a Linux binary, plus the two cached VM suites. That declaration is
 * what stops turbo replaying an arm64 artifact into an amd64 run — but only if
 * the variable actually holds a value. An unset variable hashes identically on
 * every machine, which is the same wrong cache key wearing a different hat:
 * the artifact filenames carry the architecture, so the *outputs* are distinct
 * and nothing errors; the binary is simply wrong.
 *
 * So every entry point that can reach one of those tasks goes through here,
 * and here resolves the value once.
 *
 * ## Why it does not talk to the substrate
 *
 * It would be easy to probe the selected substrate for `uname -m` at this
 * point, and it would be wrong. This wrapper runs *before* `test:vm`, which is
 * the command that brings the substrate up and repairs it — a probe here would
 * turn "start the VM and run the suite" into "fail because the VM is not
 * started". Worse, it would add a round trip to every `turbo run`, including
 * the ones that never touch a Linux binary.
 *
 * The rule from `@podkit/substrate`'s `target-arch.ts` holds here: resolving a
 * path is synchronous and cheap, asking the substrate is neither, and the two
 * do not get mixed. `targetArch()` answers from `PODKIT_TARGET_ARCH` if
 * somebody already resolved it (CI, a developer who exported it, or an entry
 * point that primed it from a link) and from the host's own architecture
 * otherwise. Writing that answer back is the whole job: the value becomes
 * explicit, stable, and distinct between a machine that builds arm64 and one
 * that builds amd64 — which is exactly what the cache key needs.
 *
 * ## Usage
 *
 *   bun test-packages/substrate/scripts/turbo.ts run test:vm
 *
 * Arguments are forwarded verbatim; the exit code is turbo's.
 *
 * @module
 */

import { TARGET_ARCH_ENV_VAR, targetArch, TargetArchError } from '../src/target-arch.js';

async function main(): Promise<number> {
  let arch: string;
  try {
    arch = targetArch();
  } catch (err) {
    if (err instanceof TargetArchError) {
      process.stderr.write(`[turbo] ${err.message}\n`);
      return 1;
    }
    throw err;
  }

  const proc = Bun.spawn(['bunx', 'turbo', ...process.argv.slice(2)], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, [TARGET_ARCH_ENV_VAR]: arch },
  });
  return proc.exited;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[turbo] failed to invoke turbo: ${message}\n`);
    process.exit(1);
  });
