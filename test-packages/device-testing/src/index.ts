/**
 * @podkit/device-testing — fixture registries + test runtime harness
 *
 * Provides:
 *
 * - `DevicePersona` schema and registry (`personas`)
 * - `SystemState` schema and registry (`systemStates`)
 * - `TestRuntime` interface + the `local-linux` runner
 * - Runner registry (`registerRunner` / `getRunner` / `listRunners`)
 * - `SubprocessRunner` interface + a default real-subprocess implementation
 *
 * Importing this module auto-registers the `local-linux` runner so consumers
 * do not need to wire it themselves.
 *
 * @see adr/adr-016-linux-vm-test-harness.md
 * @see adr/adr-017-device-persona-fixtures.md
 * @module
 */

import { localLinuxRunner } from './runners/local-linux.js';
import { limaTestVmRunner } from './runners/lima-test-vm.js';
import { registerRunner } from './runners/registry.js';

// Personas
export type { DevicePersona } from './personas/types.js';
export {
  personas,
  ipodMini2gPink,
  ipodNano3gBlack,
  ipodNano4gBlack,
  ipodNano2gGreen,
  ipodNano7gBlue,
  ipodNano7gSpaceGray,
  ipodNano4gHfsplus,
  ipodVideo5gIflash1tb,
  ipodTouch5gUnsupported,
  echoMini,
  sonyNwzE384,
  sonyNwA1000,
  sonyNwA3000,
  sonyNwA1200,
  sonyNwHd5,
  ipodShuffleNotSupported,
  nonIpodUsbDisk,
  malformedSysinfo,
  ipodVideo5gCorruptDb,
  corruptItunesDb,
  echoMiniPopulated,
  ipod5gModelnumMismatch,
  ipod5gStaleGuid,
  ipod5gVideoMbrPart,
} from './personas/index.js';
export { buildEnumeratedUsbDevice } from './personas/builders.js';

// Persona sidecar (JSON serialisation consumed by the FunctionFS daemon)
export type {
  PersonaSidecarV1,
  SidecarPersona,
  SidecarUsbDescriptor,
  SidecarMassStorageBackingFile,
} from './personas/sidecar.js';
export {
  SIDECAR_SCHEMA_VERSION,
  serializeSidecar,
  parseSidecar,
  parseHexId,
  toHex16,
} from './personas/sidecar.js';
export { buildSidecar, toSidecarPersona } from './personas/sidecar-build.js';

// System states
export type { SystemState, SystemStateId } from './system-states/types.js';
export {
  systemStates,
  healthy,
  noFfmpeg,
  noLibgpod,
  noUdev,
  noSgPerms,
  corruptConfigfs,
  deviceMountNearFull,
  DEVICE_MOUNT_NEAR_FULL_PATH,
  deviceMountFitsEstimateFailedSweep,
  DEVICE_MOUNT_FITS_ESTIMATE_FAILED_SWEEP_PATH,
  deviceMountFitsEstimateSourceDrifts,
  DEVICE_MOUNT_FITS_ESTIMATE_SOURCE_DRIFTS_PATH,
} from './system-states/index.js';

// Runtime
export type { RunnerId, RunOpts, RunResult, TestRuntime } from './runtime.js';

// Runners
export { localLinuxRunner } from './runners/local-linux.js';
export { registerRunner, getRunner, listRunners } from './runners/registry.js';

// Lima test-VM binary transfer (TASK-322.03)
export type { TransferBinaryOpts, TransferBinaryResult } from './runners/lima-test-vm-binary.js';
export {
  transferBinary,
  transferGpodTool,
  DEFAULT_PODKIT_VM_PATH,
  DEFAULT_PODKIT_DEBUG_VM_PATH,
  DEFAULT_GPOD_TOOL_VM_PATH,
} from './runners/lima-test-vm-binary.js';

// Lima test-VM systemd unit installer (TASK-322.04.01)
export type {
  TransferSystemdUnitOpts,
  TransferSystemdUnitResult,
} from './runners/lima-test-vm-systemd.js';
export {
  transferSystemdUnit,
  resolveDefaultDummyHcdDaemonUnit,
  DEFAULT_DUMMY_HCD_DAEMON_UNIT_VM_PATH,
} from './runners/lima-test-vm-systemd.js';

