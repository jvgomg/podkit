#!/usr/bin/env bun
/**
 * Baseline-drift preflight for the selected device substrate.
 *
 * Hashes the host-side provisioning inputs and compares them to the hash
 * `harness:setup` sealed inside the guest. A mismatch means the running guest
 * was provisioned from a different version of those inputs than the one on
 * disk, so the next test run observes state the source no longer describes.
 *
 * Exit codes:
 *   0  hashes match, or there is no guest to check yet (`harness:setup` will
 *      create it and seal the hash).
 *   1  drift detected, or a probe failed in a way that prevents an answer.
 *
 * It deliberately does NOT rebuild anything. Rebuilding takes minutes, and an
 * explicit error naming the remediation beats silent disruption — so the
 * remediation is named, and it differs by provisioner.
 *
 * @see docs/architecture/testing/vm-build-orchestration.md
 * @module
 */

import { isLimaVm, type VmDefinition } from '@podkit/substrate';

import { instanceStatus } from '../src/runners/lima-test-vm.js';
import { createSubstrateLink, resolveDeviceSubstrate } from '../src/runners/substrate.js';
import {
  computeBaselineHash,
  substrateBaselineInputs,
  BASELINE_VM_HASH_PATH,
} from '../src/baseline-hash.js';

/**
 * The way out, named for the substrate in front of the reader.
 *
 * Provisioning is post-boot and idempotent, so re-applying the contract fixes a
 * merely-drifted box. Recreating is for a wedged one — and on a Proxmox guest
 * that is a single verb, which is most of why the API lifecycle exists.
 */
function remediation(substrate: VmDefinition, reason: string): string {
  const reapply = isLimaVm(substrate)
    ? '  bun run harness:setup'
    : '  # apply the contract (docs/environments/device-substrate-proxmox.md §5), then:\n' +
      '  bun run harness:seal';
  const recreate = isLimaVm(substrate)
    ? [`  bun run vm:destroy ${substrate.id} --yes && bun run harness:setup`]
    : [
        `  bun run vm:recover ${substrate.id}`,
        '',
        'That rolls back to the provisioning snapshot when the committed inputs still',
        'match, and recreates the guest when they do not — which is this case, so',
        'expect a recreate. Re-apply the contract and re-seal afterwards.',
      ];
  return [
    `[vm:doctor] ${reason}`,
    '',
    'To re-apply the current source-of-truth files and re-seal:',
    reapply,
    '',
    `If '${substrate.id}' is wedged rather than merely drifted, recreate it:`,
    ...recreate,
    '',
    'Skipping this check leaves VM tests observing a substrate whose',
    'provisioning does not match the contract scripts on disk.',
    '',
  ].join('\n');
}

async function main(): Promise<number> {
  const substrate = resolveDeviceSubstrate().definition;

  // 0. Only a substrate that seals a hash has drift to report. Say that
  //    plainly rather than reporting a missing Lima instance to someone who
  //    never asked for one.
  if (!substrate.trackedForBaseline) {
    process.stdout.write(
      `[vm:doctor] substrate '${substrate.id}' is not baseline-tracked — no drift to check.\n` +
        `[vm:doctor] Its provisioning is asserted by \`substrate-doctor.sh\` instead ` +
        `(docs/environments/device-substrate-proxmox.md).\n`
    );
    return 0;
  }

  // 1. A guest that does not exist yet is the harness's concern: `harness:setup`
  //    creates it and seals the hash, and gives a better error than this can.
  if (isLimaVm(substrate)) {
    const status = await instanceStatus().catch(() => 'missing' as const);
    if (status === 'missing') {
      process.stdout.write(
        `[vm:doctor] Lima instance \`${substrate.instanceName}\` is missing — no drift to check.\n` +
          `[vm:doctor] Run \`bun run harness:setup\` to create it.\n`
      );
      return 0;
    }
    if (status === 'stopped') {
      process.stderr.write(
        `[vm:doctor] Lima instance \`${substrate.instanceName}\` is stopped — cannot check drift.\n` +
          `[vm:doctor] Run \`bun run vm:up ${substrate.id}\` first.\n`
      );
      return 1;
    }
  }

  // 2. Hash the host-side inputs for THIS substrate. A Lima guest and a
  //    Proxmox guest are declared by different files, so the lists differ.
  const { combinedSha, files } = computeBaselineHash(substrateBaselineInputs(substrate));

  // 3. Read the sealed hash. Absence is drift: the guest exists but was never
  //    sealed, so nothing vouches for how it was provisioned.
  const link = createSubstrateLink(substrate);
  const probe = await link
    .exec(['sh', '-c', `cat ${BASELINE_VM_HASH_PATH} 2>/dev/null || true`])
    .catch((err: unknown) => ({ exitCode: 1, stdout: '', stderr: String(err) }));

  if (probe.exitCode !== 0) {
    process.stderr.write(
      remediation(
        substrate,
        `failed to probe ${link.description} for a baseline hash at ${BASELINE_VM_HASH_PATH}: ` +
          `${probe.stderr.trim() || 'unknown error'}`
      )
    );
    return 1;
  }

  const vmHash = probe.stdout.trim();

  if (!vmHash) {
    process.stderr.write(
      remediation(
        substrate,
        `${link.description} has no baseline hash at ${BASELINE_VM_HASH_PATH}. ` +
          `It was provisioned by hand, or before this check shipped. Seal it.`
      )
    );
    return 1;
  }

  if (vmHash !== combinedSha) {
    const driftedNames = files.map((f) => `  - ${f.label}`).join('\n');
    process.stderr.write(
      remediation(
        substrate,
        `substrate '${substrate.id}' drifted from the committed provisioning inputs.\n` +
          `\n` +
          `Guest hash: ${vmHash}\n` +
          `Host hash:  ${combinedSha}\n` +
          `\n` +
          `Tracked inputs (one of these or their composition changed):\n` +
          `${driftedNames}`
      )
    );
    return 1;
  }

  process.stdout.write(
    `[vm:doctor] baseline OK (${vmHash.slice(0, 12)}...; ${files.length} inputs tracked).\n`
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[vm:doctor] unexpected error: ${msg}\n`);
    process.exit(1);
  });
