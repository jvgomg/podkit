/**
 * Audio normalization conversion utilities
 *
 * Provides the AudioNormalization type and extraction/conversion functions
 * for volume normalization data (ReplayGain, iTunNORM/Sound Check).
 *
 * Design principle: normalization data is stored in its native source format.
 * Conversions to device-specific formats (iPod soundcheck integers, ReplayGain
 * dB tags) happen at device boundaries, not in the core data model.
 *
 * @module
 */

import type { IAudioMetadata } from 'music-metadata';

/** Source of audio normalization data */
export type NormalizationSource = 'itunes-soundcheck' | 'replaygain-track' | 'replaygain-album';

/** Audio normalization data in its native source format */
export interface AudioNormalization {
  /** Which tag format was the primary source */
  source: NormalizationSource;
  /** ReplayGain track gain in dB (e.g., -7.5) */
  trackGain?: number;
  /** ReplayGain track peak, linear scale (e.g., 0.988) */
  trackPeak?: number;
  /** ReplayGain album gain in dB — reserved for TASK-253 */
  albumGain?: number;
  /** ReplayGain album peak, linear scale — reserved for TASK-253 */
  albumPeak?: number;
  /** iPod Sound Check integer (from iTunNORM or computed from ReplayGain) */
  soundcheckValue?: number;
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
 * Convert an iPod soundcheck value back to ReplayGain dB.
 *
 * Inverse of replayGainToSoundcheck():
 *   soundcheck = 1000 * 10^(gain / -10)
 *   gain = -10 * log10(soundcheck / 1000)
 *
 * Note: slight rounding differences since soundcheck is an integer.
 *
 * @param soundcheck - Soundcheck value (guint32)
 * @returns ReplayGain value in decibels
 */
export function soundcheckToReplayGainDb(soundcheck: number): number {
  return -10 * Math.log10(soundcheck / 1000);
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
 * Extract audio normalization data from parsed file metadata.
 *
 * Priority: iTunNORM > ReplayGain track gain > ReplayGain album gain
 *
 * Unlike the old extractSoundcheck(), this preserves the native format:
 * - iTunNORM source: sets soundcheckValue (native format) + trackGain (back-converted for display)
 * - ReplayGain source: sets trackGain + trackPeak (native format) + soundcheckValue (computed for iPod compat)
 *
 * @param metadata - Parsed audio metadata from music-metadata
 * @returns normalization data with source info, or null if no normalization data found
 */
export function extractNormalization(metadata: IAudioMetadata): AudioNormalization | null {
  // 1. Try iTunNORM from native tags
  const iTunNORM = findITunNORM(metadata);
  if (iTunNORM !== null) {
    const sc = iTunNORMToSoundcheck(iTunNORM);
    if (sc !== null) {
      return {
        source: 'itunes-soundcheck',
        soundcheckValue: sc,
        trackGain: soundcheckToReplayGainDb(sc),
      };
    }
  }

  // 2. Try ReplayGain track gain
  const trackGain = metadata.common.replaygain_track_gain;
  if (trackGain?.dB !== undefined) {
    return {
      source: 'replaygain-track',
      trackGain: trackGain.dB,
      trackPeak: metadata.common.replaygain_track_peak?.ratio,
      albumGain: metadata.common.replaygain_album_gain?.dB,
      albumPeak: metadata.common.replaygain_album_peak?.ratio,
      soundcheckValue: replayGainToSoundcheck(trackGain.dB),
    };
  }

  // 3. Try ReplayGain album gain as fallback
  const albumGain = metadata.common.replaygain_album_gain;
  if (albumGain?.dB !== undefined) {
    return {
      source: 'replaygain-album',
      trackGain: albumGain.dB,
      trackPeak: metadata.common.replaygain_album_peak?.ratio,
      albumGain: albumGain.dB,
      albumPeak: metadata.common.replaygain_album_peak?.ratio,
      soundcheckValue: replayGainToSoundcheck(albumGain.dB),
    };
  }

  return null;
}

/**
 * Get the normalization value in dB (for comparison and display).
 * Prefers trackGain if available, otherwise back-converts from soundcheckValue.
 */
export function normalizationToDb(norm: AudioNormalization): number | undefined {
  if (norm.trackGain !== undefined) {
    return norm.trackGain;
  }
  if (norm.soundcheckValue !== undefined) {
    return soundcheckToReplayGainDb(norm.soundcheckValue);
  }
  return undefined;
}

/**
 * Get the iPod soundcheck integer from normalization data.
 * Returns soundcheckValue if present, otherwise converts from trackGain.
 */
export function normalizationToSoundcheck(norm: AudioNormalization): number | undefined {
  if (norm.soundcheckValue !== undefined) {
    return norm.soundcheckValue;
  }
  if (norm.trackGain !== undefined) {
    return replayGainToSoundcheck(norm.trackGain);
  }
  return undefined;
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
