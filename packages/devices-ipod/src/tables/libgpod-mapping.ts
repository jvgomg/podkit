/**
 * libgpod-naming surface — the only place in @podkit/devices-ipod that
 * references libgpod concepts.
 *
 * Maps detection-layer generation IDs (nano_4g, classic_6g) to libgpod's
 * sequential names (nano_4, classic_1) and back. Provides:
 *
 * - `GENERATION_ID_TO_LIBGPOD` — forward map.
 * - `lookupByLibgpodName(name)` — reverse map.
 * - `formatGeneration(libgpodName)` — canonical display-name formatter.
 * - `LibgpodDeviceInfo` — input shape for callers that hold libgpod data.
 * - `getUnsupportedReasonByLibgpodName(name)` — categorize unsupported devices.
 *
 * The libgpod type alias is a string union, not an import, to keep this
 * package free of `@podkit/libgpod-node` at runtime.
 *
 * @module
 */

import type { IpodGenerationId } from '../types.js';
import { GENERATIONS } from './generations.js';
import { formatIpodLabel } from '../format.js';

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
 * Look up an IpodGenerationId from a libgpod generation string.
 *
 * @param libgpodName - Generation string as returned by libgpod (e.g. 'nano_4', 'classic_3')
 * @returns The matching IpodGenerationId, or undefined for unknown strings
 */
export function lookupByLibgpodName(libgpodName: string): IpodGenerationId | undefined {
  return LIBGPOD_NAME_TO_GENERATION_ID.get(libgpodName);
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
    const gen = GENERATIONS[genId];
    return formatIpodLabel({ family: gen.family, ordinal: gen.ordinal });
  }
  return libgpodName;
}

// =============================================================================
// LibgpodDeviceInfo — input shape for callers that hold libgpod data
// =============================================================================

/**
 * The subset of libgpod Device capabilities needed to resolve an iPod model.
 *
 * Mirrors the shape returned by `device.getCapabilities()` in
 * `@podkit/libgpod-node`. Defined locally to avoid importing the native
 * package at this layer.
 */
export interface LibgpodDeviceInfo {
  readonly supportsArtwork: boolean;
  readonly supportsVideo: boolean;
  readonly generation: string;
  readonly modelNumber?: string | null;
}

// =============================================================================
// Unsupported-device classification by libgpod generation name
// =============================================================================

/**
 * Category of unsupported device (keyed by libgpod generation string).
 *
 * - `'ios_device'`        — iPod Touch, iPhone, iPad (Apple proprietary protocol)
 * - `'buttonless_shuffle'` — Shuffle 3G/4G (requires iTunes authentication)
 * - `'nano_6'`            — Nano 6th gen (incompatible iTunesDB format)
 */
export type UnsupportedGenerationKind = 'ios_device' | 'buttonless_shuffle' | 'nano_6';

const IOS_LIBGPOD_NAMES = new Set([
  'touch_1',
  'touch_2',
  'touch_3',
  'touch_4',
  'iphone_1',
  'iphone_2',
  'iphone_3',
  'iphone_4',
  'ipad_1',
]);

const BUTTONLESS_SHUFFLE_LIBGPOD_NAMES = new Set(['shuffle_3', 'shuffle_4']);

/**
 * Returns the unsupported kind for a libgpod generation string, or null if
 * the generation is supported by podkit.
 *
 * @param libgpodName - Generation string as returned by libgpod (e.g. 'touch_1', 'nano_6')
 */
export function getUnsupportedReasonByLibgpodName(
  libgpodName: string
): UnsupportedGenerationKind | null {
  if (IOS_LIBGPOD_NAMES.has(libgpodName)) return 'ios_device';
  if (BUTTONLESS_SHUFFLE_LIBGPOD_NAMES.has(libgpodName)) return 'buttonless_shuffle';
  if (libgpodName === 'nano_6') return 'nano_6';
  return null;
}
