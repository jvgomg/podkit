#!/usr/bin/env bun
/**
 * Mark the selected substrate as provisioned: verify the contract, seal the
 * baseline hash into the guest, and — where the provisioner supports it — take
 * the provisioning snapshot.
 *
 * All three describe the same moment, which is why they are one command. A
 * snapshot without a matching sealed hash is a restore point nothing vouches
 * for, and `vm:recover` would have to treat it as unknown and recreate instead.
 *
 * The Lima harness seals as the last step of `harness:setup`; this is the same
 * step for a substrate this repo did not create.
 *
 * Exit codes: 0 sealed, 1 the contract failed or the seal could not be written.
 *
 * @module
 */

import {
  isSshVm,
  pveSealSnapshot,
  POST_PROVISION_SNAPSHOT,
  resolvePveLifecycle,
} from '@podkit/substrate';

import { resolveDeviceSubstrate } from '../src/runners/substrate.js';
import { runSubstrateDoctor } from '../src/runners/substrate-contract.js';
import { sealBaselineHash } from '../src/baseline-seal.js';

async function main(): Promise<number> {
  const { definition, link } = resolveDeviceSubstrate();

  // Seal only what passes. A hash sealed into a box that does not satisfy the
  // contract makes every later drift check vouch for a broken substrate.
  const doctor = await runSubstrateDoctor({ link });
  process.stdout.write(doctor.stdout);
  if (!doctor.ok) {
    process.stderr.write(doctor.stderr);
    process.stderr.write(
      `[harness:seal] '${definition.id}' does not satisfy the substrate contract, so nothing ` +
        `was sealed. Apply it first — see docs/environments/device-substrate-proxmox.md §5.\n`
    );
    return 1;
  }

  const { combinedSha, inputCount } = await sealBaselineHash(definition, link);
  process.stdout.write(
    `[harness:seal] sealed baseline hash (${combinedSha.slice(0, 12)}...; ${inputCount} inputs) ` +
      `into ${link.description}.\n`
  );

  if (!isSshVm(definition)) return 0;

  const resolved = resolvePveLifecycle(definition, process.env);
  if (!resolved.available) {
    process.stdout.write(
      `[harness:seal] no Proxmox lifecycle configured for '${definition.id}' ` +
        `(${resolved.reason}), so no provisioning snapshot was taken. \`vm:recover\` will ` +
        `recreate rather than roll back.\n`
    );
    return 0;
  }

  await pveSealSnapshot(resolved.binding, `podkit baseline ${combinedSha.slice(0, 12)}`);
  process.stdout.write(
    `[harness:seal] took provisioning snapshot '${POST_PROVISION_SNAPSHOT}' on VMID ` +
      `${resolved.binding.vmid}.\n`
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[harness:seal] ${msg}\n`);
    process.exit(1);
  });
