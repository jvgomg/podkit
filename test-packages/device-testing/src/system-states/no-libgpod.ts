/**
 * `no-libgpod` system state — libgpod runtime is not available.
 *
 * podkit links libgpod statically into the shipped binary, so removing
 * the runtime libgpod packages from the host does NOT affect podkit
 * itself. The doctor system-scope check registry has NO standalone
 * "libgpod-runtime" check — the legacy fixture id was a phantom. This
 * state exists for unit tests / future tooling that target the dynamic
 * libgpod surface (e.g. `gpod-tool`, which links libgpod dynamically),
 * but at the doctor system-scope layer it produces output identical to
 * `healthy`.
 *
 * @see adr/adr-017-device-persona-fixtures.md §"SystemState schema"
 * @see test-packages/e2e-vm-tests/src/system-state-cross-check.e2e.test.ts
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

  // System-scope doctor output is identical to `healthy` because no
  // doctor check inspects the dynamic libgpod runtime — podkit's
  // libgpod is statically linked. This fixture's `libgpod: 'missing'`
  // host-environment field still has unit-test value (mocks of the
  // libgpod-dependent surfaces), but doctor's system scope does not
  // observe it.
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
