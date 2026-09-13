/**
 * @podkit/lima — the Lima provisioner.
 *
 * Owns the pure-Lima mechanics shared across the repo: the `limactl` wrapper,
 * every Lima VM config, idempotent lifecycle primitives, a single cross-process
 * advisory lock, generic in-VM transport, baseline-hash + drift, and the in-VM
 * docker-image build/pull.
 *
 * Two things are deliberately NOT here. Domain concerns (personas,
 * system-states, the FunctionFS daemon-gadget, the runtime factory) stay in
 * `@podkit/device-testing`, which consumes this package. And everything true of
 * a substrate regardless of who provisioned it — the registry, the provisioner
 * discriminator, substrate selection, the pinned image — lives in
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

// Instance status
export type { InstanceStatus } from './instance-status.js';
export { instanceStatus } from './instance-status.js';

// Host binary path resolvers
export {
  vmArch,
  resolveDefaultPodkitBinary,
  resolveDefaultPodkitDebugBinary,
  resolveDefaultDaemonLinuxBinary,
  resolveDefaultPodkitMuslBinary,
  resolveDefaultDaemonLinuxMuslBinary,
  resolveDefaultDummyHcdDaemonBinary,
  resolveDefaultGpodToolBinary,
} from './binary-paths.js';

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

// Generic transport
export type { RunInVmOpts, RunInVmResult, CopyOutOpts, StageSourceTreeOpts } from './transport.js';
export {
  runInVm,
  copyOut,
  stageSourceTree,
  DEFAULT_STAGE_EXCLUDES,
  FILE_COPY_TIMEOUT_MS,
} from './transport.js';

// VM-local staging destinations (one declared owner per directory)
export type { StagingArea } from './staging.js';
export {
  listStagingAreas,
  getStagingArea,
  stagingDestFor,
  findStagingCollision,
} from './staging.js';

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
