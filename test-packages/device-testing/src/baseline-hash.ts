/**
 * Which provisioning inputs a substrate is pinned to.
 *
 * The hashing primitive lives in `@podkit/lima`; this module adds the
 * composition, because the inputs span packages and only this one can name the
 * full list.
 *
 * The list is per substrate. A Lima guest is declared by its YAML and a Proxmox
 * guest by the cloud-init template; one shared list would report a Lima box as
 * drifted over a hypervisor template it has never seen.
 *
 * @module
 */

import * as path from 'node:path';

import { isLimaVm, SUBSTRATE_IMAGE_PIN, type VmDefinition } from '@podkit/substrate';
import { deviceVm, type TrackedBaselineInput } from '@podkit/lima';

import { devTestingPackageRoot } from './runners/paths.js';

export type {
  TrackedBaselineFile,
  TrackedBaselineValue,
  TrackedBaselineInput,
  BaselineFileEntry,
  BaselineHashResult,
} from '@podkit/lima';
export { computeBaselineHash, BASELINE_VM_HASH_PATH } from '@podkit/lima';

/** Package-relative location of the Proxmox cloud-init template. */
export const CLOUD_INIT_TEMPLATE_REL_PATH = 'substrate/proxmox/cloud-init.user-data.yaml';

/**
 * A substrate's tracked provisioning inputs, in the order they are folded into
 * the combined hash. Order is significant; append at the END.
 *
 * Paths resolve inside the function body, never at module load: this package's
 * modules get bundled into the single-file FunctionFS daemon, whose
 * `/$bunfs/root/…` paths carry no source-tree marker to anchor on.
 */
export function substrateBaselineInputs(substrate: VmDefinition): readonly TrackedBaselineInput[] {
  const root = devTestingPackageRoot();
  const scriptsDir = path.join(root, 'scripts');

  // Whatever declares the guest before the contract scripts run. One per
  // provisioner, and a substrate has exactly one.
  const declaration = isLimaVm(substrate)
    ? substrate.yamlPath
    : path.join(root, CLOUD_INIT_TEMPLATE_REL_PATH);

  const files = [
    declaration,
    path.join(scriptsDir, 'apply-state.sh'),
    // The contract. These matter more than the declaration does: it only
    // produces a plain Debian box, while these three are what make it a
    // substrate.
    path.join(scriptsDir, 'substrate-contract.sh'),
    path.join(scriptsDir, 'provision-substrate.sh'),
    path.join(scriptsDir, 'substrate-doctor.sh'),
  ];

  return [
    // Labels are basenames, so a rename cannot leave the hash naming a file
    // that no longer exists. Relies on the basenames being distinct.
    ...files.map((absPath) => ({ label: path.basename(absPath), absPath })),
    // The image pin is a TypeScript constant, so the value is tracked rather
    // than the module that declares it.
    { label: 'debian-image-pin', value: SUBSTRATE_IMAGE_PIN },
  ];
}

/** The Lima device-synthesis harness's inputs. */
export function deviceBaselineFiles(): readonly TrackedBaselineInput[] {
  return substrateBaselineInputs(deviceVm());
}