// Lima test-VM state orchestration
export type { ApplyStateOpts } from './runners/lima-test-vm-state.js';
export { applyState } from './runners/lima-test-vm-state.js';

// Lima test-VM TestRuntime (TASK-322.04)
export type {
  CreateLimaTestVmRuntimeOpts,
  EnsurePersonaSidecarOpts,
  EnsurePersonaSidecarResult,
  StageBackingFileOpts,
  ResetBackingFileOpts,
  StartDaemonOpts,
  StopDaemonOpts,
} from './runners/lima-test-vm.js';
export {
  limaTestVmRunner,
  createLimaTestVmRuntime,
  ensurePersonaSidecar,
  stageBackingFile,
  resetBackingFile,
  startDaemonForPersona,
  stopDaemon,
  instanceStatus,
  resolveDefaultPodkitBinary,
  resolveDefaultPodkitDebugBinary,
  resolveDefaultDaemonLinuxBinary,
  resolveDefaultPodkitMuslBinary,
  resolveDefaultDaemonLinuxMuslBinary,
  resolveDefaultDummyHcdDaemonBinary,
  resolveDefaultGpodToolBinary,
  LIMA_DEVICE_HARNESS_VM_NAME,
  SIDECAR_VM_PATH,
  DEFAULT_DUMMY_HCD_DAEMON_VM_PATH,
} from './runners/lima-test-vm.js';

// Lima docker-image build (Tier-5 Docker scaffold)
export type {
  BuildPodkitImageInVmOpts,
  BuildPodkitImageInVmResult,
} from './runners/lima-docker-image.js';
export {
  buildPodkitImageInVm,
  DEFAULT_PODKIT_IMAGE_TAG,
  BUILD_CONTEXT_VM_DIR,
} from './runners/lima-docker-image.js';

// Mass-storage backing-file synthesis (TASK-348)
export type {
  EnsureBackingFileOpts,
  EnsureBackingFileResult,
  EnsureBackingFilesForPersonasOpts,
} from './runners/lima-test-vm-backing-files.js';
export {
  ensureBackingFile,
  ensureBackingFilesForPersonas,
  vmPathForPersona,
  BACKING_FILES_VM_DIR,
} from './runners/lima-test-vm-backing-files.js';

// local-linux runner constants (TASK-322.04)
export { LOCAL_MUTATE_ENV } from './runners/local-linux.js';

// Subprocess runner (re-exports for tests)
export type { SubprocessRunner, SubprocessRunOpts, SubprocessRunResult } from './subprocess.js';
export { defaultSubprocessRunner } from './subprocess.js';

// ---------------------------------------------------------------------------
// VM test helpers (used by @podkit/e2e-vm-tests)
//
// These symbols live in `src/vm/` because they're harness infrastructure: the
// VM availability gate, persona-state grouping, the per-persona daemon
// lifecycle fixture, and the wall-time budgets. Consumers (the
// @podkit/e2e-vm-tests package, plus the harness's own self-tests) import
// them from here so the relative path into `src/vm/` stays an internal
// detail of this package.
// ---------------------------------------------------------------------------

export type { PersonaStateGroup } from './vm/vm-runtime-setup.js';
export {
  STARTER_PERSONA_IDS,
  resolveStarterPersonas,
  resolveSystemStateForPersona,
  hasDaemonPayload,
  groupPersonasByState,
  resetVmPersonaSkipWarnings,
  formatPersonaSkipWarning,
  VM_WARM_TIMEOUT_MS,
  VM_COLD_TIMEOUT_MS,
} from './vm/vm-runtime-setup.js';

export type { WithPersonaOpts, CliInvocation } from './vm/persona-fixture.js';
export {
  withPersona,
  waitForScsiGenericEnumeration,
  runJsonCommand,
} from './vm/persona-fixture.js';

export type {
  MountPersonaOpts,
  UnmountAndStopOpts,
  PersonaDeviceNodes,
  ResolvePersonaDeviceNodesOpts,
} from './vm/mount-persona.js';
export {
  buildScsiSdDiscoveryScript,
  buildDeviceNodeDiscoveryScript,
  resolvePersonaDeviceNodes,
  mountPersona,
  unmountAndStop,
} from './vm/mount-persona.js';

// Auto-register built-in runners on first import.
registerRunner(localLinuxRunner);
registerRunner(limaTestVmRunner);
