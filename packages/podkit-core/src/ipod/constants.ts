/**
 * Constants for iPod database operations.
 */

/**
 * Media type flags for tracks.
 *
 * These flags indicate the type of media content. Multiple flags can be
 * combined using bitwise OR for tracks that fit multiple categories.
 *
 * @example
 * ```typescript
 * import { MediaType } from '@podkit/core';
 *
 * // Audio track (most common)
 * const audioTrack = { mediaType: MediaType.Audio };
 *
 * // Podcast episode
 * const podcastEpisode = { mediaType: MediaType.Podcast };
 *
 * // Audiobook
 * const audiobook = { mediaType: MediaType.Audiobook };
 * ```
 */
export const MediaType = {
  /** Standard audio track (music) */
  Audio: 0x0001,
  /** Movie */
  Movie: 0x0002,
  /** Podcast episode */
  Podcast: 0x0004,
  /** Audiobook */
  Audiobook: 0x0008,
  /** Music video */
  MusicVideo: 0x0020,
  /** TV show episode */
  TVShow: 0x0040,
} as const;

/**
 * Type representing valid media type values.
 */
export type MediaTypeValue = (typeof MediaType)[keyof typeof MediaType];
