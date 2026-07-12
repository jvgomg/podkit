/**
 * `no-ffmpeg` system state — FFmpeg binary is not installed.
 *
 * The host has no `ffmpeg` on PATH. There is no standalone `ffmpeg`
 * presence check in the doctor registry: the `codec-encoders` and
 * `video-encoder` checks both detect FFmpeg via internal probes and
 * return `status: 'skip'` (with a "FFmpeg not available" summary) when
 * the binary isn't usable. Doctor's `healthy` bit counts `skip` as
 * healthy (a skipped check is not an issue), so with no warn/fail check
 * present the system-scope report is healthy and exits 0 — output
 * identical to `healthy`. The missing-ffmpeg condition is therefore NOT
 * visible at the system-scope doctor exit code today; it surfaces only in
 * the codec/video check summaries. (Whether ffmpeg-absent should warn
 * rather than skip is a separate doctor-semantics question, tracked in the
 * backlog.)
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
    // `healthy`: `skip` counts as healthy and inquiry-methods passes
    // USB-first, so no check is warn/fail. Missing ffmpeg is not visible
    // at the system-scope exit code today (see module comment).
    overallStatus: 'healthy',
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

  expectedExitCode: 0,
};
