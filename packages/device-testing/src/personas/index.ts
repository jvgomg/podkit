/**
 * Device persona registry.
 *
 * Personas land in TASK-321.02 (starter set: `ipod-video-5g-fresh`,
 * `ipod-nano-7g-populated`, `echo-mini-empty`). The registry is intentionally
 * empty at the scaffolding stage so the schema/runtime can ship independently.
 *
 * @module
 */

import type { DevicePersona } from './types.js';

export type { DevicePersona } from './types.js';

/**
 * Mutable registry of device personas, keyed by `DevicePersona.id`.
 *
 * Add new personas by appending to the map at module load — see
 * `agents/device-testing.md` for the persona-capture workflow once it lands
 * in TASK-321.08.
 */
export const personas: Map<string, DevicePersona> = new Map();
