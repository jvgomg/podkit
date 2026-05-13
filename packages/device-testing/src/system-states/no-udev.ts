/**
 * `no-udev` system state — podkit udev rule is not installed.
 *
 * FFmpeg, libgpod, and sg permissions are all healthy. The udev rule check
 * fails, meaning SCSI access to iPod devices requires sudo. Doctor exits
 * with code 1.
 *
 * @see adr/adr-017-device-persona-fixtures.md §"SystemState schema"
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
        id: 'udev-rule',
        status: 'fail',
        summary: 'podkit udev rule not found at /etc/udev/rules.d/91-podkit-ipod-scsi.rules',
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
