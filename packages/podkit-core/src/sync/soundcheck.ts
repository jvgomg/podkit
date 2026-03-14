/**
 * Sound Check (volume normalization) conversion utilities
 *
 * Converts ReplayGain and iTunNORM values to iPod soundcheck format.
 * The iPod firmware reads the soundcheck value from the iTunesDB and
 * applies gain during playback for volume normalization.
 *
 * @module
 */

import type { IAudioMetadata } from 'music-metadata';
import type { SoundCheckSource } from '../adapters/interface.js';

/**
 * Result of extracting a soundcheck value, including the source tag format.
 */
export interface SoundCheckResult {
  /** Soundcheck value (guint32) */
  value: number;
  /** Which tag format the value was extracted from */
  source: SoundCheckSource;
}

/**
 * Convert a ReplayGain value (in dB) to iPod soundcheck format.
 *
 * The soundcheck value is stored as a guint32 in the iTunesDB.
 * Formula: 1000 * 10^(gain / -10)
 *
 * - 0 dB gain → soundcheck 1000 (unity gain)
 * - Negative gain (loud track) → soundcheck > 1000 (reduce volume)
 * - Positive gain (quiet track) → soundcheck < 1000 (increase volume)
 *
 * @param gainDb - ReplayGain value in decibels
 * @returns soundcheck value (guint32)
 */
export function replayGainToSoundcheck(gainDb: number): number {
  return Math.round(1000 * Math.pow(10, gainDb / -10));
}

/**
 * Parse an iTunNORM string to extract the soundcheck value.
 *
 * iTunNORM is a string of 10 space-separated hex values stored in
 * iTunes-style tags. Fields 0 and 1 are the soundcheck values for
 * the left and right audio channels respectively.
 *
 * We take the maximum of the two channel values, which matches
 * iTunes/iPod behavior (use the louder channel for normalization).
 *
 * @param normString - Raw iTunNORM tag value
 * @returns soundcheck value, or null if parsing fails
 */
export function iTunNORMToSoundcheck(normString: string): number | null {
  // iTunNORM format: " 00000A2B 00000A2B 00003F7C 00003F7C 00000000 00000000 00007FFF 00007FFF 00000000 00000000"
  // Trim and split on whitespace
  const parts = normString.trim().split(/\s+/);

  if (parts.length < 2) {
    return null;
  }

  const left = parseInt(parts[0]!, 16);
  const right = parseInt(parts[1]!, 16);

  if (isNaN(left) || isNaN(right)) {
    return null;
  }

  // Take the max of left and right channels
  return Math.max(left, right);
}

/**
 * Extract a soundcheck value from audio file metadata.
 *
 * Priority order:
 * 1. iTunNORM tag (native iTunes normalization, most accurate for iPod)
 * 2. ReplayGain track gain (from common metadata)
 * 3. ReplayGain album gain (fallback)
 *
 * @param metadata - Parsed audio metadata from music-metadata
 * @returns soundcheck result with value and source, or null if no normalization data found
 */
export function extractSoundcheck(metadata: IAudioMetadata): SoundCheckResult | null {
  // 1. Try iTunNORM from native tags
  const iTunNORM = findITunNORM(metadata);
  if (iTunNORM !== null) {
    const sc = iTunNORMToSoundcheck(iTunNORM);
    if (sc !== null) {
      return { value: sc, source: 'iTunNORM' };
    }
  }

  // 2. Try ReplayGain track gain
  const trackGain = metadata.common.replaygain_track_gain;
  if (trackGain?.dB !== undefined) {
    return { value: replayGainToSoundcheck(trackGain.dB), source: 'replayGain_track' };
  }

  // 3. Try ReplayGain album gain as fallback
  const albumGain = metadata.common.replaygain_album_gain;
  if (albumGain?.dB !== undefined) {
    return { value: replayGainToSoundcheck(albumGain.dB), source: 'replayGain_album' };
  }

  return null;
}

/**
 * Find iTunNORM value in native tags across different formats.
 *
 * Where iTunNORM lives in different tag formats:
 * - MP3 (ID3v2): TXXX:iTunNORM or COMM:iTunNORM
 * - M4A (MP4): ----:com.apple.iTunes:iTunNORM
 * - FLAC/Vorbis: iTunNORM comment field (less common)
 */
function findITunNORM(metadata: IAudioMetadata): string | null {
  if (!metadata.native) {
    return null;
  }

  for (const [format, tags] of Object.entries(metadata.native)) {
    for (const tag of tags) {
      // ID3v2: TXXX:iTunNORM
      if (tag.id === 'TXXX:iTunNORM' && typeof tag.value === 'string') {
        return tag.value;
      }

      // ID3v2: COMM:iTunNORM (less common)
      if (tag.id === 'COMM:iTunNORM' && typeof tag.value === 'string') {
        return tag.value;
      }

      // MP4/M4A: ----:com.apple.iTunes:iTunNORM
      if (tag.id === '----:com.apple.iTunes:iTunNORM' && typeof tag.value === 'string') {
        return tag.value;
      }

      // Vorbis/FLAC: iTunNORM (case-insensitive check)
      if (
        format.startsWith('vorbis') &&
        tag.id.toLowerCase() === 'itunnorm' &&
        typeof tag.value === 'string'
      ) {
        return tag.value;
      }
    }
  }

  return null;
}
