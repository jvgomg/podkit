/**
 * SystemState — a typed fixture describing a host-environment configuration
 * that affects `podkit doctor` system-scope checks.
 *
 * Schema mirrors ADR-017 §"SystemState schema". Tier 1 mocks materialise a
 * state by injecting matching subprocess responses; Tier 3 applies it via a
 * VM snapshot named `base-${id}`.
 *
 * @see adr/adr-017-device-persona-fixtures.md
 * @module
 */

/**
 * Stable, registry-keyed fixture describing one host-environment state.
 */
export interface SystemState {
  /** Stable identifier (used as the QEMU snapshot name `base-${id}`). */
  id: string;
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
      status: 'pass' | 'warn' | 'fail';
      summary?: string;
    }>;
  };
  /** Exit code the doctor command should produce (per TASK-308). */
  expectedExitCode: 0 | 1 | 2;
}
