/**
 * IpodGenerationId → libgpod IpodGeneration mapping.
 *
 * Maps the detection-layer generation IDs (nano_4g, classic_6g) to the
 * libgpod-native generation IDs (nano_4, classic_1) used by the capability
 * and metadata systems. The naming differs because libgpod uses sequential
 * numbering within each family (classic_1 = first Classic model) while the
 * detection layer uses Apple's overall generation numbering (classic_6g = 6th gen iPod).
 *
 * This mapping is the only place in @podkit/devices-ipod that references
 * libgpod concepts. The type import is kept as a string alias to avoid a
 * hard dependency on @podkit/libgpod-node.
 *
 * Also exports `formatGeneration(libgpodName)` — the canonical display-name
 * formatter for libgpod generation strings. Moved here from
 * `@podkit/core/ipod/generation.ts` at m-18.
 *
 * @module
 */

import type { IpodGenerationId } from '../types.js';
import { GENERATIONS } from './generations.js';

/**
 * libgpod's IpodGeneration string values.
 * Mirrors the enum from @podkit/libgpod-node without importing it,
 * keeping @podkit/devices-ipod libgpod-free at runtime.
 */
export type LibgpodGenerationName =
  | 'first'
  | 'second'
  | 'third'
  | 'fourth'
  | 'photo'
  | 'video_1'
  | 'video_2'
  | 'classic_1'
  | 'classic_3'
  | 'mini_1'
  | 'mini_2'
  | 'nano_1'
  | 'nano_2'
  | 'nano_3'
  | 'nano_4'
  | 'nano_5'
  | 'nano_6'
  | 'shuffle_1'
  | 'shuffle_2'
  | 'shuffle_3'
  | 'shuffle_4'
  | 'touch_1'
  | 'touch_2'
  | 'touch_3'
  | 'touch_4'
  | 'unknown';

export const GENERATION_ID_TO_LIBGPOD: Record<IpodGenerationId, LibgpodGenerationName> = {
  classic_1g: 'first',
  classic_2g: 'second',
  classic_3g: 'third',
  classic_4g: 'fourth',
  photo: 'photo',
  video_5g: 'video_1',
  video_5_5g: 'video_2',
  classic_6g: 'classic_1',
  classic_7g: 'classic_3',
  mini_1g: 'mini_1',
  mini_2g: 'mini_2',
  nano_1g: 'nano_1',
  nano_2g: 'nano_2',
  nano_3g: 'nano_3',
  nano_4g: 'nano_4',
  nano_5g: 'nano_5',
  nano_6g: 'nano_6',
  nano_7g: 'unknown', // nano 7G not in libgpod's generation enum
  shuffle_1g: 'shuffle_1',
  shuffle_2g: 'shuffle_2',
  shuffle_3g: 'shuffle_3',
  shuffle_4g: 'shuffle_4',
  touch_1g: 'touch_1',
  touch_2g: 'touch_2',
  touch_3g: 'touch_3',
  touch_4g: 'touch_4',
  touch_5g: 'unknown', // touch 5-7G not in libgpod's generation enum
  touch_6g: 'unknown',
  touch_7g: 'unknown',
};

// =============================================================================
// Reverse index: libgpod name → IpodGenerationId
// =============================================================================

/**
 * Reverse lookup: libgpod generation name → IpodGenerationId.
 * Built once at module load from the authoritative GENERATION_ID_TO_LIBGPOD map.
 * Note: 'unknown' maps to multiple IpodGenerationIds — the first one wins.
 */
const LIBGPOD_NAME_TO_GENERATION_ID = new Map<string, IpodGenerationId>();
for (const [genId, libgpodName] of Object.entries(GENERATION_ID_TO_LIBGPOD)) {
  if (!LIBGPOD_NAME_TO_GENERATION_ID.has(libgpodName)) {
    LIBGPOD_NAME_TO_GENERATION_ID.set(libgpodName, genId as IpodGenerationId);
  }
}

/**
 * Fallback display names for libgpod strings that have no IpodGenerationId
 * equivalent (iPhone, iPad, and names not in GENERATION_ID_TO_LIBGPOD).
 */
const LIBGPOD_FALLBACK_DISPLAY_NAMES: Record<string, string> = {
  unknown: 'Unknown Generation',
  mobile: 'Mobile',
  classic_2: 'iPod Classic (6.5th Generation)',
  iphone_1: 'iPhone (1st Generation)',
  iphone_2: 'iPhone 3G',
  iphone_3: 'iPhone 3GS',
  iphone_4: 'iPhone 4',
  ipad_1: 'iPad (1st Generation)',
};

// =============================================================================
// formatGeneration
// =============================================================================

/**
 * Format a libgpod generation string as a human-readable display name.
 *
 * Resolution order:
 * 1. GENERATIONS table via reverse libgpod→IpodGenerationId lookup (authoritative)
 * 2. LIBGPOD_FALLBACK_DISPLAY_NAMES for libgpod-only strings (iPhone, iPad, etc.)
 * 3. Pass-through: returns the raw generation string unchanged
 *
 * @param libgpodName - Generation string as returned by libgpod
 *   (e.g. `'classic_3'`, `'nano_5'`, `'video_1'`)
 * @returns Human-readable display name
 *
 * @example
 * ```typescript
 * formatGeneration('classic_3'); // 'iPod Classic (7th Generation)'
 * formatGeneration('nano_5');    // 'iPod nano (5th Generation)'
 * formatGeneration('unknown');   // 'Unknown Generation'
 * ```
 */
export function formatGeneration(libgpodName: string): string {
  // Check the fallback table first — it takes precedence for ambiguous libgpod
  // strings like 'unknown' (which maps to multiple IpodGenerationIds) and for
  // libgpod-only names (iPhone, iPad, etc.) that have no IpodGenerationId.
  const fallback = LIBGPOD_FALLBACK_DISPLAY_NAMES[libgpodName];
  if (fallback !== undefined) return fallback;

  const genId = LIBGPOD_NAME_TO_GENERATION_ID.get(libgpodName);
  if (genId) {
    return GENERATIONS[genId].displayName;
  }
  return libgpodName;
}
