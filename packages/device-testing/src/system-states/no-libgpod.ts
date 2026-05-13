/**
 * `no-libgpod` system state — libgpod runtime is not available.
 *
 * FFmpeg and all other tools are present. Only the libgpod runtime check
 * fails. Doctor exits with code 1.
 *
 * @see adr/adr-017-device-persona-fixtures.md §"SystemState schema"
 * @module
 */

import type { SystemState } from './types.js';

export const noLibgpod: SystemState = {
  id: 'no-libgpod',
  description: 'libgpod runtime is not available; iPod database access will fail.',
  schemaVersion: 1,

  ffmpeg: 'present',
  libgpod: 'missing',
  udevRule: 'present',
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
        status: 'fail',
        summary: 'libgpod runtime not found',
      },
      {
        id: 'inquiry-methods',
        status: 'pass',
        summary: '/dev/sg* present',
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
