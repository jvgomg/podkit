/**
 * Content type detection for video files
 *
 * Distinguishes movies from TV shows based on:
 * 1. Embedded metadata (if provided)
 * 2. Filename patterns (S01E01, 1x01, etc.)
 * 3. Folder structure (/TV Shows/, /Season X/, etc.)
 */

import * as path from 'node:path';
import type { ContentType, VideoMetadata } from './metadata.js';
import { formatEpisodeId } from './metadata.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Confidence level for content type detection
 */
export type ContentTypeConfidence = 'high' | 'medium' | 'low';

/**
 * Result of content type detection
 */
export interface ContentTypeResult {
  /** Detected content type */
  type: ContentType;

  /** Confidence level of the detection */
  confidence: ContentTypeConfidence;

  /** Series title (for TV shows) */
  seriesTitle?: string;

  /** Season number (for TV shows, 1-based) */
  seasonNumber?: number;

  /** Episode number (for TV shows, 1-based) */
  episodeNumber?: number;

  /** Episode identifier string (e.g., 'S01E01') */
  episodeId?: string;
}

/**
 * Internal result from pattern matching
 */
interface EpisodePatternMatch {
  seasonNumber: number;
  episodeNumber: number;
  matchIndex: number;
  matchLength: number;
}

// =============================================================================
// Patterns
// =============================================================================

/**
 * Regular expressions for detecting TV show episode patterns in filenames
 *
 * Ordered by specificity/common usage.
 */
const EPISODE_PATTERNS: RegExp[] = [
  // S01E01, s01e01, S1E1 (most common)
  /[Ss](\d{1,2})[Ee](\d{1,3})/,

  // s01.e01, S1.E1 (dotted format)
  /[Ss](\d{1,2})\.[Ee](\d{1,3})/,

  // 1x01, 01x01 (alternative format)
  /(\d{1,2})x(\d{2,3})/,

  // Season 1 Episode 1, Season 01 Episode 01 (verbose format)
  /[Ss]eason\s*(\d{1,2})\s*[Ee]pisode\s*(\d{1,3})/i,
];

/**
 * Folder patterns that indicate TV content
 */
const TV_FOLDER_PATTERNS: RegExp[] = [
  /\/TV\s*Shows?\//i,
  /\/Series\//i,
  /\/Television\//i,
  /\/TV\//i,
];

/**
 * Season folder patterns for extracting season number and locating series title
 */
const SEASON_FOLDER_PATTERNS: RegExp[] = [
  // Season 1, Season 01
  /[Ss]eason\s*(\d{1,2})/,
  // S01, S1
  /[Ss](\d{1,2})$/,
];

/**
 * Quality indicators and release group patterns to clean from series titles
 */
const CLEANUP_PATTERNS: RegExp[] = [
  // Quality indicators
  /\b(720p|1080p|2160p|4K|480p|576p)\b/gi,
  // Common release/encoding info
  /\b(HDTV|WEB-?DL|WEB-?Rip|BluRay|BRRip|DVDRip|PROPER|REPACK)\b/gi,
  // Codec info
  /\b(x264|x265|h\.?264|h\.?265|HEVC|XviD|DivX)\b/gi,
  // Audio info
  /\b(AAC|AC3|DTS|DD5\.1|5\.1|7\.1)\b/gi,
  // Release groups (in brackets or after dash at end)
  /\[.*?\]/g,
  /\s*-\s*[A-Za-z0-9]+$/,
  // Year in parentheses (but keep the year for potential use)
  /\(\d{4}\)/g,
];

// =============================================================================
// Detection Functions
// =============================================================================

/**
 * Detect content type from file path and optional metadata
 *
 * Detection priority:
 * 1. If metadata already has contentType, use it with high confidence
 * 2. If metadata has seriesTitle/seasonNumber/episodeNumber, it's TV
 * 3. Check filename for episode patterns
 * 4. Check folder structure for TV indicators
 * 5. Fall back to movie (low confidence)
 *
 * @param filePath - Path to the video file
 * @param metadata - Optional partial metadata that may override detection
 * @returns Content type result with confidence and TV show details
 */
