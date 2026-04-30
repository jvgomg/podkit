/**
 * Capability adapter — creates core DeviceCapabilities from libgpod device data.
 *
 * libgpod is the source of truth for:
 *   - supportsVideo, supportsArtwork, supportsPhoto, supportsPodcast
 *   - generation, modelNumber, modelName
 *
 * Supplemented by generation metadata for:
 *   - artworkMaxResolution (libgpod's internal API is not exported)
 *   - supportedAudioCodecs (libgpod has no codec capability API)
 *   - audioNormalization (always 'soundcheck' for iPods)
 *   - artworkSources (always 'database' for iPods with artwork)
 *   - supportsAlbumArtistBrowsing (always false for stock iPod firmware)
 *
 * @module
 */

import type { IpodGeneration } from '@podkit/libgpod-node';
import type { DeviceCapabilities, AudioCodec, DeviceArtworkSource } from './capabilities.js';
import { IPOD_GENERATIONS } from '../ipod/generation.js';

// =============================================================================
// Types
// =============================================================================

/** The subset of libgpod Device capabilities needed by the adapter */
export interface LibgpodDeviceInfo {
  readonly supportsArtwork: boolean;
  readonly supportsVideo: boolean;
  readonly generation: string;
  readonly modelNumber?: string | null;
}

// =============================================================================
// Artwork resolution by generation (supplemental data)
// =============================================================================

/**
 * Maximum artwork resolution per iPod generation.
 *
 * This supplements libgpod which knows WHETHER a device supports artwork
 * but doesn't export the resolution (itdb_device_get_cover_art_formats
 * is G_GNUC_INTERNAL). Values based on device screen dimensions.
 */
const ARTWORK_MAX_RESOLUTION: Partial<Record<IpodGeneration, number>> = {
  // Classic/Video — 320x240 screen
  classic_1: 320,
  classic_2: 320,
  classic_3: 320,
  video_1: 320,
  video_2: 320,

  // Nano — varies by generation
  nano_1: 176, // 176x132
  nano_2: 176, // 176x132
  nano_3: 320, // 320x240
  nano_4: 240, // 240x320
  nano_5: 240, // 240x376
  nano_6: 240, // 240x240

  // Photo — 220x176 screen, ArtworkDB stores 320x240
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

// =============================================================================
// Adapter
// =============================================================================

/**
 * Create core DeviceCapabilities from libgpod device info.
 *
 * Uses libgpod as the authority for video and artwork support,
 * then supplements codec support and artwork resolution from
 * generation metadata.
 */
export function createIpodCapabilities(device: LibgpodDeviceInfo): DeviceCapabilities {
  const generation = device.generation as IpodGeneration;
  const metadata = IPOD_GENERATIONS[generation];

  // Audio codecs — all iPods support AAC and MP3
  const supportedAudioCodecs: AudioCodec[] = ['aac', 'mp3'];
  if (metadata?.supportsAlac) {
    supportedAudioCodecs.push('alac', 'wav', 'aiff');
  }

  // Artwork — use libgpod for support flag, supplement resolution from table
  const artworkMaxResolution = device.supportsArtwork
    ? (ARTWORK_MAX_RESOLUTION[generation] ?? 0)
    : 0;
  const artworkSources: DeviceArtworkSource[] = device.supportsArtwork ? ['database'] : [];

  return {
    artworkSources,
    artworkMaxResolution,
    supportedAudioCodecs,
    supportsVideo: device.supportsVideo,
    audioNormalization: 'soundcheck',
    supportsAlbumArtistBrowsing: false,
  };
}
