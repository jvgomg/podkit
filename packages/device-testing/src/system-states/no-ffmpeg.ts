/**
 * `no-ffmpeg` system state — FFmpeg binary is not installed.
 *
 * All codec-encoder and video-encoder checks are skipped or fail because the
 * FFmpeg binary cannot be found. Doctor exits with code 1.
 *
 * @see adr/adr-017-device-persona-fixtures.md §"SystemState schema"
 * @module
 */

import type { SystemState } from './types.js';

export const noFfmpeg: SystemState = {
  id: 'no-ffmpeg',
  description: 'FFmpeg binary is not installed; transcoding is unavailable.',
  schemaVersion: 1,

  ffmpeg: 'missing',
  libgpod: 'present',
  udevRule: 'present',
  sgPermissions: 'group-readable',
  configfs: 'mounted',

  expectedDoctorSystemOutput: {
    overallStatus: 'fail',
    checks: [
      {
        id: 'ffmpeg',
        status: 'fail',
        summary: 'FFmpeg not found',
      },
      {
        id: 'codec-encoders',
        status: 'fail',
        summary: 'FFmpeg not available — cannot check encoders',
      },
      {
        id: 'video-encoder',
        status: 'fail',
        summary: 'FFmpeg not available (see FFmpeg check)',
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
        status: 'pass',
        summary: 'configfs mounted',
      },
    ],
  },

  expectedExitCode: 1,
};
