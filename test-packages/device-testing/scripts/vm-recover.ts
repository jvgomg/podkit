#!/usr/bin/env bun
/**
 * `vm:recover`, with the host-side baseline hash supplied.
 *
 * Every other `vm:*` script is `podkit-vm` directly. This one is not, because
 * `podkit-vm` lives in `@podkit/lima` and the provisioning inputs a guest is
 * sealed over span packages that depend on it — so the hash can only be
 * composed here, one layer up, and handed down as `--expect-hash`.
 *
 * Supplying it is what lets `recover` roll back. Without it nothing can be
 * compared, recover says so, and it takes the non-destructive branch.
 *
 * Everything else — the usage, the registry, the verbs, the terminal — stays
 * `podkit-vm`'s. This script adds one argument and gets out of the way.
 *
 * @module
 */

import { getVm, isSshVm, type VmDefinition } from '@podkit/substrate';
import { runPodkitVm } from '@podkit/lima';

import { computeBaselineHash, substrateBaselineInputs } from '../src/baseline-hash.js';

/**
 * The hash this substrate's guest should be sealed with, or `null` where the
 * question does not apply.
 *
 * A Lima VM's recover re-applies provisioning rather than rolling back, and an
 * untracked substrate seals nothing — in both cases an expected hash would be a
 * number with nothing to compare it to.
 */
function expectedHashFor(instance: string | undefined): string | null {
  let substrate: VmDefinition;
  try {
    substrate = getVm(instance ?? '');
  } catch {
    // A missing or unknown instance is `podkit-vm`'s error to report, against
    // its own usage and its own list of known VMs.
    return null;
  }
  if (!isSshVm(substrate) || !substrate.trackedForBaseline) return null;
  return computeBaselineHash(substrateBaselineInputs(substrate)).combinedSha;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);

  // An input file that has moved is worth saying out loud, because the verb
  // still runs and the branch it then takes is the quieter one.
  let expected: string | null = null;
  try {
    expected = expectedHashFor(argv[0]);
  } catch (err) {
    process.stderr.write(
      `[vm:recover] could not hash the provisioning inputs for '${argv[0]}': ` +
        `${err instanceof Error ? err.message : String(err)}\n` +
        `[vm:recover] recover will run with nothing to compare the guest against.\n`
    );
  }

  const hashArgs = expected === null ? [] : ['--expect-hash', expected];
  return runPodkitVm(['recover', ...argv, ...hashArgs]);
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`[vm:recover] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
