/**
 * Constants for iPod database operations.
 */

/**
 * Media type flags for tracks.
 *
 * Curated subset of commonly-used media types for iPod content.
 * This is intentionally different from the complete MediaType in @podkit/libgpod-node,
 * which includes all libgpod types (Ringtone, ITunesU, EpubBook, etc.).
 *
 * Design rationale:
 * - @podkit/libgpod-node: Complete low-level bindings (all types)
 * - @podkit/core: User-facing API (common types with documentation)
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

/**
 * Content type for bulk operations (clear, etc.).
 */
export type ContentType = 'music' | 'video';

/**
 * All valid content type names
 */
export const CONTENT_TYPES: readonly ContentType[] = ['music', 'video'] as const;

/**
 * Checks if a media type represents music content.
 *
 * Music is identified as audio tracks that are NOT video, podcast, or audiobook.
 */
export function isMusicMediaType(mediaType: number): boolean {
  // Music is audio that's not a podcast, audiobook, or video
  const isAudio = (mediaType & MediaType.Audio) !== 0;
  const isPodcast = (mediaType & MediaType.Podcast) !== 0;
  const isAudiobook = (mediaType & MediaType.Audiobook) !== 0;
  // Inline video check to avoid importing from video.ts (circular dependency)
  const isVideo =
    (mediaType & MediaType.Movie) !== 0 ||
    (mediaType & MediaType.TVShow) !== 0 ||
    (mediaType & MediaType.MusicVideo) !== 0;

  return isAudio && !isPodcast && !isAudiobook && !isVideo;
}
