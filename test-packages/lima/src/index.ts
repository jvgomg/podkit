/**
 * @podkit/lima — the Lima provisioner.
 *
 * Owns the pure-Lima mechanics shared across the repo: the `limactl` wrapper,
 * every Lima VM config, idempotent lifecycle primitives, a single cross-process
 * advisory lock, the VM-shaped link adapters, baseline-hash + drift, and the in-VM
 * docker-image build/pull.
 *
 * Two things are deliberately NOT here. Domain concerns (personas,
 * system-states, the FunctionFS daemon-gadget, the runtime factory) stay in
 * `@podkit/device-testing`, which consumes this package. And everything true of
 * a substrate regardless of who provisioned it — the registry, the provisioner
 * discriminator, substrate selection, the link interface + its SSH
 * implementation, and the pinned image — lives in
 * `@podkit/substrate`, which this package consumes. Lima is one provisioner,
 * not the substrate itself; conflating the two is what tied the harness to
 * macOS (ADR-029 §1).
 *
 * Depends only on `@podkit/device-types` and `@podkit/substrate` (never
 * `@podkit/core`) so a build script never drags native bindings or metadata
 * libraries in behind it.
 *
 * @module
 */

// limactl wrapper
export type { LimactlResult, RunLimactlOpts } from './limactl.js';
export { runLimactl, limactlError, shellQuote } from './limactl.js';

// Path anchoring. `limaPackageRoot` is this package's own; `repoRoot` belongs
// to `@podkit/substrate` and is re-exported through `./paths.js`.
export { limaPackageRoot, repoRoot } from './paths.js';

// VM registry. It lives in `@podkit/substrate` now — a registry that can
// describe an SSH-reachable Debian box is not a Lima concern (ADR-029 §1) — and
// is re-exported here so this package's existing consumers resolve unchanged.
// New code should import it from `@podkit/substrate` directly.
export type {
  VmDefinition,
  LimaVmDefinition,
  SshVmDefinition,
  VmCategory,
  VmArchRelevance,
  VmProvisioner,
  LimaVmId,
} from '@podkit/substrate';
export {
  listVms,
  getVm,
  deviceVm,
  isLimaVm,
  isSshVm,
  LIMA_VM_IDS,
  LIMA_DEVICE_HARNESS_VM_NAME,
} from '@podkit/substrate';

// The limactl substrate link. The interface, the SSH implementation and the
// selection resolver belong to `@podkit/substrate`; what lives here is the one
// thing that is genuinely Lima's — how to reach a box Lima provisioned
// (ADR-028 §3).
export type { LimaSubstrateTarget, CreateLimactlLinkOpts } from './link.js';
export { createLimactlLink } from './link.js';

// Instance status
export type { InstanceStatus } from './instance-status.js';
export { instanceStatus } from './instance-status.js';

// Host binary path resolvers. They moved to `@podkit/substrate` along with
// the registry and for the same reason: the architecture in every one of these
// filenames is a property of the substrate the artifact has to start on, not
// of the provisioner that produced the box (ADR-029 §4). The `vmArch()` they
// used to derive that suffix from `process.arch` is gone — `targetArch()`
// replaces it, and is exported from `@podkit/substrate` directly. Re-exported
// here so this package's existing consumers resolve unchanged; new code should
// import from `@podkit/substrate`.
export {
  resolveDefaultPodkitBinary,
  resolveDefaultPodkitDebugBinary,
  resolveDefaultDaemonLinuxBinary,
  resolveDefaultPodkitMuslBinary,
  resolveDefaultPodkitDebugMuslBinary,
  resolveDefaultDaemonLinuxMuslBinary,
  resolveDefaultDummyHcdDaemonBinary,
  resolveDefaultGpodToolBinary,
} from '@podkit/substrate';

// Advisory lock
export type { VmLockOptions, ReleaseFn } from './lock.js';
export {
  acquireVmLock,
  isVmLocked,
  withVmLock,
  lockPathFor,
  DEFAULT_STALE_MS,
  DEFAULT_UPDATE_MS,
  DEFAULT_RETRIES,
  lockRetryBudgetMs,
} from './lock.js';

// Lifecycle primitives
export type { LifecycleOpts, RecoverOpts } from './lifecycle.js';
export {
  status,
  ensureExists,
  ensureRunning,
  stop,
  destroy,
  recover,
  STOP_TIMEOUT_MS,
  DESTROY_TIMEOUT_MS,
  WARM_START_TIMEOUT_MS,
} from './lifecycle.js';

// VM-shaped adapters over the limactl link
export type {
  RunInVmOpts,
  RunInVmResult,
  CopyOutOpts,
  StageSourceTreeOpts,
} from './link-adapters.js';
export {
  runInVm,
  copyOut,
  stageSourceTree,
  DEFAULT_STAGE_EXCLUDES,
  FILE_COPY_TIMEOUT_MS,
} from './link-adapters.js';

// Guest-local staging destinations (one declared owner per directory). They
// moved to `@podkit/substrate` when a remote builder gained directories Lima
// never created; re-exported here so existing consumers resolve unchanged.
export type { StagingArea, BuildJobId } from '@podkit/substrate';
export {
  listStagingAreas,
  getStagingArea,
  stagingDestFor,
  stagingDestForJob,
  findStagingCollision,
  BUILD_JOB_IDS,
} from '@podkit/substrate';

// Output-streaming subprocess runners (live provisioning logs + liveness bound)
export type {
  StreamSink,
  StreamingRunnerOptions,
  VmProvisioningRunnerOptions,
} from './streaming-runner.js';
export {
  createStreamingSubprocessRunner,
  createVmProvisioningRunner,
  streamsOutput,
  DEFAULT_KILL_GRACE_MS,
  PROVISIONING_KILL_GRACE_MS,
  PROVISIONING_IDLE_TIMEOUT_MS,
} from './streaming-runner.js';

// Elapsed-time progress reporting for long-running invocations
export type { ProgressReport, HeartbeatOpts, HeartbeatHandle } from './progress.js';
export { startHeartbeat, formatElapsed, DEFAULT_HEARTBEAT_MS } from './progress.js';

// Baseline hash + drift
export type {
  TrackedBaselineFile,
  TrackedBaselineValue,
  TrackedBaselineInput,
  BaselineFileEntry,
  BaselineHashResult,
} from './baseline-hash.js';
export { computeBaselineHash, BASELINE_VM_HASH_PATH } from './baseline-hash.js';

// In-VM docker-image build/pull
export type {
  BuildPodkitImageInVmOpts,
  BuildPodkitImageInVmResult,
  PullPodkitImageInVmOpts,
  EnsurePodkitImageInVmOpts,
} from './docker-image.js';
export {
  buildPodkitImageInVm,
  pullPodkitImageInVm,
  ensurePodkitImageInVm,
  DEFAULT_PODKIT_IMAGE_TAG,
  DOCKER_DIST_IMAGE_ENV,
  BUILD_CONTEXT_VM_DIR,
  VM_HOUSEKEEPING_TIMEOUT_MS,
  IMAGE_PRUNE_TIMEOUT_MS,
} from './docker-image.js';

// The `podkit-vm` CLI itself, for the one caller that has to compose with it
// rather than shell out: `vm:recover` needs a baseline hash this package
// cannot compute (see `scripts/vm-recover.ts` in `@podkit/device-testing`).
export { main as runPodkitVm } from './cli.js';
