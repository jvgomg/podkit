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

// `.env.local`, located from the repo root rather than from the working
// directory — see ./env-file.ts.
export { loadRepoEnvFile, envWithRepoDotfile } from './env-file.js';

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
  SubstrateLinkOperation,
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
  FILE_COPY_TIMEOUT_MS,
  guestCommandError,
  settleLinkResult,
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

// Staging a source tree onto a substrate — the exclude floor and the rsync
// mechanics both links share
export type { StageTreeOpts } from './stage-tree.js';
export {
  DEFAULT_STAGE_EXCLUDES,
  RSYNC_VANISHED_EXIT,
  stageExcludes,
  rsyncStageArgs,
  guestStageScript,
  hostRsyncArgs,
  stageExitIsOk,
} from './stage-tree.js';

// Guest-local staging destinations (one declared owner per directory)
export type { StagingArea, BuildJobId } from './staging-areas.js';
export {
  listStagingAreas,
  getStagingArea,
  stagingDestFor,
  stagingDestForJob,
  findStagingCollision,
  BUILD_JOB_IDS,
} from './staging-areas.js';

// The SSH link implementation (every substrate not reached through limactl)
export type { CreateSshLinkOpts } from './link-ssh.js';
export { createSshLink } from './link-ssh.js';

// Reading a shell contract's values from TypeScript
export { readShellContract, shellContractValue, shellContractList } from './shell-contract.js';

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

// Build-host selection — WHERE artifacts are built
export type {
  BuildHostSelection,
  BuildHostSelectionSource,
  BuildLibc,
  ResolveBuildHostInput,
  SelectBuildHostOpts,
} from './build-host.js';
export {
  resolveBuildHostSelection,
  selectBuildHost,
  BuildHostSelectionError,
  BUILD_HOST_ENV_VAR,
} from './build-host.js';

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
  envForTargetArch,
  TargetArchError,
  TARGET_ARCH_ENV_VAR,
} from './target-arch.js';

// Which architectures one run must produce — not just the one it targets
export type {
  ArchConsumer,
  ArchRequirement,
  ResolveRequiredArchesInput,
} from './required-arches.js';
export { resolveRequiredArches, requiredArches, HOST_ARCH_ENV_VAR } from './required-arches.js';

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
  resolveDefaultPodkitDebugMuslBinary,
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

// The remote advisory lock — held IN the substrate, so it sees other machines
export type { RemoteLockHolder, AcquireRemoteLockOpts, RemoteLockRelease } from './remote-lock.js';
export {
  acquireRemoteLock,
  releaseRemoteLock,
  forceReleaseRemoteLock,
  readRemoteLockHolder,
  withRemoteLock,
  parseRemoteLockHolder,
  describeRemoteLockHolder,
  RemoteLockBusyError,
  REMOTE_LOCK_PATH,
  DEFAULT_REMOTE_LOCK_TIMEOUT_MS,
  DEFAULT_REMOTE_LOCK_POLL_MS,
} from './remote-lock.js';

// Proxmox VE — configuration, API client, and lifecycle for an `ssh` substrate
export type { PveConfig, PveConfigResolution } from './pve/config.js';
export {
  resolvePveConfig,
  resolvePveVmid,
  pveVmidEnvVar,
  PveConfigError,
  PVE_API_URL_ENV,
  PVE_TOKEN_ID_ENV,
  PVE_TOKEN_SECRET_ENV,
  PVE_TLS_FINGERPRINT_ENV,
  PVE_POOL_ENV,
  PVE_STORAGE_ENV,
  PVE_BRIDGE_ENV,
  DEFAULT_PVE_POOL,
  DEFAULT_PVE_BRIDGE,
} from './pve/config.js';

export type { PveDeniedPrivilege, PveApiFailure } from './pve/errors.js';
export { PveApiError, pveApiError, parseDeniedPrivilege, isPveApiError } from './pve/errors.js';

export type { ProbedCertificate, ProbeCertificateFn } from './pve/tls.js';
export {
  normalizeFingerprint,
  sniFor,
  verifyPinnedCertificate,
  createPinnedFetch,
  probeCertificateOverTls,
  PveTlsPinError,
  PveTlsFingerprintFormatError,
} from './pve/tls.js';

export type {
  PveClient,
  PveGuest,
  PveGuestStatus,
  PveSnapshot,
  CreateGuestSpec,
  CreatePveClientOpts,
} from './pve/client.js';
export {
  createPveClient,
  PveUnreachableError,
  PveTaskError,
  PveApiMissingGuest,
} from './pve/client.js';

export type { QmVerb, QmContext, ManualNoticeInput } from './pve/qm.js';
export { manualQmEquivalent, manualLifecycleNotice, QM_VERB_FOR_CLI_VERB } from './pve/qm.js';

export type {
  PveBinding,
  PveLifecycleResolution,
  PveUnavailableReason,
  RecoveryStrategy,
  TemplateHashVerdict,
  ChooseRecoveryInput,
  PveRecoverOpts,
  PveRecoverResult,
  ReportFn,
} from './pve/lifecycle.js';
export {
  resolvePveLifecycle,
  qmContextFor,
  guestSpecFor,
  pveStatus,
  pveEnsureRunning,
  pveStop,
  pveDestroy,
  pveSealSnapshot,
  pveRecover,
  chooseRecoveryStrategy,
  PveCreateFailedError,
  POST_PROVISION_SNAPSHOT,
} from './pve/lifecycle.js';

// The pinned image as a PVE host path + the pin as a baseline input
export {
  PVE_IMAGE_DIR,
  substrateDebianImageFile,
  pveDebianImagePath,
  SUBSTRATE_IMAGE_PIN,
} from './debian-image.js';

// Holding a substrate for the duration of a run
export type { RunLockOutcome, AcquireRunLockOpts } from './run-lock.js';
export { acquireRunLock } from './run-lock.js';
