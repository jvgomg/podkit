/**
 * `healthy` system state — all required host tools and permissions present.
 *
 * Baseline state. Every system-scope doctor check passes. Used as the
 * control state against which failing states are compared.
 *
 * @see adr/adr-017-device-persona-fixtures.md §"SystemState schema"
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
    overallStatus: 'healthy',
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
        status: 'pass',
        summary: 'configfs mounted',
      },
    ],
  },

  expectedExitCode: 0,
};
