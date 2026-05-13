/**
 * `corrupt-configfs` system state — configfs filesystem is not mounted.
 *
 * FFmpeg, libgpod, udev rule, and sg permissions are all healthy. The
 * configfs mount is absent (unmounted), which blocks USB gadget setup for
 * the virtual iPod server and Tier 3 test VM. Doctor exits with code 1.
 *
 * Note: the state is named `corrupt-configfs` per the ADR-017 starter set,
 * but the concrete condition used here is `unmounted` (the most common
 * failure mode). A `corrupt` mount is also covered by this state ID for
 * Tier 3 snapshot purposes.
 *
 * @see adr/adr-017-device-persona-fixtures.md §"SystemState schema"
 * @module
 */

import type { SystemState } from './types.js';

export const corruptConfigfs: SystemState = {
  id: 'corrupt-configfs',
  description:
    'configfs filesystem is not mounted; USB gadget setup is blocked for virtual iPod and Tier 3 tests.',
  schemaVersion: 1,

  ffmpeg: 'present',
  libgpod: 'present',
  udevRule: 'present',
  sgPermissions: 'group-readable',
  configfs: 'unmounted',

  expectedDoctorSystemOutput: {
    overallStatus: 'fail',
    checks: [
      {
        id: 'ffmpeg',
        status: 'pass',
        summary: 'FFmpeg available',
      },
      {
        id: 'codec-encoders',
        status: 'pass',
        summary: 'All codec encoders available',
      },
      {
        id: 'video-encoder',
        status: 'pass',
        summary: 'libx264 available',
      },
      {
        id: 'libgpod-runtime',
        status: 'pass',
        summary: 'libgpod runtime available',
      },
      {
        id: 'inquiry-methods',
        status: 'pass',
        summary: '/dev/sg* present',
      },
      {
        id: 'configfs-mount',
        status: 'fail',
        summary: 'configfs is not mounted at /sys/kernel/config',
      },
    ],
  },

  expectedExitCode: 1,
};
