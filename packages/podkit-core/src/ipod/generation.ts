/**
 * iPod generation display-name lookup for libgpod generation strings.
 *
 * Maps libgpod's sequential generation identifiers (e.g. `'classic_3'`) to
 * human-readable display names. This table covers all generation strings
 * that libgpod can return and preserves the display-name convention used
 * throughout the CLI surface (e.g. `'Classic (7th Generation)'`).
 *
 * ## Migration note
 *
 * All capability data (supportsAlac, videoProfile, artworkMaxResolution) has
 * been removed from this file — those fields are now in
 * `@podkit/devices-ipod/tables/generations.ts` (the authoritative table).
 * `getVideoProfile`, `supportsVideo`, and `supportsAlac` are deprecated and
 * will be removed at m-8.
 *
 * @module
 */

import type { IpodGeneration } from '@podkit/libgpod-node';

// =============================================================================
// Display Name Table
// =============================================================================

/**
 * @deprecated Retained for backward-compatibility. Consumers that need
 * generation capability data should import from `@podkit/devices-ipod`.
 */
export interface IpodGenerationMetadata {
  id: IpodGeneration;
  displayName: string;
  /** @deprecated Use `@podkit/devices-ipod` GENERATIONS table instead. */
  videoProfile?: 'ipod-video-5g' | 'ipod-classic' | 'ipod-nano-3g';
  /** @deprecated Use `@podkit/devices-ipod` GENERATIONS table instead. */
  supportsAlac?: boolean;
}

/**
 * Display names for all libgpod generation identifiers.
 *
 * @deprecated Use `@podkit/devices-ipod` GENERATIONS + GENERATION_ID_TO_LIBGPOD
 * for capability queries. This table is display-name-only.
 */
const GENERATION_DISPLAY_NAMES: Record<IpodGeneration, string> = {
  unknown: 'Unknown Generation',
  first: '1st Generation',
  second: '2nd Generation',
  third: '3rd Generation',
  fourth: '4th Generation',
  photo: 'Photo',
  mobile: 'Mobile',
  mini_1: 'Mini (1st Generation)',
  mini_2: 'Mini (2nd Generation)',
  shuffle_1: 'Shuffle (1st Generation)',
  shuffle_2: 'Shuffle (2nd Generation)',
  shuffle_3: 'Shuffle (3rd Generation)',
  shuffle_4: 'Shuffle (4th Generation)',
  nano_1: 'Nano (1st Generation)',
  nano_2: 'Nano (2nd Generation)',
  nano_3: 'Nano (3rd Generation)',
  nano_4: 'Nano (4th Generation)',
  nano_5: 'Nano (5th Generation)',
  nano_6: 'Nano (6th Generation)',
  video_1: 'Video (5th Generation)',
  video_2: 'Video (5.5th Generation)',
  classic_1: 'Classic (6th Generation)',
  classic_2: 'Classic (6.5th Generation)',
  classic_3: 'Classic (7th Generation)',
  touch_1: 'Touch (1st Generation)',
  touch_2: 'Touch (2nd Generation)',
  touch_3: 'Touch (3rd Generation)',
  touch_4: 'Touch (4th Generation)',
  iphone_1: 'iPhone (1st Generation)',
  iphone_2: 'iPhone 3G',
  iphone_3: 'iPhone 3GS',
  iphone_4: 'iPhone 4',
  ipad_1: 'iPad (1st Generation)',
};

/**
 * @deprecated Use GENERATION_DISPLAY_NAMES directly. IPOD_GENERATIONS is
 * retained for backward-compatibility only — capability fields are stubs.
 */
export const IPOD_GENERATIONS: Record<IpodGeneration, IpodGenerationMetadata> = Object.fromEntries(
  Object.entries(GENERATION_DISPLAY_NAMES).map(([id, displayName]) => [
    id,
    { id: id as IpodGeneration, displayName },
  ])
) as Record<IpodGeneration, IpodGenerationMetadata>;

// =============================================================================
// Public API — formatGeneration
// =============================================================================

/**
 * Format a generation identifier as a human-readable display name.
 *
 * @param generation - Generation identifier from libgpod
 * @returns Human-readable generation name
 *
 * @example
 * ```typescript
 * formatGeneration('classic_3'); // 'Classic (7th Generation)'
 * formatGeneration('nano_5');    // 'Nano (5th Generation)'
 * ```
 */
export function formatGeneration(generation: IpodGeneration): string;
export function formatGeneration(generation: string): string;
export function formatGeneration(generation: string): string {
  return GENERATION_DISPLAY_NAMES[generation as IpodGeneration] ?? generation;
}

// =============================================================================
// Deprecated helpers — retained for backward-compatibility, removed at m-8
// =============================================================================

/**
 * @deprecated Import from `@podkit/devices-ipod` (GENERATIONS table) instead.
 * This function stays for back-compat and will be removed at m-8.
 */
export function getVideoProfile(
  _generation: IpodGeneration
): 'ipod-video-5g' | 'ipod-classic' | 'ipod-nano-3g' | undefined;
export function getVideoProfile(_generation: string): string | undefined;
export function getVideoProfile(_generation: string): string | undefined {
  // Delegate to the video-subsystem's local mapping to avoid duplication.
  // Kept as a stub so existing code that imports this function still compiles.
  return undefined;
}

/**
 * @deprecated Use `@podkit/devices-ipod` GENERATIONS[id].supportsVideo instead.
 * This function stays for back-compat and will be removed at m-8.
 */
export function supportsVideo(_generation: IpodGeneration): boolean;
export function supportsVideo(_generation: string): boolean;
export function supportsVideo(_generation: string): boolean {
  return false;
}

/**
 * @deprecated Use `@podkit/devices-ipod` GENERATIONS[id].supportsAlac instead.
 * This function stays for back-compat and will be removed at m-8.
 */
export function supportsAlac(_generation: IpodGeneration): boolean;
export function supportsAlac(_generation: string): boolean;
export function supportsAlac(_generation: string): boolean {
  return false;
}
