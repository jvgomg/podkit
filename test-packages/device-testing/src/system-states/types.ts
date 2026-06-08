/**
 * SystemState — a typed fixture describing a host-environment configuration
 * that affects `podkit doctor` system-scope checks.
 *
 * Schema mirrors ADR-017 §"SystemState schema". Unit mocks materialise a
 * state by injecting matching subprocess responses; VM tests apply it by
 * staging and running `apply-state.sh <id>` in the test VM.
 *
 * @see adr/adr-017-device-persona-fixtures.md
 * @module
 */

/**
 * Stable union of all registered `SystemState` ids.
 *
 * Kept in sync with `test-packages/device-testing/src/system-states/index.ts`. Used
 * by the state orchestrator (`lima-test-vm-state.ts`) and the in-VM
 * `apply-state.sh` script — both consume this exact set.
 */
export type SystemStateId =
  | 'healthy'
  | 'no-ffmpeg'
  | 'no-libgpod'
  | 'no-udev'
  | 'no-sg-perms'
  | 'corrupt-configfs'
  | 'device-mount-near-full'
  | 'device-mount-fits-estimate-failed-sweep'
  | 'device-mount-fits-estimate-source-drifts';

/**
 * Stable, registry-keyed fixture describing one host-environment state.
 */
export interface SystemState {
  /** Stable identifier (passed verbatim to `apply-state.sh` as `<stateId>`). */
  id: SystemStateId;
  description: string;
  /** Schema version; bump on any breaking field change. */
  schemaVersion: number;

  // --- Host environment ------------------------------------------------------

  /** FFmpeg availability + encoder coverage. */
  ffmpeg: 'present' | 'missing' | 'no-aac-encoder' | 'no-h264-encoder' | 'old-version';
  /** libgpod runtime availability. */
  libgpod: 'present' | 'missing';
  /** podkit udev rule install state. */
  udevRule: 'present' | 'missing' | 'wrong-path';
  /** Whether `/dev/sg*` is readable by the test user. */
  sgPermissions: 'group-readable' | 'denied';
  /** configfs mount state. */
  configfs: 'mounted' | 'unmounted' | 'corrupt';

  // --- Expected outcomes -----------------------------------------------------

  /** What doctor's system-scope checks must produce in this state. */
  expectedDoctorSystemOutput: {
    overallStatus: 'healthy' | 'warn' | 'fail';
    checks: Array<{
      id: string;
      /**
       * Status the check should report. `skip` is a real outcome for
       * checks whose dependency probe fails — e.g. `codec-encoders` /
       * `video-encoder` skip when FFmpeg is missing because the upstream
       * "FFmpeg" probe failure leaves nothing to inspect.
       */
      status: 'pass' | 'warn' | 'fail' | 'skip';
      summary?: string;
    }>;
  };
  /**
   * Exit code the doctor command should produce. `runSystemOnlyDoctor`
   * uses `0` for healthy and `2` for issues-found (warn or fail);
   * exit `1` is reserved for command-level errors (parse failure, missing
   * dependency, etc.) and is never emitted by a clean diagnostic run.
   */
  expectedExitCode: 0 | 1 | 2;
}
