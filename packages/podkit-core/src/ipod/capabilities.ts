/**
 * iPod device capabilities
 *
 * Derives DeviceCapabilities from iPod generation metadata.
 * The shared type definitions live in `@podkit/device-types`.
 */

import type { IpodGeneration } from '@podkit/libgpod-node';
import { IPOD_GENERATIONS } from './generation.js';
import { getVideoProfile } from './generation.js';
import type { AudioCodec, DeviceArtworkSource, DeviceCapabilities } from '@podkit/device-types';

// =============================================================================
// Artwork Resolution
// =============================================================================

/**
 * Get the maximum artwork display resolution for an iPod generation.
 *
 * Returns 0 for devices without a color screen (shuffles, minis, early iPods).
 *
 * @param generation - Generation identifier from libgpod
 * @returns Maximum artwork dimension in pixels (square), or 0 if no artwork support
 */
/**
 * Maximum artwork resolution per iPod generation.
 *
 * Values based on device screen dimensions. This table is also
 * maintained in capability-adapter.ts (LIBGPOD_ARTWORK_RESOLUTION) which
 * is the primary path for connected devices via libgpod. This copy
 * serves as a fallback for generation-only capability queries.
 */
const ARTWORK_RESOLUTION: Partial<Record<IpodGeneration, number>> = {
  // Classic/Video — 320x240 screen
  classic_1: 320,
  classic_2: 320,
  classic_3: 320,
  video_1: 320,
  video_2: 320,

  // Nano — varies by generation
  nano_1: 176,
  nano_2: 176,
  nano_3: 320, // 320x240 widescreen
  nano_4: 240, // 240x320
  nano_5: 240, // 240x376
  nano_6: 240, // 240x240

  // Photo — ArtworkDB stores 320x240
  photo: 320,

  // Touch/iPhone/iPad — 320x480+
  touch_1: 320,
  touch_2: 320,
  touch_3: 320,
  touch_4: 320,
  iphone_1: 320,
  iphone_2: 320,
  iphone_3: 320,
  iphone_4: 320,
  ipad_1: 320,
};

function getArtworkMaxResolution(generation: IpodGeneration): number {
  return ARTWORK_RESOLUTION[generation] ?? 0;
}

// =============================================================================
// Device Capabilities
// =============================================================================

/**
 * Get device capabilities for an iPod generation.
 *
 * Derives capabilities from the generation metadata in {@link IPOD_GENERATIONS},
 * including audio codec support, video capability, and artwork handling.
 *
 * @param generation - Generation identifier from libgpod
 * @returns Device capabilities for sync engine decisions
 *
 * @example
 * ```typescript
 * const caps = getDeviceCapabilities('classic_3');
 * if (caps.supportedAudioCodecs.includes('alac')) {
 *   // Can send lossless audio
 * }
 * ```
 */
export function getDeviceCapabilities(generation: IpodGeneration): DeviceCapabilities;
export function getDeviceCapabilities(generation: string): DeviceCapabilities;
export function getDeviceCapabilities(generation: string): DeviceCapabilities {
  const metadata = IPOD_GENERATIONS[generation as IpodGeneration];

  // Base audio codecs all iPods support
  const supportedAudioCodecs: AudioCodec[] = ['aac', 'mp3'];

  // ALAC-capable devices also support WAV and AIFF
  if (metadata?.supportsAlac) {
    supportedAudioCodecs.push('alac', 'wav', 'aiff');
  }

  const supportsVideo = getVideoProfile(generation) !== undefined;

  // Determine artwork capabilities
  const artworkMaxResolution = getArtworkMaxResolution(generation as IpodGeneration);
  const artworkSources: DeviceArtworkSource[] = artworkMaxResolution > 0 ? ['database'] : [];

  return {
    artworkSources,
    artworkMaxResolution,
    supportedAudioCodecs,
    supportsVideo,
    audioNormalization: 'soundcheck',
    supportsAlbumArtistBrowsing: false,
  };
}
