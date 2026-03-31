/**
 * Music planning utilities
 *
 * Source categorization, size estimation, and device compatibility helpers
 * used by MusicTrackClassifier, MusicHandler, and MusicOperationFactory.
 *
 * ## Source File Categories
 *
 * When `DeviceCapabilities.supportedAudioCodecs` is provided, the classifier
 * checks whether the source codec is natively supported by the device. If yes,
 * the file is copied as-is regardless of category. Otherwise:
 *
 * | Category | Formats | Behavior |
 * |----------|---------|----------|
 * | **Lossless** | FLAC, WAV, AIFF, ALAC | Transcode to target preset |
 * | **Compatible Lossy** | MP3, M4A (AAC) | Copy as-is (no re-encoding) |
 * | **Incompatible Lossy** | OGG, Opus | Transcode + lossy→lossy warning |
 *
 * @module
 */

import type { CollectionTrack } from '../../adapters/interface.js';
import type { AudioFileType, TrackMetadata } from '../../types.js';
import type { AudioCodec } from '../../device/capabilities.js';
import { getPresetBitrate } from '../../transcode/types.js';
import { replayGainToSoundcheck } from '../../metadata/normalization.js';
import type { MetadataChange, SourceCategory } from '../engine/types.js';
import type { MusicOperation } from './types.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * Default compatible audio formats when no DeviceCapabilities are provided.
 *
 * These are the formats that can be copied directly without transcoding.
 * When a device provides supportedAudioCodecs via capabilities, those
 * take priority via isDeviceCompatible() instead.
 *
 * - mp3: MPEG Audio Layer 3 - universally supported
 * - m4a: AAC in MP4 container - native iTunes format
 * - aac: Raw AAC - supported but less common
 * - alac: Apple Lossless
 */
const DEFAULT_COMPATIBLE_FORMATS: Set<AudioFileType> = new Set(['mp3', 'm4a', 'aac', 'alac']);

/**
 * Formats that require transcoding to a compatible format
 *
 * - flac: Free Lossless Audio Codec - needs transcoding
 * - ogg: Ogg Vorbis - needs transcoding
 * - opus: Opus codec - needs transcoding
 * - wav: Uncompressed PCM - needs transcoding (and would waste space)
 * - aiff: Audio Interchange File Format - needs transcoding
 */
const TRANSCODE_REQUIRED_FORMATS: Set<AudioFileType> = new Set([
  'flac',
  'ogg',
  'opus',
  'wav',
  'aiff',
]);

/**
 * Lossy formats that are NOT natively compatible (require lossy→lossy conversion)
 */
const INCOMPATIBLE_LOSSY_FORMATS: Set<AudioFileType> = new Set(['ogg', 'opus']);

/**
 * Average overhead for M4A container (headers, atoms, etc.)
 * This is added to the calculated audio data size
 */
const M4A_CONTAINER_OVERHEAD_BYTES = 2048;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if an audio format is compatible by default (can be copied directly).
 *
 * This is the fallback when no DeviceCapabilities are provided.
 * When capabilities are available, use isDeviceCompatible() instead.
 */
export function isDefaultCompatibleFormat(fileType: AudioFileType): boolean {
  return DEFAULT_COMPATIBLE_FORMATS.has(fileType);
}

/**
 * Check if an audio format requires transcoding
 */
export function requiresTranscoding(fileType: AudioFileType): boolean {
  return TRANSCODE_REQUIRED_FORMATS.has(fileType);
}

/**
 * Map a track's file type and codec to the AudioCodec used in device capabilities.
 *
 * - m4a/aac files: use the codec field to distinguish AAC vs ALAC
 * - Other file types map directly to AudioCodec names
 *
 * Returns undefined if the file type cannot be mapped (unknown format).
 */
export function fileTypeToAudioCodec(
  fileType: AudioFileType,
  codec?: string
): AudioCodec | undefined {
  switch (fileType) {
    case 'mp3':
      return 'mp3';
    case 'flac':
      return 'flac';
    case 'ogg':
      return 'ogg';
    case 'opus':
      return 'opus';
    case 'wav':
      return 'wav';
    case 'aiff':
      return 'aiff';
    case 'alac':
      return 'alac';
    case 'm4a':
    case 'aac':
      // M4A can be AAC or ALAC — check codec field
      if (codec?.toLowerCase() === 'alac') return 'alac';
      return 'aac';
    default:
      return undefined;
  }
}

