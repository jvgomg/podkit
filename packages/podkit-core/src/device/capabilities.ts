/**
 * Device capabilities types
 *
 * Shared type definitions for device capabilities, used by the sync engine
 * to make device-aware decisions without knowing which specific device
 * is connected.
 *
 * The iPod-specific `getDeviceCapabilities()` function lives in
 * `ipod/capabilities.ts` — it imports these types and returns
 * a populated `DeviceCapabilities` for a given iPod generation.
 *
 * @module
 */

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
