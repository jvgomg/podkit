/**
 * System-state registry.
 *
 * Populated with 6 starter states (TASK-321.06):
 *   `healthy`, `no-ffmpeg`, `no-libgpod`, `no-udev`, `no-sg-perms`,
 *   `corrupt-configfs`
 *
 * Each state describes a host-environment configuration that affects
 * `podkit doctor --scope system` output. Unit tests mock subprocess
 * responses to match a state; VM tests apply the state via `apply-state.sh`.
 *
 * @see adr/adr-017-device-persona-fixtures.md §"SystemState schema"
 * @module
 */

import type { SystemState, SystemStateId } from './types.js';

export type { SystemState, SystemStateId } from './types.js';

export { healthy } from './healthy.js';
export { noFfmpeg } from './no-ffmpeg.js';
export { noLibgpod } from './no-libgpod.js';
export { noUdev } from './no-udev.js';
export { noSgPerms } from './no-sg-perms.js';
export { corruptConfigfs } from './corrupt-configfs.js';
export { deviceMountNearFull, DEVICE_MOUNT_NEAR_FULL_PATH } from './device-mount-near-full.js';
export {
  deviceMountFitsEstimateFailedSweep,
  DEVICE_MOUNT_FITS_ESTIMATE_FAILED_SWEEP_PATH,
} from './device-mount-fits-estimate-failed-sweep.js';
export {
  deviceMountFitsEstimateSourceDrifts,
  DEVICE_MOUNT_FITS_ESTIMATE_SOURCE_DRIFTS_PATH,
} from './device-mount-fits-estimate-source-drifts.js';

import { healthy } from './healthy.js';
import { noFfmpeg } from './no-ffmpeg.js';
import { noLibgpod } from './no-libgpod.js';
import { noUdev } from './no-udev.js';
import { noSgPerms } from './no-sg-perms.js';
import { corruptConfigfs } from './corrupt-configfs.js';
import { deviceMountNearFull } from './device-mount-near-full.js';
import { deviceMountFitsEstimateFailedSweep } from './device-mount-fits-estimate-failed-sweep.js';
import { deviceMountFitsEstimateSourceDrifts } from './device-mount-fits-estimate-source-drifts.js';

/**
 * Registry of host-environment states, keyed by `SystemState.id`.
 *
 * Used by unit injectable mocks and VM state orchestration.
 * Do not mutate at runtime — all states are read-only fixtures.
 */
export const systemStates: Map<SystemStateId, SystemState> = new Map<SystemStateId, SystemState>([
  ['healthy', healthy],
  ['no-ffmpeg', noFfmpeg],
  ['no-libgpod', noLibgpod],
  ['no-udev', noUdev],
  ['no-sg-perms', noSgPerms],
  ['corrupt-configfs', corruptConfigfs],
  ['device-mount-near-full', deviceMountNearFull],
  ['device-mount-fits-estimate-failed-sweep', deviceMountFitsEstimateFailedSweep],
  ['device-mount-fits-estimate-source-drifts', deviceMountFitsEstimateSourceDrifts],
]);