/**
 * Check if a track's format is natively supported by the device.
 *
 * When the device provides a supportedAudioCodecs list, this checks whether
 * the track's codec is in that list. This is used to skip transcoding for
 * devices that support formats like FLAC, OGG, etc. natively.
 *
 * @returns true if the device can play this track without transcoding
 */
export function isDeviceCompatible(
  track: CollectionTrack,
  supportedCodecs: AudioCodec[] | undefined
): boolean {
  if (!supportedCodecs || supportedCodecs.length === 0) {
    return false;
  }
  const codec = fileTypeToAudioCodec(track.fileType, track.codec);
  return codec !== undefined && supportedCodecs.includes(codec);
}

// =============================================================================
// Source Categorization
// =============================================================================

/**
 * Categorize a track's source format for transcoding decisions
 *
 * Categories:
 * - lossless: FLAC, WAV, AIFF, ALAC - can convert to any target
 * - compatible-lossy: MP3, AAC/M4A - natively playable, copy as-is
 * - incompatible-lossy: OGG, Opus - must transcode (lossy→lossy warning)
 *
 * Note: M4A files can be either AAC (lossy) or ALAC (lossless).
 * Uses the codec field for accurate detection.
 *
 * When `supportedCodecs` is provided, lossy categorization is device-aware:
 * a lossy source whose codec is in the device's supported list is `compatible-lossy`,
 * otherwise it's `incompatible-lossy`. When `supportedCodecs` is undefined, falls
 * back to hardcoded iPod-centric sets (MP3/AAC compatible, OGG/Opus incompatible).
 *
 * Lossless sources are always categorized as `lossless` regardless of device support.
 */
export function categorizeSource(
  track: CollectionTrack,
  supportedCodecs?: readonly string[]
): SourceCategory {
  // Check if explicitly marked as lossless
  if (track.lossless === true) {
    return 'lossless';
  }

  // Unambiguously lossless by file extension
  if (['flac', 'wav', 'aiff'].includes(track.fileType)) {
    return 'lossless';
  }

  // ALAC extension is unambiguously lossless
  if (track.fileType === 'alac') {
    return 'lossless';
  }

  // M4A/AAC requires codec detection (could be AAC or ALAC)
  if (track.fileType === 'm4a' || track.fileType === 'aac') {
    if (track.codec?.toLowerCase() === 'alac') {
      return 'lossless';
    }
    // Fall through to lossy categorization below
  }

  // --- Lossy categorization ---
  // When supportedCodecs is provided, use device-aware categorization.
  // When undefined, fall back to hardcoded iPod-centric sets.
  if (supportedCodecs !== undefined) {
    const trackCodec = fileTypeToAudioCodec(track.fileType, track.codec);
    if (trackCodec && supportedCodecs.includes(trackCodec)) {
      return 'compatible-lossy';
    }
    // Device doesn't support this lossy codec
    return 'incompatible-lossy';
  }

  // Legacy fallback: hardcoded iPod-centric categorization
  if (INCOMPATIBLE_LOSSY_FORMATS.has(track.fileType)) {
    return 'incompatible-lossy';
  }

  if (track.fileType === 'mp3') {
    return 'compatible-lossy';
  }

  // M4A/AAC (lossy) is compatible for iPod
  if (track.fileType === 'm4a' || track.fileType === 'aac') {
    return 'compatible-lossy';
  }

  // Unknown formats: treat as incompatible (safe default, triggers warning)
  return 'incompatible-lossy';
}

/**
 * Check if a source category is lossless
 */
export function isLosslessSource(category: SourceCategory): boolean {
  return category === 'lossless';
}

/**
 * Check if a source will produce a lossy-to-lossy warning
 */
export function willWarnLossyToLossy(category: SourceCategory): boolean {
  return category === 'incompatible-lossy';
}

/**
 * Estimate output file size for a transcoded track
 *
 * Formula: (duration_ms / 1000) * (bitrate_kbps / 8) * 1000 + overhead
 *        = (duration_ms * bitrate_kbps) / 8 + overhead
 *
 * @param durationMs - Track duration in milliseconds
 * @param bitrateKbps - Target bitrate in kilobits per second
 * @returns Estimated file size in bytes
 */
export function estimateTranscodedSize(durationMs: number, bitrateKbps: number): number {
  // Convert: duration(ms) * bitrate(kbps) / 8 = bytes
  // duration_ms / 1000 = seconds
  // bitrate_kbps * 1000 / 8 = bytes per second
  const audioBytes = (durationMs / 1000) * ((bitrateKbps * 1000) / 8);
  return Math.ceil(audioBytes + M4A_CONTAINER_OVERHEAD_BYTES);
}

