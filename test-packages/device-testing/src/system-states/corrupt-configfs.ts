/**
 * `corrupt-configfs` system state — configfs filesystem is not mounted.
 *
 * Doctor has no `configfs-mount` check; configfs is only consumed by the
 * USB gadget infrastructure used by the virtual iPod server and the
 * VM-test harness, not by podkit's user-facing flows. The legacy
 * fixture id was a phantom. This state's host-environment mutation
 * still has value for the gadget-setup smoke tests (the daemon fails
 * to bind a gadget when configfs is gone), but the doctor system-scope
 * report under this state is identical to `healthy`.
 *
 * @see adr/adr-017-device-persona-fixtures.md §"SystemState schema"
 * @see test-packages/e2e-vm-tests/src/system-state-cross-check.e2e.test.ts
 * @module
 */

import type { SystemState } from './types.js';

export const corruptConfigfs: SystemState = {
  id: 'corrupt-configfs',
  description:
    'configfs filesystem is not mounted; USB gadget setup is blocked for virtual iPod and VM tests.',
  schemaVersion: 1,

  ffmpeg: 'present',
  libgpod: 'present',
  udevRule: 'present',
  sgPermissions: 'group-readable',
  configfs: 'unmounted',

  // Same as `healthy`: no doctor system-scope check observes configfs.
  expectedDoctorSystemOutput: {
    overallStatus: 'healthy',
    checks: [
      {
        id: 'codec-encoders',
        status: 'pass',
        summary: 'All 5 codec encoders available',
      },
      {
        id: 'inquiry-methods',
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

  expectedExitCode: 0,
};
