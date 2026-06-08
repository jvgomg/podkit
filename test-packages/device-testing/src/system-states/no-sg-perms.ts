/**
 * `no-sg-perms` system state — `/dev/sg*` perms udev rule removed.
 *
 * The apply-state.sh action removes the `40-podkit-sg-perms.rules`
 * marker that grants world-readable mode on `/dev/sg*` nodes, then
 * chmods 0600 any existing nodes. On the device-harness VM there are
 * no `/dev/sg*` nodes to perms-test (no real SCSI device is attached),
 * so the doctor `inquiry-methods` check reports the same "no /dev/sg*
 * nodes" warn it does under `healthy`. The state's intent — surfacing
 * a sg-perms-denial path — would need a synthetic /dev/sg* node (or a
 * real iPod) to actually exercise the doctor path.
 *
 * @see adr/adr-017-device-persona-fixtures.md §"SystemState schema"
 * @see test-packages/e2e-vm-tests/src/system-state-cross-check.e2e.test.ts
 * @module
 */

import type { SystemState } from './types.js';

export const noSgPerms: SystemState = {
  id: 'no-sg-perms',
  description:
    '/dev/sg* nodes exist but are not readable by the test user; SCSI inquiry path denied.',
  schemaVersion: 1,

  ffmpeg: 'present',
  libgpod: 'present',
  udevRule: 'present',
  sgPermissions: 'denied',
  configfs: 'mounted',

  // Doctor output is identical to `healthy` on the harness VM because
  // there are no physical /dev/sg* nodes for the perms change to bite.
  // The inquiry-methods check warns with "no /dev/sg* nodes" regardless
  // of whether the perms rule is installed.
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
