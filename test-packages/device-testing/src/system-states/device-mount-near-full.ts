/**
 * `device-mount-near-full` system state — host environment is healthy AND a
 * pre-filled loopback ext4 filesystem is mounted at a known mountpoint so the
 * first sizeable write into it fails with ENOSPC.
 *
 * Used by the save-failure matrix to exercise the ENOSPC code path against a
 * real filesystem without disturbing the rest of the VM. The system-scope
 * doctor output is identical to `healthy` because the near-full mount is a
 * per-test artefact, not a host-environment misconfiguration.
 *
 * The loopback layout is:
 *
 *   /var/lib/podkit-device-harness/podkit-device-fs.img  — 5 MiB ext4 image
 *   /mnt/podkit-device-fs                                — mountpoint
 *   /mnt/podkit-device-fs/_fill                          — pad file (~99% full)
 *
 * The fill leaves ~50 KiB free — enough for the manifest write and a couple
 * of small metadata-only files, but not enough for a flac source body. The
 * first `add-direct-copy` of a non-trivial flac source therefore fails with
 * ENOSPC during the file copy. See save-failure-rules.ts for the assertions.
 *
 * @see adr/adr-017-device-persona-fixtures.md §"SystemState schema"
 * @module
 */

import type { SystemState } from './types.js';

export const deviceMountNearFull: SystemState = {
  id: 'device-mount-near-full',
  description:
    'Host environment healthy; a 5 MiB ext4 loopback is mounted at /mnt/podkit-device-fs and pre-filled so the first sizeable write triggers ENOSPC.',
  schemaVersion: 1,

  ffmpeg: 'present',
  libgpod: 'present',
  udevRule: 'present',
  sgPermissions: 'group-readable',
  configfs: 'mounted',

  // The near-full loopback is invisible to system-scope doctor; it is a
  // per-test artefact, not a host-environment property. Mirrors `healthy`
  // exactly so the smoke tests + golden snapshot continue to hold.
  expectedDoctorSystemOutput: {
    overallStatus: 'warn',
    checks: [
      {
        id: 'codec-encoders',
        status: 'pass',
        summary: 'All 5 codec encoders available',
      },
      {
        id: 'inquiry-methods',
        status: 'warn',
        summary: 'no /dev/sg* nodes',
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

  expectedExitCode: 2,
};

/**
 * Mountpoint of the near-full loopback inside the VM. Consumers (save-failure
 * matrix) read this rather than hardcoding the path so changing the layout is
 * a one-file edit.
 */
export const DEVICE_MOUNT_NEAR_FULL_PATH = '/mnt/podkit-device-fs';