/**
 * Estimate size for a track that will be copied directly
 *
 * For compatible formats, we need to estimate based on existing bitrate
 * if available, or use duration with assumed bitrate.
 *
 * @param track - The collection track to estimate
 * @returns Estimated file size in bytes
 */
export function estimateCopySize(track: CollectionTrack): number {
  // If duration is available, estimate based on typical bitrate for format
  if (track.duration && track.duration > 0) {
    // Assume typical bitrates for different formats
    let typicalBitrateKbps: number;
    switch (track.fileType) {
      case 'mp3':
        typicalBitrateKbps = 256;
        break;
      case 'm4a':
      case 'aac':
        typicalBitrateKbps = 256;
        break;
      case 'alac':
        // ALAC is lossless, typically ~800-1000 kbps for CD quality
        typicalBitrateKbps = 900;
        break;
      case 'flac':
        // FLAC is lossless, typically ~900 kbps for CD quality
        typicalBitrateKbps = 900;
        break;
      case 'ogg':
      case 'opus':
        typicalBitrateKbps = 192;
        break;
      case 'wav':
      case 'aiff':
        // Uncompressed audio, ~1411 kbps for CD quality (16-bit/44.1kHz stereo)
        typicalBitrateKbps = 1411;
        break;
      default:
        typicalBitrateKbps = 256;
    }
    return estimateTranscodedSize(track.duration, typicalBitrateKbps);
  }

  // Fallback: assume 4 minutes at 256 kbps
  return estimateTranscodedSize(240000, 256);
}

// =============================================================================
// Planning Utilities
// =============================================================================

/**
 * Convert MetadataChange array to Partial<TrackMetadata>
 *
 * Extracts the 'to' values from each change to create the target metadata.
 */
export function changesToMetadata(changes: MetadataChange[]): Partial<TrackMetadata> {
  const metadata: Partial<TrackMetadata> = {};

  for (const change of changes) {
    switch (change.field) {
      case 'artist':
        metadata.artist = change.to;
        break;
      case 'title':
        metadata.title = change.to;
        break;
      case 'album':
        metadata.album = change.to;
        break;
      case 'albumArtist':
        metadata.albumArtist = change.to;
        break;
      case 'genre':
        metadata.genre = change.to;
        break;
      case 'year':
        metadata.year = change.to ? Number(change.to) : undefined;
        break;
      case 'trackNumber':
        metadata.trackNumber = change.to ? Number(change.to) : undefined;
        break;
      case 'discNumber':
        metadata.discNumber = change.to ? Number(change.to) : undefined;
        break;
      case 'compilation':
        metadata.compilation = change.to === 'true';
        break;
      case 'normalization': {
        // Reconstruct AudioNormalization from the dB string display value.
        // The 'to' field contains a string like "-7.0 dB" or "absent".
        const dbStr = change.to;
        if (dbStr && dbStr !== 'absent') {
          const db = parseFloat(dbStr);
          if (!isNaN(db)) {
            metadata.normalization = {
              source: 'replaygain-track',
              trackGain: db,
              soundcheckValue: replayGainToSoundcheck(db),
            };
          }
        }
        break;
      }
    }
  }

  return metadata;
}

/**
 * Calculate estimated size for an operation
 */
export function calculateMusicOperationSize(operation: MusicOperation): number {
  switch (operation.type) {
    case 'add-transcode': {
      const duration = operation.source.duration ?? 240000; // default 4 min
      const bitrate = operation.preset.bitrateOverride ?? getPresetBitrate(operation.preset.name);
      return estimateTranscodedSize(duration, bitrate);
    }
    case 'add-direct-copy':
    case 'add-optimized-copy': {
      return estimateCopySize(operation.source);
    }
    case 'upgrade-transcode': {
      const duration = operation.source.duration ?? 240000;
      const bitrate = operation.preset.bitrateOverride ?? getPresetBitrate(operation.preset.name);
      return estimateTranscodedSize(duration, bitrate);
    }
    case 'upgrade-direct-copy':
    case 'upgrade-optimized-copy': {
      return estimateCopySize(operation.source);
    }
    case 'upgrade-artwork': {
      // artwork-updated only transfers artwork bytes (~200KB), not the whole track
      if (operation.reason === 'artwork-updated') {
        return 200 * 1024;
      }
      // artwork-removed is metadata-only (no file transfer)
      return 0;
    }
    case 'remove':
    case 'update-metadata':
    case 'update-sync-tag':
    case 'relocate':
      // These operations free space or just move files — no new space consumed
      return 0;
  }
}
