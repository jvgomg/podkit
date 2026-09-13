/**
 * @podkit/substrate — the provisioner-agnostic layer beneath the device harness.
 *
 * A *substrate* is the Linux environment the device harness drives: a kernel
 * with `dummy_hcd`, configfs and a systemd userland, reachable over SSH. A
 * *provisioner* is whatever produced it — Lima on a developer's Mac, Proxmox
 * plus cloud-init on a hypervisor, or a human with a spare box. This package
 * owns everything that is true regardless of which one you have: the registry,
 * the provisioner discriminator, substrate selection, and the pinned image.
 *
 * `@podkit/lima` is one provisioner and depends on this package; nothing here
 * may depend on it. The direction is the point — see ADR-029 §1, and the
 * vocabulary in `CONTEXT.md` §"Test environments".
 *
 * Deliberately dependency-free. It is imported by packages that bundle into
 * single-file binaries, so every path anchor it exposes is lazy; see the note
 * on `defineLimaVm` in `./registry.js`.
 *
 * @module
 */

// Path anchoring
export { substratePackageRoot, repoRoot } from './paths.js';

// Substrate registry + provisioner discriminator
export type {
  VmDefinition,
  LimaVmDefinition,
  SshVmDefinition,
  VmCategory,
  VmArchRelevance,
  VmProvisioner,
  LimaVmId,
} from './registry.js';
export {
  listVms,
  getVm,
  deviceVm,
  isLimaVm,
  isSshVm,
  LIMA_VM_IDS,
  LIMA_DEVICE_HARNESS_VM_NAME,
} from './registry.js';

// Substrate selection
export type {
  SubstrateSelection,
  SubstrateSelectionInput,
  SubstrateSelectionSource,
} from './selection.js';
export {
  resolveSubstrateSelection,
  selectSubstrate,
  commandOnPath,
  SubstrateSelectionError,
  SUBSTRATE_ENV_VAR,
} from './selection.js';

// The pinned Debian cloud image
export type { DebianImageArch } from './debian-image.js';
export {
  substrateDebianImageUrl,
  SUBSTRATE_DEBIAN_MAJOR,
  SUBSTRATE_DEBIAN_SUITE,
  SUBSTRATE_DEBIAN_POINT_RELEASE,
  SUBSTRATE_DEBIAN_IMAGE_SERIAL,
  DEBIAN_IMAGE_ARCHES,
  LIMA_ARCH_BY_DEBIAN_ARCH,
  PINNED_DEBIAN_IMAGE_VM_IDS,
  SUBSTRATE_CONTRACT_REL_PATH,
} from './debian-image.js';
