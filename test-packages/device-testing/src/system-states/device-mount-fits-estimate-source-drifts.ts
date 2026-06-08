/**
 * `device-mount-fits-estimate-source-drifts` system state — host environment
 * is healthy AND a pre-filled loopback ext4 filesystem is mounted at a
 * known mountpoint sized to fit the planner's `estimateCopySize` prediction
 * but **NOT** the source mp3's actual on-disk size.
 *
 * Provisioning details:
 * - Mount: ~2 MiB ext4 loopback at {@link DEVICE_MOUNT_FITS_ESTIMATE_SOURCE_DRIFTS_PATH}.
 * - Net free after baseline: ~1024 KiB (≈1 MiB).
 * - Source mp3 (provisioned by the test, not this SystemState): 320 kbps,
 *   30 seconds → actual ~1200 KiB. `estimateCopySize` predicts 30s × 256
 *   kbps = ~960 KiB + container overhead.
 *
 * Predicted flow:
 * - Plan-time: free (1024 KiB) ≥ estimate (~961 KiB) → passes.
 * - Pre-sync sweep: no debris seeded → freed=0, fresh statfs ~1024 KiB.
 * - Post-sweep recompute: 961 KiB ≤ 1024 KiB → still passes.
 * - Transfer phase atomic copy: tries to write 1200 KiB → ENOSPC mid-write
 *   → raw fs error propagates through `MassStorageAdapter.copyTrackFile`
 *   (no typed wrap on this path today) → executor's `categorizeError`
 *   falls back to operation-type `'copy'` via `categoryForOperationType`.
 *
 * Cell pinning: `throwsClass: null` (raw fs error has no typed wrap),
 * `errorCategory: 'copy'`. A future follow-up could wrap raw fs errors
 * in a `CopyError extends CategorizedSyncError` and strengthen this pin.
 *
 * The system-scope doctor output is identical to `healthy` because the
 * loopback is a per-test artefact, not a host-environment misconfiguration.
 *
 * @see adr/adr-018-free-space-pre-flight-strategy.md
 * @see test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts (TASK-412 estimate-drift cell)
 * @module
 */

import type { SystemState } from './types.js';

export const deviceMountFitsEstimateSourceDrifts: SystemState = {
  id: 'device-mount-fits-estimate-source-drifts',
  description:
    'Host environment healthy; a 2 MiB ext4 loopback at /mnt/podkit-device-fs-drift is sized to fit the planner estimateCopySize prediction but not the actual 320kbps mp3 source. Exercises the estimate-drift mid-save ENOSPC path.',
  schemaVersion: 1,

  ffmpeg: 'present',
  libgpod: 'present',
  udevRule: 'present',
  sgPermissions: 'group-readable',
  configfs: 'mounted',

  expectedDoctorSystemOutput: {
    overallStatus: 'healthy',
    checks: [
      { id: 'ffmpeg', status: 'pass', summary: 'FFmpeg available' },
      { id: 'codec-encoders', status: 'pass', summary: 'All codec encoders available' },
      { id: 'video-encoder', status: 'pass', summary: 'libx264 available' },
      { id: 'libgpod-runtime', status: 'pass', summary: 'libgpod runtime available' },
      { id: 'inquiry-methods', status: 'pass', summary: '/dev/sg* present' },
      { id: 'configfs-mount', status: 'pass', summary: 'configfs mounted' },
    ],
  },

  expectedExitCode: 0,
};

/**
 * Mountpoint of the drift loopback inside the VM. Consumers (the save-
 * failure matrix's estimate-drift cell) read this rather than hardcoding
 * the path so changing the layout is a one-file edit.
 */
export const DEVICE_MOUNT_FITS_ESTIMATE_SOURCE_DRIFTS_PATH = '/mnt/podkit-device-fs-drift';
