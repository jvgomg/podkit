/**
 * Artwork resolution constants.
 *
 * Single source of truth for ARTWORK_MAX_RESOLUTION. Previously duplicated
 * between podkit-core/device/capability-adapter.ts and ipod/generation.ts.
 * TASK-294.12 will wire this back into core's re-export shim.
 *
 * @module
 */

/**
 * Maximum artwork dimensions supported by any iPod generation.
 * Used when determining whether artwork needs to be downscaled.
 */
export const ARTWORK_MAX_RESOLUTION = {
  width: 320,
  height: 320,
} as const;

export type ArtworkResolution = typeof ARTWORK_MAX_RESOLUTION;
