/**
 * System-state registry.
 *
 * Populated with 6 starter states (TASK-321.06):
 *   `healthy`, `no-ffmpeg`, `no-libgpod`, `no-udev`, `no-sg-perms`,
 *   `corrupt-configfs`
 *
 * Each state describes a host-environment configuration that affects
 * `podkit doctor --scope system` output. Tier 1 tests mock subprocess
 * responses to match a state; Tier 3 tests restore a matching VM snapshot.
 *
 * @see adr/adr-017-device-persona-fixtures.md §"SystemState schema"
 * @module
 */

import type { SystemState } from './types.js';

export type { SystemState } from './types.js';

export { healthy } from './healthy.js';
export { noFfmpeg } from './no-ffmpeg.js';
export { noLibgpod } from './no-libgpod.js';
export { noUdev } from './no-udev.js';
export { noSgPerms } from './no-sg-perms.js';
export { corruptConfigfs } from './corrupt-configfs.js';

import { healthy } from './healthy.js';
import { noFfmpeg } from './no-ffmpeg.js';
import { noLibgpod } from './no-libgpod.js';
import { noUdev } from './no-udev.js';
import { noSgPerms } from './no-sg-perms.js';
import { corruptConfigfs } from './corrupt-configfs.js';

/**
 * Registry of host-environment states, keyed by `SystemState.id`.
 *
 * Used by Tier 1 injectable mocks and Tier 3 VM snapshot management.
 * Do not mutate at runtime — all states are read-only fixtures.
 */
export const systemStates: Map<string, SystemState> = new Map<string, SystemState>([
  ['healthy', healthy],
  ['no-ffmpeg', noFfmpeg],
  ['no-libgpod', noLibgpod],
  ['no-udev', noUdev],
  ['no-sg-perms', noSgPerms],
  ['corrupt-configfs', corruptConfigfs],
]);
