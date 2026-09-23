#!/usr/bin/env bun
/**
 * `turbo`, with the target and host architectures materialised into the
 * environment first.
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
 * ## The second value, and why it is not redundant
 *
 * The musl tasks produce every architecture the run needs rather than the one
 * it targets, and "every architecture the run needs" is a function of the
 * target AND the host (`../src/required-arches.ts`). Only the target was in
 * the cache key — so two dev hosts of different architectures sharing one
 * substrate hashed identically while producing different sets of artifacts,
 * and the single-architecture host's cache entry replayed into the
 * cross-architecture host's run would leave the loopback surface with no musl
 * binary it can execute. {@link HOST_ARCH_ENV_VAR} is stamped here for the
 * same reason and by the same mechanism as the target.
 *
 * ## Why it asks the registry and not the substrate
 *
 * It would be easy to probe the selected substrate for `uname -m` at this
 * point, and it would be wrong. This wrapper runs *before* `test:vm`, which is
 * the command that brings the substrate up and repairs it — a probe here would
 * turn "start the VM and run the suite" into "fail because the VM is not
 * started". Worse, it would add a round trip to every `turbo run`, including
 * the ones that never touch a Linux binary.
 *
 * But the substrate does not have to be *asked* to be consulted. An ssh
 * substrate's architecture is declared in the registry by the entry the
 * developer selected, so {@link declaredSubstrateMachine} answers from facts
 * already in hand — no link, no round trip, no substrate running. A Lima
 * substrate declares nothing, and the host it was created from remains the
 * answer.
 *
 * Getting this wrong is not a missed optimisation. The value written here
 * takes PRECEDENCE over the substrate everywhere downstream (`configured`
 * beats `substrate` in `resolveTargetArch`, deliberately, so an unreachable
 * target can still be built for). So a wrapper that stamps the host's
 * architecture while an amd64 substrate is selected does not merely fail to
 * help — it overrides the entry point that would otherwise have got it right,
 * and the run builds arm64 artifacts for a box that cannot start them.
 *
 * ## The run lock
 *
 * Both callers run suites INSIDE the substrate, and this is the one process
 * that spans all of them — so an `ssh` substrate's run lock is taken here and
 * held until turbo exits. Taking it per suite would serialise the suites
 * against each other; taking it nowhere would leave two machines interleaving
 * persona and gadget state, which is what the lock is for.
 *
 * A Lima substrate is not locked here: it is local to this machine and the
 * host advisory lock already covers it.
 *
 * ## Usage
 *
 *   bun test-packages/substrate/scripts/turbo.ts run test:vm
 *
 * Arguments are forwarded verbatim; the exit code is turbo's.
 *
 * @module
 */

import {
  TARGET_ARCH_ENV_VAR,
  hostTargetArch,
  resolveTargetArch,
  TargetArchError,
  type TargetArchResolution,
} from '../src/target-arch.js';
import { HOST_ARCH_ENV_VAR } from '../src/required-arches.js';
import {
  declaredSubstrateMachine,
  selectSubstrate,
  SubstrateSelectionError,
} from '../src/selection.js';
import { type VmDefinition } from '../src/registry.js';
import { acquireRunLock } from '../src/run-lock.js';

/**
 * What the selected substrate declares, or `null` when nothing names one.
 *
 * Having no substrate is not an error here: a `turbo run build` on a machine
 * that has never run the harness is an ordinary thing to do, and the host's
 * own architecture is the right answer for it.
 *
 * Being told the WRONG one is a different matter, which is why the catch is
 * narrowed to {@link SubstrateSelectionError.unconfigured} rather than being a
 * blanket one. A mistyped `PODKIT_SUBSTRATE` swallowed here does not stop the
 * run: it stamps the host's architecture, every build task then compiles for
 * the wrong machine, and the first thing to actually refuse is a later task
 * that needs the substrate — so the error names a step that is fine, long
 * after the wasted work. Failing in this function costs a second instead.
 *
 * The announcement selection returns is discarded for the same reason the
 * build driver discards it — it is about which box the TESTS run on, and the
 * commands that own that decision announce it themselves.
 */
function selectedSubstrate(): VmDefinition | null {
  try {
    return selectSubstrate().substrate;
  } catch (err) {
    if (err instanceof SubstrateSelectionError && err.unconfigured) return null;
    throw err;
  }
}

async function main(): Promise<number> {
  let substrate: VmDefinition | null;
  let resolution: TargetArchResolution;
  try {
    substrate = selectedSubstrate();
    resolution = resolveTargetArch({
      env: process.env,
      substrateMachine: substrate ? declaredSubstrateMachine(substrate) : null,
      hostArch: process.arch,
    });
  } catch (err) {
    if (err instanceof TargetArchError || err instanceof SubstrateSelectionError) {
      process.stderr.write(`[turbo] ${err.message}\n`);
      return 1;
    }
    throw err;
  }
  const arch = resolution.arch;
  if (resolution.source === 'substrate') {
    // Worth a line: it is the case where the artifacts are NOT for this
    // machine, and a developer watching an arm64 Mac compile x64 binaries
    // should be able to see why without reading the registry.
    process.stderr.write(
      `[turbo] targeting linux-${arch} — the selected substrate declares it. ` +
        `Set ${TARGET_ARCH_ENV_VAR} to override; see .env.example.\n`
    );
  }

  const lock = await acquireRunLock(substrate);
  if (lock.kind === 'refused') {
    process.stderr.write(`[turbo] ${lock.reason}\n`);
    return 1;
  }

  try {
    const proc = Bun.spawn(['bunx', 'turbo', ...process.argv.slice(2)], {
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
      env: {
        ...process.env,
        [TARGET_ARCH_ENV_VAR]: arch,
        [HOST_ARCH_ENV_VAR]: hostTargetArch(),
      },
    });
    return await proc.exited;
  } finally {
    // Best-effort: a lock this process cannot release is reclaimed with
    // `vm:unlock --force`, which is why that verb exists.
    if (lock.kind === 'held') await lock.release().catch(() => undefined);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[turbo] failed to invoke turbo: ${message}\n`);
    process.exit(1);
  });
