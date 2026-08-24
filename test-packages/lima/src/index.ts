/**
 * @podkit/lima — the Lima VM substrate.
 *
 * Owns the pure-Lima mechanics shared across the repo: the `limactl` wrapper, a
 * typed VM registry, idempotent lifecycle primitives, a single cross-process
 * advisory lock, generic in-VM transport, baseline-hash + drift, and the
 * in-VM docker-image build/pull. Domain concerns (personas, system-states, the
 * FunctionFS daemon-gadget, the runtime factory) stay in `@podkit/device-testing`,
 * which consumes this package.
 *
 * Depends only on `@podkit/device-types` (never `@podkit/core`) so the substrate
 * never drags native bindings or metadata libraries.
 *
 * @module
 */

// limactl wrapper
export type { LimactlResult } from './limactl.js';
export { runLimactl, limactlError, shellQuote } from './limactl.js';

// Path anchoring
export { limaPackageRoot, repoRoot } from './paths.js';

// VM registry
export type { VmDefinition, VmCategory, VmArchRelevance } from './registry.js';
export { listVms, getVm, deviceVm, LIMA_DEVICE_HARNESS_VM_NAME } from './registry.js';

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
export { status, ensureExists, ensureRunning, stop, destroy, recover } from './lifecycle.js';

// Generic transport
export type { RunInVmOpts, RunInVmResult, CopyOutOpts, StageSourceTreeOpts } from './transport.js';
export { runInVm, copyOut, stageSourceTree, DEFAULT_STAGE_EXCLUDES } from './transport.js';

// VM-local staging destinations (one declared owner per directory)
export type { StagingArea } from './staging.js';
export {
  listStagingAreas,
  getStagingArea,
  stagingDestFor,
  findStagingCollision,
} from './staging.js';

// Output-streaming subprocess runners (live provisioning logs)
export type { StreamSink } from './streaming-runner.js';
export {
  createStreamingSubprocessRunner,
  createVmProvisioningRunner,
  streamsOutput,
} from './streaming-runner.js';

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
} from './docker-image.js';