export function detectContentType(
  filePath: string,
  metadata?: Partial<VideoMetadata>
): ContentTypeResult {
  // Priority 1: Explicit content type in metadata
  if (metadata?.contentType) {
    if (metadata.contentType === 'tvshow') {
      // Extract TV show details from metadata
      const tvMetadata = metadata as Partial<{
        seriesTitle: string;
        seasonNumber: number;
        episodeNumber: number;
        episodeId: string;
      }>;

      return {
        type: 'tvshow',
        confidence: 'high',
        seriesTitle: tvMetadata.seriesTitle,
        seasonNumber: tvMetadata.seasonNumber,
        episodeNumber: tvMetadata.episodeNumber,
        episodeId:
          tvMetadata.episodeId ||
          (tvMetadata.seasonNumber !== undefined && tvMetadata.episodeNumber !== undefined
            ? formatEpisodeId(tvMetadata.seasonNumber, tvMetadata.episodeNumber)
            : undefined),
      };
    }
    return { type: 'movie', confidence: 'high' };
  }

  // Priority 2: TV show indicators in metadata (without explicit contentType)
  const tvMetadata = metadata as
    | Partial<{
        seriesTitle: string;
        seasonNumber: number;
        episodeNumber: number;
        episodeId: string;
      }>
    | undefined;

  if (
    tvMetadata &&
    (tvMetadata.seriesTitle !== undefined ||
      (tvMetadata.seasonNumber !== undefined && tvMetadata.episodeNumber !== undefined))
  ) {
    return {
      type: 'tvshow',
      confidence: 'high',
      seriesTitle: tvMetadata.seriesTitle,
      seasonNumber: tvMetadata.seasonNumber,
      episodeNumber: tvMetadata.episodeNumber,
      episodeId:
        tvMetadata.episodeId ||
        (tvMetadata.seasonNumber !== undefined && tvMetadata.episodeNumber !== undefined
          ? formatEpisodeId(tvMetadata.seasonNumber, tvMetadata.episodeNumber)
          : undefined),
    };
  }

  // Priority 3 & 4: Analyze path for TV patterns
  const fileName = path.basename(filePath);
  const dirPath = path.dirname(filePath);

  const episodeMatch = matchEpisodePattern(fileName);
  const hasTVFolder = hasTVFolderPattern(dirPath);
  const seasonInfo = extractSeasonFromFolder(dirPath);

  if (episodeMatch) {
    // Has episode pattern - likely TV show
    const seriesTitle = extractSeriesTitle(filePath, episodeMatch);
    const confidence: ContentTypeConfidence = hasTVFolder || seasonInfo ? 'high' : 'medium';

    return {
      type: 'tvshow',
      confidence,
      seriesTitle,
      seasonNumber: episodeMatch.seasonNumber,
      episodeNumber: episodeMatch.episodeNumber,
      episodeId: formatEpisodeId(episodeMatch.seasonNumber, episodeMatch.episodeNumber),
    };
  }

  if (hasTVFolder || seasonInfo) {
    // No episode pattern but TV folder structure - medium confidence TV
    // Try to extract series info from folder structure
    const seriesTitle = seasonInfo
      ? extractSeriesTitleFromSeasonFolder(dirPath)
      : extractSeriesTitleFromTVFolder(dirPath);

    return {
      type: 'tvshow',
      confidence: 'medium',
      seriesTitle: seriesTitle ?? undefined,
      seasonNumber: seasonInfo?.seasonNumber,
    };
  }

  // Priority 5: Fall back to movie
  return { type: 'movie', confidence: 'low' };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Match episode pattern in filename
 */
function matchEpisodePattern(fileName: string): EpisodePatternMatch | null {
  for (const pattern of EPISODE_PATTERNS) {
    const match = fileName.match(pattern);
    if (match && match[1] && match[2]) {
      return {
        seasonNumber: parseInt(match[1], 10),
        episodeNumber: parseInt(match[2], 10),
        matchIndex: match.index ?? 0,
        matchLength: match[0].length,
      };
    }
  }
  return null;
}

/**
 * Check if path contains TV folder indicators
 */
function hasTVFolderPattern(dirPath: string): boolean {
  const normalizedPath = dirPath.replace(/\\/g, '/');
  return TV_FOLDER_PATTERNS.some((pattern) => pattern.test(normalizedPath));
}

/**
 * Extract season number from folder path
 */
function extractSeasonFromFolder(dirPath: string): { seasonNumber: number } | null {
  const parts = dirPath.split(path.sep);

  // Check the last few folders for season patterns
  for (let i = parts.length - 1; i >= Math.max(0, parts.length - 3); i--) {
    const folder = parts[i];
    if (!folder) continue;

    for (const pattern of SEASON_FOLDER_PATTERNS) {
      const match = folder.match(pattern);
      if (match && match[1]) {
        return { seasonNumber: parseInt(match[1], 10) };
      }
    }
  }

  return null;
}

/**
 * Extract series title from file path when episode pattern is found
 */
function extractSeriesTitle(filePath: string, episodeMatch: EpisodePatternMatch): string {
  const fileName = path.basename(filePath);
  const dirPath = path.dirname(filePath);

  // First, try to get series title from folder structure (most reliable)
  const folderTitle = extractSeriesTitleFromSeasonFolder(dirPath);
  if (folderTitle) {
    return folderTitle;
  }

  // Fall back to extracting from filename (text before episode pattern)
  const textBeforePattern = fileName.substring(0, episodeMatch.matchIndex);

  // Clean up the extracted title
  const title = cleanupTitle(textBeforePattern);

  // If we got a reasonable title, return it
  if (title && title.length > 0) {
    return title;
  }

  // Last resort: use the immediate parent folder name
  const parts = dirPath.split(path.sep);
  const lastFolder = parts[parts.length - 1];
  if (lastFolder) {
    return cleanupTitle(lastFolder) || lastFolder;
  }

  return 'Unknown Series';
}

/**
 * Extract series title from folder structure with Season folder
 *
 * Looks for pattern: /SeriesName/Season X/
 */
function extractSeriesTitleFromSeasonFolder(dirPath: string): string | null {
  const parts = dirPath.split(path.sep);

  // Find the Season folder and get its parent
  for (let i = parts.length - 1; i >= 1; i--) {
    const folder = parts[i];
    if (!folder) continue;

    for (const pattern of SEASON_FOLDER_PATTERNS) {
      if (pattern.test(folder)) {
        // Found Season folder, parent is likely series name
        const seriesFolder = parts[i - 1];
        if (seriesFolder) {
          return cleanupTitle(seriesFolder) || seriesFolder;
        }
      }
    }
  }

  return null;
}

/**
 * Extract series title from TV folder structure
 *
 * When path contains /TV Shows/ or similar, look for the next folder down
 */
function extractSeriesTitleFromTVFolder(dirPath: string): string | undefined {
  const normalizedPath = dirPath.replace(/\\/g, '/');
  const parts = normalizedPath.split('/');

  // Find TV folder and get the next folder after it
  for (let i = 0; i < parts.length - 1; i++) {
    const folder = parts[i];
    if (!folder) continue;

    for (const pattern of TV_FOLDER_PATTERNS) {
      // Check if this folder matches a TV pattern (need to add path separators)
      const testPath = `/${folder}/`;
      if (pattern.test(testPath)) {
        const nextFolder = parts[i + 1];
        if (nextFolder) {
          return cleanupTitle(nextFolder) || nextFolder;
        }
      }
    }
  }

  return undefined;
}

/**
 * Clean up a title string by removing quality indicators, release groups, etc.
 */
function cleanupTitle(raw: string): string {
  let title = raw;

  // Replace dots and underscores with spaces (common in scene releases)
  title = title.replace(/[._]/g, ' ');

  // Apply cleanup patterns
  for (const pattern of CLEANUP_PATTERNS) {
    title = title.replace(pattern, '');
  }

  // Clean up whitespace
  title = title.replace(/\s+/g, ' ').trim();

  // Remove trailing dashes and dots
  title = title.replace(/[-.\s]+$/, '').trim();

  return title;
}
