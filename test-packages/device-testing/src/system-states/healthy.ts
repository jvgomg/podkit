/**
 * `healthy` system state — all required host tools and permissions present.
 *
 * Baseline state. Every system-scope doctor check passes, including
 * `inquiry-methods`. The device-harness VM has no physical SCSI generic
 * devices attached (no real iPod / no dummy scsi_generic node), so the
 * SCSI fallback is inactive — but the VM's USB stack (libusb/libudev) is
 * present, and `inquiry-methods` derives its status USB-first: a host with
 * a working USB transport and no `/dev/sg*` passes rather than warns
 * (see packages/podkit-core/src/diagnostics/checks/inquiry-methods.ts
 * `deriveStatus`). Real podkit users on a host with an iPod plugged in also
 * observe the pass status.
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
    // `healthy`: every system-scope check passes on the harness VM.
    // `inquiry-methods` passes USB-first — the VM's USB stack is present
    // even with no /dev/sg* nodes. See module-level comment.
    overallStatus: 'healthy',
    checks: [
      {
        id: 'codec-encoders',
        status: 'pass',
        summary: 'All 5 codec encoders available',
      },
      {
        id: 'inquiry-methods',
        // pass: USB transport available on the harness VM; /dev/sg* absent
        // (no physical SCSI), so the SCSI fallback is noted as inactive.
        status: 'pass',
        summary: 'USB inquiry available; no /dev/sg* nodes (SCSI fallback inactive)',
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
  // (1 is reserved for command errors). Every check passes under the
  // "healthy" SystemState, so doctor emits exit 0.
  expectedExitCode: 0,
};
