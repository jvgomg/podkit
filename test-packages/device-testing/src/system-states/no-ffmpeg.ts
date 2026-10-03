/**
 * `no-ffmpeg` system state — FFmpeg binary is not installed.
 *
 * The host has no `ffmpeg` on PATH. The `ffmpeg` check fails — FFmpeg is
 * podkit's runtime dependency — so system-scope doctor exits 2. The
 * `codec-encoders` and `video-encoder` checks probe the same binary and
 * `skip`, pointing at the `ffmpeg` check, so the root cause is reported once.
 *
 * @see docs/architecture/conventions.md §13 (doctor `skip` semantics)
 * @see docs/adr/adr-017-device-persona-fixtures.md §"SystemState schema"
 * @see test-packages/e2e-vm-tests/src/system-state-cross-check.e2e.test.ts
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
        status: 'skip',
        summary: 'FFmpeg not available (see FFmpeg check)',
      },
      {
        id: 'inquiry-methods',
        status: 'pass',
        summary: 'USB inquiry available; no /dev/sg* nodes (SCSI fallback inactive)',
      },
      {
        id: 'video-encoder',
        status: 'skip',
        summary: 'FFmpeg not available (see FFmpeg check)',
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
