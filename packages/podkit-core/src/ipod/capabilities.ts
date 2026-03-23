/**
 * Device capabilities abstraction
 *
 * Allows the sync engine to make device-aware decisions without
 * knowing which specific device is connected.
 */

import type { IpodGeneration } from '@podkit/libgpod-node';
import { IPOD_GENERATIONS } from './generation.js';
import { getVideoProfile } from './generation.js';

// =============================================================================
// Types
// =============================================================================

/** Where the device reads artwork from */
export type DeviceArtworkSource = 'database' | 'embedded' | 'sidecar';

/** Audio codecs a device can play natively */
export type AudioCodec = 'aac' | 'alac' | 'mp3' | 'flac' | 'ogg' | 'opus' | 'wav' | 'aiff';

/** Device capabilities for sync engine decisions */
export interface DeviceCapabilities {
  /** Where the device reads artwork from, ordered by priority (first = preferred) */
  artworkSources: DeviceArtworkSource[];
  /** Maximum artwork display resolution in pixels (width = height, square) */
  artworkMaxResolution: number;
  /** Audio codecs the device can play natively without transcoding */
  supportedAudioCodecs: AudioCodec[];
  /** Whether the device supports video playback */
  supportsVideo: boolean;
}

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
function getArtworkMaxResolution(generation: IpodGeneration): number {
  switch (generation) {
    // Color screen, large display (320x240 or similar)
    case 'classic_1':
    case 'classic_2':
    case 'classic_3':
    case 'video_1':
    case 'video_2':
      return 320;

    // Color screen, smaller display
    case 'nano_1':
    case 'nano_2':
    case 'nano_3':
    case 'nano_4':
    case 'nano_5':
    case 'nano_6':
    case 'photo':
      return 176;

    // Touch devices (color, large)
    case 'touch_1':
    case 'touch_2':
    case 'touch_3':
    case 'touch_4':
    case 'iphone_1':
    case 'iphone_2':
    case 'iphone_3':
    case 'iphone_4':
    case 'ipad_1':
      return 320;

    // No color screen or no screen
    case 'first':
    case 'second':
    case 'third':
    case 'fourth':
    case 'mini_1':
    case 'mini_2':
    case 'mobile':
    case 'shuffle_1':
    case 'shuffle_2':
    case 'shuffle_3':
    case 'shuffle_4':
    case 'unknown':
    default:
      return 0;
  }
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
  };
}
