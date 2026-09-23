/**
 * @podkit/substrate — the provisioner-agnostic layer beneath the device harness.
 *
 * A *substrate* is the Linux environment the device harness drives: a kernel
 * with `dummy_hcd`, configfs and a systemd userland, reachable over SSH. A
 * *provisioner* is whatever produced it — Lima on a developer's Mac, Proxmox
 * plus cloud-init on a hypervisor, or a human with a spare box. This package
 * owns everything that is true regardless of which one you have: the registry,
 * the provisioner discriminator, substrate selection, the substrate link, the
 * pinned image, the target architecture artifacts are built for, and the
 * host-side paths those artifacts live at.
 *
 * `@podkit/lima` is one provisioner and depends on this package; nothing here
 * may depend on it. The direction is the point — see ADR-029 §1, and the
 * vocabulary in `CONTEXT.md` §"Test environments".
 *
 * Depends only on `@podkit/device-types` — the dependency root the
 * `SubprocessRunner` seam lives in. It is imported by packages that bundle into
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

// The substrate link — how commands and files reach a substrate
export type {
  SubstrateLink,
  SubstrateCommand,
  SubstrateExecOpts,
  SubstrateExecResult,
  SubstrateCopyOpts,
  SubstrateSpawnOpts,
  SubstrateProcess,
  SubstrateExitStatus,
} from './link.js';
export {
  SubstrateLinkError,
  guestCommandError,
  isSubstrateLinkError,
  isTimeoutRejection,
  looksLikeSshLinkFailure,
  looksLikeLinkFailureResult,
  shellQuote,
  wrapGuestCommand,
  resolveGuestArgv,
  describeGuestCommand,
} from './link.js';
export type { HostSpawnFn } from './link-spawn.js';
export { startHostLinkProcess } from './link-spawn.js';

// The SSH link implementation (every substrate not reached through limactl)
export type { CreateSshLinkOpts } from './link-ssh.js';
export { createSshLink } from './link-ssh.js';

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

// Target architecture — what artifacts are built FOR
export type {
  TargetArch,
  TargetArchSource,
  TargetArchResolution,
  ResolveTargetArchInput,
  PrimeTargetArchOpts,
} from './target-arch.js';
export {
  targetArch,
  hostTargetArch,
  normalizeTargetArch,
  resolveTargetArch,
  probeSubstrateMachine,
  primeTargetArchFromSubstrate,
  TargetArchError,
  TARGET_ARCH_ENV_VAR,
} from './target-arch.js';

// Artifact-vs-substrate architecture assertion (the transfer-time backstop)
export type { AssertArtifactArchInput } from './artifact-arch.js';
export {
  assertArtifactArch,
  readElfTargetArch,
  ArtifactArchMismatchError,
} from './artifact-arch.js';

// Host-side artifact path resolvers
export {
  resolveDefaultPodkitBinary,
  resolveDefaultPodkitDebugBinary,
  resolveDefaultDaemonLinuxBinary,
  resolveDefaultPodkitMuslBinary,
  resolveDefaultDaemonLinuxMuslBinary,
  resolveDefaultDummyHcdDaemonBinary,
  resolveDefaultGpodToolBinary,
} from './binary-paths.js';

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
  BUILDER_CONTRACT_REL_PATH,
} from './debian-image.js';
