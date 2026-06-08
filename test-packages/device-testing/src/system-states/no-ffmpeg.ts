/**
 * `no-ffmpeg` system state — FFmpeg binary is not installed.
 *
 * The host has no `ffmpeg` on PATH. There is no standalone `ffmpeg`
 * presence check in the doctor registry: the `codec-encoders` and
 * `video-encoder` checks both detect FFmpeg via internal probes and
 * return `status: 'skip'` (with a "FFmpeg not available" summary) when
 * the binary isn't usable. Doctor exits 2 because the overall report
 * carries skips alongside other passes (no fail-status checks, so the
 * overall is `warn` rather than `fail` — but the run is still
 * non-healthy because of the harness VM's inquiry-methods warn).
 *
 * @see adr/adr-017-device-persona-fixtures.md §"SystemState schema"
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
    overallStatus: 'warn',
    checks: [
      {
        id: 'codec-encoders',
        // The check catches the FFmpeg probe failure and returns `skip`,
        // not `fail`. No standalone "ffmpeg" check exists — the absent
        // tool is signalled via the skip+summary on the encoder checks.
        status: 'skip',
        summary: 'FFmpeg not available (see FFmpeg check)',
      },
      {
        id: 'inquiry-methods',
        status: 'warn',
        summary: 'no /dev/sg* nodes',
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
