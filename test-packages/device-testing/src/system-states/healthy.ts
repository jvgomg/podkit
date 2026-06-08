/**
 * `healthy` system state — all required host tools and permissions present.
 *
 * Baseline state. Every system-scope doctor check passes EXCEPT
 * `inquiry-methods`, which warns with `'no /dev/sg* nodes'` on the
 * device-harness VM. The VM has the `sg` kernel module loaded but no
 * physical SCSI generic devices attached (no real iPod / no dummy
 * scsi_generic node), so the check correctly reports "no /dev/sg*" rather
 * than the "/dev/sg* present" path. Real podkit users on a host with an
 * iPod plugged in observe the pass status; the warn here is an
 * environment property of the headless harness, not a regression.
 *
 * Used as the control state against which failing states are compared.
 *
 * @see adr/adr-017-device-persona-fixtures.md §"SystemState schema"
 * @see test-packages/e2e-vm-tests/src/system-state-cross-check.e2e.test.ts
 * @module
 */

import type { SystemState } from './types.js';

export const healthy: SystemState = {
  id: 'healthy',
  description: 'All required host tools and permissions are present; baseline healthy state.',
  schemaVersion: 1,

  ffmpeg: 'present',
  libgpod: 'present',
  udevRule: 'present',
  sgPermissions: 'group-readable',
  configfs: 'mounted',

  expectedDoctorSystemOutput: {
    // `warn` (not `healthy`) because `inquiry-methods` warns on the
    // device-harness VM — no /dev/sg* nodes are present without a real
    // iPod attached. See module-level comment.
    overallStatus: 'warn',
    checks: [
      {
        id: 'codec-encoders',
        status: 'pass',
        summary: 'All 5 codec encoders available',
      },
      {
        id: 'inquiry-methods',
        // warn: harness VM has no physical SCSI devices; doctor's
        // observation is "no /dev/sg* nodes". Real-iPod users see pass.
        status: 'warn',
        summary: 'no /dev/sg* nodes',
      },
      {
        id: 'video-encoder',
        status: 'pass',
        summary: 'libx264 available',
      },
      {
        id: 'debris-transcode-tmp',
        status: 'pass',
        summary: 'No abandoned transcode scratch directories',
      },
      {
        id: 'udev-rule',
        status: 'pass',
        summary: 'iPod udev rule installed',
      },
    ],
  },

  // System-only doctor uses exit 0 (healthy) or 2 (issues-found); never 1
  // (1 is reserved for command errors). The harness VM's inquiry-methods
  // warn means doctor emits exit 2 even under the "healthy" SystemState.
  expectedExitCode: 2,
};
