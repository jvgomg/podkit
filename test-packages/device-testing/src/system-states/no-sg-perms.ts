/**
 * `no-sg-perms` system state — `/dev/sg*` nodes are present but not readable
 * by the test user.
 *
 * FFmpeg, libgpod, and udev rule are all healthy. The SCSI inquiry path is
 * blocked by permission denial. Doctor reports the inquiry-methods check as
 * a warning (not a hard failure — USB inquiry still works for most devices).
 * Doctor exits with code 1.
 *
 * @see adr/adr-017-device-persona-fixtures.md §"SystemState schema"
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

  expectedDoctorSystemOutput: {
    overallStatus: 'warn',
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
        status: 'warn',
        summary: '/dev/sg* present but not readable (gid plugdev or sudo required)',
      },
      {
        id: 'configfs-mount',
        status: 'pass',
        summary: 'configfs mounted',
      },
    ],
  },

  expectedExitCode: 1,
};
