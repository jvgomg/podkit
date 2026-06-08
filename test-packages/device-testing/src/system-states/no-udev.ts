/**
 * `no-udev` system state — libgpod-shipped udev rules removed.
 *
 * The apply-state.sh action stashes any `/lib/udev/rules.d/*libgpod*`
 * files (Debian's libgpod-common ships these). It does NOT touch the
 * podkit-owned rule at `/etc/udev/rules.d/91-podkit-ipod.rules`, which
 * is the only rule the doctor `udev-rule` check inspects. As a result
 * the doctor system-scope output under this state is identical to
 * `healthy` — the libgpod rule absence is observable to the test VM's
 * SCSI access path but invisible to doctor today.
 *
 * If we ever add a doctor check that observes the libgpod-shipped rule
 * (or apply-state.sh starts removing the podkit rule), update this
 * fixture and the cross-check test will catch the drift.
 *
 * @see adr/adr-017-device-persona-fixtures.md §"SystemState schema"
 * @see test-packages/e2e-vm-tests/src/system-state-cross-check.e2e.test.ts
 * @module
 */

import type { SystemState } from './types.js';

export const noUdev: SystemState = {
  id: 'no-udev',
  description: 'podkit udev rule is not installed; SCSI access requires sudo on Linux.',
  schemaVersion: 1,

  ffmpeg: 'present',
  libgpod: 'present',
  udevRule: 'missing',
  sgPermissions: 'group-readable',
  configfs: 'mounted',

  // Same as `healthy` at the doctor system scope. The udev-rule check
  // tracks the podkit rule, which apply-state.sh's `no-udev` action
  // leaves in place; only the libgpod-shipped rules get stashed, and
  // doctor has no check for those.
  expectedDoctorSystemOutput: {
    overallStatus: 'warn',
    checks: [
      {
        id: 'codec-encoders',
        status: 'pass',
        summary: 'All 5 codec encoders available',
      },
      {
        id: 'inquiry-methods',
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

  expectedExitCode: 2,
};
