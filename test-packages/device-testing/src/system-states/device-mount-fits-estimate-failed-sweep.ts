/**
 * `device-mount-fits-estimate-failed-sweep` system state — host environment
 * is healthy AND a pre-filled loopback ext4 filesystem is mounted at a
 * known mountpoint with **seeded chattr-immutable `.podkit-tmp` debris**.
 *
 * Provisioning details:
 * - Mount: ~1 MiB ext4 loopback at {@link DEVICE_MOUNT_FITS_ESTIMATE_FAILED_SWEEP_PATH}.
 * - Net free after baseline: ~200 KiB.
 * - Debris (under `Music/SeededArtist/SeededAlbum/`): two `.podkit-tmp` files
 *   totalling ~120 KiB, both made immutable via `chattr +i`. The scanner
 *   reports them as debris (~120 KiB freeable); the pre-flight `rm` returns
 *   EPERM per path, so `freedBytes = 0` and `failedPaths.length = 2`.
 *
 * The cell that consumes this state stages a separate source album under
 * `Music/SaveFail Artist/SaveFail Album/` whose write target is unaffected
 * by the immutable debris (different inode tree). After the sync's
 * pre-flight runs, the plan-time envelope ([free=200KiB] + [debris=120KiB] =
 * 320KiB) initially appears to cover the source's `estimateCopySize`
 * (a small flac body ≤300KiB), but the post-sweep recompute reads the
 * actual free (still ~200KiB) and throws `InsufficientSpaceAfterCleanup`
 * because the source body exceeds the real free space.
 *
 * The system-scope doctor output is identical to `healthy` because the
 * loopback + chattr setup is a per-test artefact, not a host-environment
 * misconfiguration.
 *
 * @see adr/adr-018-free-space-pre-flight-strategy.md
 * @see test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts (TASK-412 post-sweep cell)
 * @module
 */

import type { SystemState } from './types.js';

export const deviceMountFitsEstimateFailedSweep: SystemState = {
  id: 'device-mount-fits-estimate-failed-sweep',
  description:
    'Host environment healthy; a 1 MiB ext4 loopback at /mnt/podkit-device-fs-postsweep carries chattr-immutable .podkit-tmp debris so the pre-sync sweep cannot recover the bytes the planner counted on. Exercises the ADR-018 post-sweep statfs recompute.',
  schemaVersion: 1,

  ffmpeg: 'present',
  libgpod: 'present',
  udevRule: 'present',
  sgPermissions: 'group-readable',
  configfs: 'mounted',

  // The loopback + chattr seeding is invisible to system-scope doctor; it is
  // a per-test artefact. Mirrors `healthy` exactly so the smoke tests +
  // golden snapshot continue to hold.
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

/**
 * Mountpoint of the post-sweep loopback inside the VM. Consumers (the
 * save-failure matrix's post-sweep cell) read this rather than hardcoding
 * the path so changing the layout is a one-file edit.
 */
export const DEVICE_MOUNT_FITS_ESTIMATE_FAILED_SWEEP_PATH = '/mnt/podkit-device-fs-postsweep';
