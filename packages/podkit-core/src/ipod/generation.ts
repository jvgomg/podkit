/**
 * iPod generation metadata and utilities.
 *
 * Consolidates generation display names and video profile mappings
 * into a single source of truth.
 */

import type { IpodGeneration } from '@podkit/libgpod-node';

/**
 * Metadata for an iPod generation.
 */
export interface IpodGenerationMetadata {
  /** Generation identifier from libgpod */
  id: IpodGeneration;
  /** Human-readable display name */
  displayName: string;
  /** Video device profile name (for video-capable models only) */
  videoProfile?: 'ipod-video-5g' | 'ipod-classic' | 'ipod-nano-3g';
}

/**
 * Complete metadata for all iPod generations.
 *
 * Maps libgpod generation identifiers to display names and capabilities.
 * Video profiles are only specified for models with video playback support.
 *
 * @see https://www.libgpod.org/api/model_id.html
 */
export const IPOD_GENERATIONS: Record<IpodGeneration, IpodGenerationMetadata> = {
  unknown: {
    id: 'unknown',
    displayName: 'Unknown Generation',
  },
  first: {
    id: 'first',
    displayName: '1st Generation',
  },
  second: {
    id: 'second',
    displayName: '2nd Generation',
  },
  third: {
    id: 'third',
    displayName: '3rd Generation',
  },
  fourth: {
    id: 'fourth',
    displayName: '4th Generation',
  },
  photo: {
    id: 'photo',
    displayName: 'Photo',
  },
  mobile: {
    id: 'mobile',
    displayName: 'Mobile',
  },
  mini_1: {
    id: 'mini_1',
    displayName: 'Mini (1st Generation)',
  },
  mini_2: {
    id: 'mini_2',
    displayName: 'Mini (2nd Generation)',
  },
  shuffle_1: {
    id: 'shuffle_1',
    displayName: 'Shuffle (1st Generation)',
  },
  shuffle_2: {
    id: 'shuffle_2',
    displayName: 'Shuffle (2nd Generation)',
  },
  shuffle_3: {
    id: 'shuffle_3',
    displayName: 'Shuffle (3rd Generation)',
  },
  shuffle_4: {
    id: 'shuffle_4',
    displayName: 'Shuffle (4th Generation)',
  },
  nano_1: {
    id: 'nano_1',
    displayName: 'Nano (1st Generation)',
  },
  nano_2: {
    id: 'nano_2',
    displayName: 'Nano (2nd Generation)',
  },
  nano_3: {
    id: 'nano_3',
    displayName: 'Nano (3rd Generation)',
    videoProfile: 'ipod-nano-3g',
  },
  nano_4: {
    id: 'nano_4',
    displayName: 'Nano (4th Generation)',
    videoProfile: 'ipod-nano-3g',
  },
  nano_5: {
    id: 'nano_5',
    displayName: 'Nano (5th Generation)',
    videoProfile: 'ipod-nano-3g',
  },
  nano_6: {
    id: 'nano_6',
    displayName: 'Nano (6th Generation)',
  },
  video_1: {
    id: 'video_1',
    displayName: 'Video (5th Generation)',
    videoProfile: 'ipod-video-5g',
  },
  video_2: {
    id: 'video_2',
    displayName: 'Video (5.5th Generation)',
    videoProfile: 'ipod-video-5g',
  },
  classic_1: {
    id: 'classic_1',
    displayName: 'Classic (6th Generation)',
    videoProfile: 'ipod-classic',
  },
  classic_2: {
    id: 'classic_2',
    displayName: 'Classic (6.5th Generation)',
    videoProfile: 'ipod-classic',
  },
  classic_3: {
    id: 'classic_3',
    displayName: 'Classic (7th Generation)',
    videoProfile: 'ipod-classic',
  },
  touch_1: {
    id: 'touch_1',
    displayName: 'Touch (1st Generation)',
  },
  touch_2: {
    id: 'touch_2',
    displayName: 'Touch (2nd Generation)',
  },
  touch_3: {
    id: 'touch_3',
    displayName: 'Touch (3rd Generation)',
  },
  touch_4: {
    id: 'touch_4',
    displayName: 'Touch (4th Generation)',
  },
  iphone_1: {
    id: 'iphone_1',
    displayName: 'iPhone (1st Generation)',
  },
  iphone_2: {
    id: 'iphone_2',
    displayName: 'iPhone 3G',
  },
  iphone_3: {
    id: 'iphone_3',
    displayName: 'iPhone 3GS',
  },
  iphone_4: {
    id: 'iphone_4',
    displayName: 'iPhone 4',
  },
  ipad_1: {
    id: 'ipad_1',
    displayName: 'iPad (1st Generation)',
  },
};

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
  const metadata = IPOD_GENERATIONS[generation as IpodGeneration];
  return metadata?.displayName ?? generation;
}

/**
 * Get the video device profile for a generation.
 *
 * Returns undefined for generations that don't support video playback.
 *
 * @param generation - Generation identifier from libgpod
 * @returns Video profile name, or undefined if generation doesn't support video
 *
 * @example
 * ```typescript
 * getVideoProfile('classic_3');  // 'ipod-classic'
 * getVideoProfile('nano_3');     // 'ipod-nano-3g'
 * getVideoProfile('nano_1');     // undefined (no video support)
 * ```
 */
export function getVideoProfile(
  generation: IpodGeneration
): 'ipod-video-5g' | 'ipod-classic' | 'ipod-nano-3g' | undefined;
export function getVideoProfile(generation: string): string | undefined;
export function getVideoProfile(generation: string): string | undefined {
  const metadata = IPOD_GENERATIONS[generation as IpodGeneration];
  return metadata?.videoProfile;
}

/**
 * Check if a generation supports video playback.
 *
 * @param generation - Generation identifier from libgpod
 * @returns True if the generation supports video
 *
 * @example
 * ```typescript
 * supportsVideo('classic_3');  // true
 * supportsVideo('nano_1');     // false
 * ```
 */
export function supportsVideo(generation: IpodGeneration): boolean;
export function supportsVideo(generation: string): boolean;
export function supportsVideo(generation: string): boolean {
  return getVideoProfile(generation) !== undefined;
}
