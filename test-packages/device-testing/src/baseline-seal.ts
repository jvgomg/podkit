/**
 * Sealing a substrate's baseline hash into the guest.
 *
 * The seal is the marker that says "this guest was provisioned from these
 * inputs". It must follow provisioning and nothing else — sealing after a mere
 * binary install would re-bless a box that was never re-provisioned, which is
 * the drift the seal exists to catch.
 *
 * Shared between the Lima harness and the remote seal command so the two
 * cannot write the value differently.
 *
 * @module
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { SubstrateLink, VmDefinition } from '@podkit/substrate';

import { installIntoSubstrate } from './runners/substrate-install.js';
import {
  BASELINE_VM_HASH_PATH,
  computeBaselineHash,
  substrateBaselineInputs,
} from './baseline-hash.js';

/** What was sealed. */
export interface SealedBaseline {
  readonly combinedSha: string;
  readonly inputCount: number;
}

/**
 * Compute the substrate's baseline hash and write it into the guest.
 *
 * The hash is BYTES, not a file, and the obvious shape — pipe it to a
 * guest-side `tee` — is the one thing a link deliberately cannot do: a
 * `limactl shell` does not reliably forward stdin, so an stdin channel would
 * work over ssh and half-work over Lima. A host temp file through the same
 * install path every other artefact uses costs one file and behaves the same
 * on both links.
 */
export async function sealBaselineHash(
  substrate: VmDefinition,
  link: SubstrateLink
): Promise<SealedBaseline> {
  const { combinedSha, files } = computeBaselineHash(substrateBaselineInputs(substrate));
  const hostTmp = path.join(os.tmpdir(), `podkit-baseline-${randomUUID()}`);
  fs.writeFileSync(hostTmp, `${combinedSha}\n`, 'utf8');
  try {
    await installIntoSubstrate({
      link,
      hostPath: hostTmp,
      guestPath: BASELINE_VM_HASH_PATH,
      stagePath: `/tmp/podkit-baseline-${randomUUID()}`,
      mode: '0644',
      createParents: true,
      label: 'baseline hash',
    });
  } finally {
    try {
      fs.unlinkSync(hostTmp);
    } catch {
      // Best-effort: a stuck file in the host tmpdir does no harm.
    }
  }
  return { combinedSha, inputCount: files.length };
}
