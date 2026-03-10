/**
 * Video metadata adapter interface
 *
 * Provides a uniform interface for extracting metadata from video files.
 * Adapters can read from different sources: embedded metadata, NFO files,
 * Plex databases, etc.
 *
 * ## Content Types
 *
 * Videos are categorized as either movies or TV shows:
 *
 * - **Movies**: Standalone films with optional director/studio info
 * - **TV Shows**: Episodes with series, season, and episode information
 *
 * The `contentType` field serves as a discriminator for type narrowing.
 */

// =============================================================================
// Content Types
// =============================================================================

/**
 * Discriminator for video content types
 */
export type ContentType = 'movie' | 'tvshow';

// =============================================================================
// Metadata Types
// =============================================================================

/**
 * Base video metadata with common fields
 *
 * This is the shared structure for all video content types.
 * Use the discriminated union `VideoMetadata` for actual metadata values.
 */
export interface VideoMetadataBase {
  /** Video title (movie title or episode title) */
  title: string;

  /** Release year */
  year?: number;

  /** Description or synopsis */
  description?: string;

  /** Primary genre (e.g., 'Action', 'Comedy', 'Drama') */
  genre?: string;

  /** Content type discriminator */
  contentType: ContentType;
}

/**
 * Metadata for movies
 *
 * Extends base metadata with movie-specific fields.
 */
export interface MovieMetadata extends VideoMetadataBase {
  /** Always 'movie' for movie content */
  contentType: 'movie';

  /** Director name */
  director?: string;

  /** Production studio (e.g., 'Warner Bros', 'Universal') */
  studio?: string;
}

/**
 * Metadata for TV show episodes
 *
 * Extends base metadata with TV series information.
 */
export interface TVShowMetadata extends VideoMetadataBase {
  /** Always 'tvshow' for TV content */
  contentType: 'tvshow';

  /** Series/show title (e.g., 'Breaking Bad') */
  seriesTitle: string;

  /** Season number (1-based) */
  seasonNumber: number;

  /** Episode number within season (1-based) */
  episodeNumber: number;

  /** Episode identifier string (e.g., 'S01E01', 'S02E15') */
  episodeId?: string;

  /** Network or streaming service (e.g., 'HBO', 'Netflix') */
  network?: string;
}

/**
 * Video metadata - discriminated union of movie and TV show metadata
 *
 * Use the `contentType` field to narrow the type:
 *
 * ```typescript
 * if (metadata.contentType === 'movie') {
 *   console.log(metadata.director); // MovieMetadata
 * } else {
 *   console.log(metadata.seriesTitle); // TVShowMetadata
 * }
 * ```
 */
export type VideoMetadata = MovieMetadata | TVShowMetadata;

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if metadata is for a movie
 */
export function isMovieMetadata(metadata: VideoMetadata): metadata is MovieMetadata {
  return metadata.contentType === 'movie';
}

/**
 * Check if metadata is for a TV show
 */
export function isTVShowMetadata(metadata: VideoMetadata): metadata is TVShowMetadata {
  return metadata.contentType === 'tvshow';
}

// =============================================================================
// Adapter Interface
// =============================================================================

/**
 * Adapter for extracting video metadata from various sources
 *
 * Implementations might include:
 * - EmbeddedMetadataAdapter: Read from file containers (MP4, MKV tags)
 * - NfoAdapter: Parse NFO sidecar files (Kodi/XBMC format)
 * - PlexAdapter: Query Plex database
 * - FilenameAdapter: Parse structured filenames (e.g., "Show.S01E01.Title.mkv")
 *
 * Adapters are tried in order until one returns metadata.
 */
export interface VideoMetadataAdapter {
  /**
   * Human-readable name for this adapter
   *
   * Used for logging and debugging (e.g., 'embedded', 'nfo', 'plex').
   */
  readonly name: string;

  /**
   * Check if this adapter can handle the given file
   *
   * This should be a quick check (e.g., file extension, sidecar existence)
   * without actually parsing the full file.
   *
   * @param filePath - Absolute path to the video file
   * @returns true if this adapter might be able to extract metadata
   */
  canHandle(filePath: string): Promise<boolean>;

  /**
   * Extract metadata from the video file
   *
   * @param filePath - Absolute path to the video file
   * @returns VideoMetadata if successful, null if no metadata found
   * @throws Error for unexpected failures (I/O errors, parse errors)
   */
  getMetadata(filePath: string): Promise<VideoMetadata | null>;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Format an episode ID from season and episode numbers
 *
 * @param seasonNumber - Season number (1-based)
 * @param episodeNumber - Episode number (1-based)
 * @returns Formatted string like "S01E01"
 */
export function formatEpisodeId(seasonNumber: number, episodeNumber: number): string {
  const season = String(seasonNumber).padStart(2, '0');
  const episode = String(episodeNumber).padStart(2, '0');
  return `S${season}E${episode}`;
}

/**
 * Parse an episode ID string into season and episode numbers
 *
 * Supports formats:
 * - S01E01 / s01e01
 * - 1x01
 *
 * @param episodeId - Episode ID string
 * @returns Object with seasonNumber and episodeNumber, or null if parse failed
 */
export function parseEpisodeId(
  episodeId: string
): { seasonNumber: number; episodeNumber: number } | null {
  // Match S01E01 format (case-insensitive)
  const sxxexxMatch = episodeId.match(/^[Ss](\d+)[Ee](\d+)$/);
  if (sxxexxMatch) {
    return {
      seasonNumber: parseInt(sxxexxMatch[1]!, 10),
      episodeNumber: parseInt(sxxexxMatch[2]!, 10),
    };
  }

  // Match 1x01 format
  const nxnnMatch = episodeId.match(/^(\d+)x(\d+)$/);
  if (nxnnMatch) {
    return {
      seasonNumber: parseInt(nxnnMatch[1]!, 10),
      episodeNumber: parseInt(nxnnMatch[2]!, 10),
    };
  }

  return null;
}
