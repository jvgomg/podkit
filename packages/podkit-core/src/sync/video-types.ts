/**
 * Video types and match key generation
 *
 * Provides the `DeviceVideo` interface (device-side video representation)
 * and `generateVideoMatchKey` for matching collection videos to device videos.
 *
 * @module
 */

import type { ContentType } from '../video/metadata.js';
import type { SyncTagData } from './sync-tags.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Representation of a video on the device
 *
 * This is the device-side video data used for diff comparison.
 */
export interface DeviceVideo {
  /** Unique identifier on device (dbid or similar) */
  id: string;

  /** Path to video file on device */
  filePath: string;

  /** Content type: movie or tvshow */
  contentType: ContentType;

  /** Video title */
  title: string;

  /** Release year (for matching) */
  year?: number;

  /** Series title (for TV shows) */
  seriesTitle?: string;

  /** Season number (for TV shows) */
  seasonNumber?: number;

  /** Episode number (for TV shows) */
  episodeNumber?: number;

  /** Duration in seconds */
  duration?: number;

  /** Combined video+audio bitrate in kbps (from device database) */
  bitrate?: number;

  /** Comment field from device database (may contain sync tags) */
  comment?: string;

  /** Pre-computed sync tag data (parsed from comment field) */
  syncTag?: SyncTagData | null;
}

// =============================================================================
// Match Key Generation
// =============================================================================

/**
 * Normalize a string for comparison (lowercase, trim, remove special chars)
 *
 * Note: This is intentionally different from matching.ts normalizeString which
 * handles Unicode/accents for music matching. Video matching strips punctuation
 * for more forgiving title comparison.
 */
function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '') // Remove special characters
    .replace(/\s+/g, ' '); // Normalize whitespace
}

/**
 * Generate a match key for a movie
 *
 * Format: "movie:title" or "movie:title:year" if year is available
 */
function generateMovieKey(title: string, year?: number): string {
  const normalizedTitle = normalizeString(title);
  if (year && year > 1800 && year < 2100) {
    return `movie:${normalizedTitle}:${year}`;
  }
  return `movie:${normalizedTitle}`;
}

/**
 * Generate a match key for a TV episode
 *
 * Format: "tvshow:series:sXXeYY" where XX is season, YY is episode
 */
function generateTVShowKey(
  seriesTitle: string | undefined,
  title: string,
  seasonNumber?: number,
  episodeNumber?: number
): string {
  // Use series title if available, otherwise use episode title
  const series = seriesTitle ? normalizeString(seriesTitle) : normalizeString(title);

  // If we have season and episode numbers, include them
  if (seasonNumber !== undefined && episodeNumber !== undefined) {
    const season = String(seasonNumber).padStart(2, '0');
    const episode = String(episodeNumber).padStart(2, '0');
    return `tvshow:${series}:s${season}e${episode}`;
  }

  // Fall back to just series title (less reliable matching)
  return `tvshow:${series}:${normalizeString(title)}`;
}

/**
 * Generate a match key for a video (movie or TV show)
 */
export function generateVideoMatchKey(video: {
  contentType: ContentType;
  title: string;
  year?: number;
  seriesTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}): string {
  if (video.contentType === 'movie') {
    return generateMovieKey(video.title, video.year);
  } else {
    return generateTVShowKey(
      video.seriesTitle,
      video.title,
      video.seasonNumber,
      video.episodeNumber
    );
  }
}
