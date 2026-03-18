/**
 * Content type detection for video files
 *
 * Distinguishes movies from TV shows based on:
 * 1. Embedded metadata (if provided)
 * 2. Filename patterns (S01E01, 1x01, etc.)
 * 3. Folder structure (/TV Shows/, /Season X/, etc.)
 * 4. Scene release parsing via @ctrl/video-filename-parser (fallback)
 */

import * as path from 'node:path';
import { parseSeason, parseTitleAndYear, removeFileExtension } from '@ctrl/video-filename-parser';
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

  /** Parsed title from filename (for movies) */
  parsedTitle?: string;

  /** Parsed year from filename (for movies) */
  parsedYear?: number;

  /** Detected language tag (e.g., 'Japanese', 'English', 'Chinese') */
  language?: string;

  /** Detected edition/variant tag (e.g., 'Dubbed', 'Subbed') */
  edition?: string;
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

/**
 * Result from anime fansub pattern matching
 *
 * Extends episode match with series title and fansub group,
 * since these are integral to the fansub naming format.
 */
interface FansubPatternMatch {
  seriesTitle: string;
  fansubGroup: string;
  seasonNumber: number;
  episodeNumber: number;
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
  // Episode range markers (e.g., S01E01-54, S01E01-E54)
  /\b[Ss]\d{1,2}[Ee]\d{1,3}(?:-[Ee]?\d{1,3})?\b/g,
  // Edition/dub indicators (NOT language codes — those are identity markers preserved in seriesTitle)
  /\b(DUBBED|SUBBED|MULTI|DUAL[.-]?AUDIO)\b/gi,
  // Release groups (in brackets or after dash at end)
  /\[.*?\]/g,
  /\s*-\s*[A-Za-z0-9]+$/,
  // Year in parentheses (but keep the year for potential use)
  /\(\d{4}\)/g,
];

/**
 * Generic folder names that should not be used as series titles
 *
 * When extracting series title from parent folder, skip these
 * since they are container directories, not show names.
 */
const GENERIC_FOLDER_NAMES = new Set([
  'videos',
  'movies',
  'media',
  'downloads',
  'tv',
  'tv shows',
  'tv show',
  'series',
  'television',
  'anime',
  'shows',
  'content',
  'library',
  'home',
  'share',
  'shared',
  'public',
  'torrents',
  'completed',
]);

// =============================================================================
// Language & Edition Detection
// =============================================================================

/**
 * Known language tags mapped to their normalized full names
 */
const LANGUAGE_TAGS: Record<string, string> = {
  jpn: 'Japanese',
  japanese: 'Japanese',
  eng: 'English',
  english: 'English',
  chn: 'Chinese',
  chinese: 'Chinese',
  mandarin: 'Chinese',
  kor: 'Korean',
  korean: 'Korean',
  fre: 'French',
  french: 'French',
  ger: 'German',
  german: 'German',
  spa: 'Spanish',
  spanish: 'Spanish',
  ita: 'Italian',
  italian: 'Italian',
};

/**
 * Known edition/variant tags
 */
const EDITION_TAGS = [
  'DUBBED',
  'SUBBED',
  'HARDSUBBED',
  'DIRECTORS CUT',
  'EXTENDED',
  'UNRATED',
  'THEATRICAL',
  'REMASTERED',
];

/**
 * Extract language and edition tags from file path
 *
 * Scans both the filename and parent folder names for recognized
 * language and edition indicators.
 */
export function extractLanguageAndEdition(filePath: string): {
  language?: string;
  edition?: string;
} {
  const fileName = path.basename(filePath, path.extname(filePath));
  const dirPath = path.dirname(filePath);

  // Combine filename and folder path, normalized for matching
  const combined = `${dirPath}/${fileName}`.replace(/[._]/g, ' ');

  let language: string | undefined;
  let edition: string | undefined;

  // Check for language tags
  for (const [tag, name] of Object.entries(LANGUAGE_TAGS)) {
    if (new RegExp(`\\b${tag}\\b`, 'i').test(combined)) {
      language = name;
      break;
    }
  }

  // Check for edition tags
  for (const tag of EDITION_TAGS) {
    if (new RegExp(`\\b${tag.replace(/ /g, '\\s+')}\\b`, 'i').test(combined)) {
      edition = tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase();
      break;
    }
  }

  return { language, edition };
}

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
  const fileName = path.basename(filePath);

  // Pre-compute folder-derived series title (most reliable, includes language markers)
  const dirPath = path.dirname(filePath);
  const folderSeriesTitle = extractSeriesTitleFromSeasonFolder(dirPath);

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

      // Prefer folder-derived series title (includes language markers like "(JPN)"),
      // then fall back to metadata, then library parser
      let seriesTitle = folderSeriesTitle ?? tvMetadata.seriesTitle;
      const metadataSeriesTitleIsSceneRelease = seriesTitle && looksLikeSceneRelease(seriesTitle);

      if (!seriesTitle || metadataSeriesTitleIsSceneRelease) {
        // Try to parse series title from filename
        const libraryResult = parseSeason(fileName);
        if (libraryResult?.seriesTitle && libraryResult.seriesTitle.length > 0) {
          seriesTitle = cleanupSeriesTitle(libraryResult.seriesTitle);
        }
      }

      return {
        type: 'tvshow',
        confidence: 'high',
        seriesTitle,
        seasonNumber: tvMetadata.seasonNumber,
        episodeNumber: tvMetadata.episodeNumber,
        episodeId:
          tvMetadata.episodeId ||
          (tvMetadata.seasonNumber !== undefined && tvMetadata.episodeNumber !== undefined
            ? formatEpisodeId(tvMetadata.seasonNumber, tvMetadata.episodeNumber)
            : undefined),
      };
    }
    // For movies, also parse title/year from filename
    const parsed = parseFilenameWithLibrary(fileName);
    return {
      type: 'movie',
      confidence: 'high',
      parsedTitle: parsed.title,
      parsedYear: parsed.year,
    };
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
      seriesTitle: folderSeriesTitle ?? tvMetadata.seriesTitle,
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
  const langEdition = extractLanguageAndEdition(filePath);

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
      ...langEdition,
    };
  }

  // Priority 3b: Anime fansub pattern (no SxxExx, uses standalone episode numbers)
  const fansubMatch = matchAnimeFansubPattern(fileName);
  if (fansubMatch) {
    const confidence: ContentTypeConfidence = hasTVFolder || seasonInfo ? 'high' : 'medium';

    return {
      type: 'tvshow',
      confidence,
      seriesTitle: fansubMatch.seriesTitle,
      seasonNumber: fansubMatch.seasonNumber,
      episodeNumber: fansubMatch.episodeNumber,
      episodeId: formatEpisodeId(fansubMatch.seasonNumber, fansubMatch.episodeNumber),
      ...langEdition,
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
      ...langEdition,
    };
  }

  // Priority 5: Fall back to movie with library-based parsing
  const parsed = parseFilenameWithLibrary(fileName);

  if (parsed.title || parsed.year) {
    return {
      type: 'movie',
      confidence: 'medium',
      parsedTitle: parsed.title,
      parsedYear: parsed.year,
      ...langEdition,
    };
  }

  return { type: 'movie', confidence: 'low', ...langEdition };
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
 * Match anime fansub naming pattern in filename
 *
 * Handles patterns like:
 * - [RyRo]_Digimon_Adventure_15_(h264)_[8FBCA82D].mkv
 * - [SubGroup] Show Name - 03 [720p] [ABCD1234].mkv
 * - [Group]_Show_-_100_(1080p)_[DEADBEEF].mkv
 * - [Group] Show - 01v2.mkv (version releases)
 *
 * Requires square brackets at start (fansub group) to avoid false positives.
 * Season defaults to 1 since anime typically uses different series names per season.
 */
function matchAnimeFansubPattern(fileName: string): FansubPatternMatch | null {
  const ext = path.extname(fileName);
  const nameWithoutExt = fileName.slice(0, -ext.length);

  const match = nameWithoutExt.match(
    /^\[([^\]]+)\][_ ]+(.+?)[_ ]+(?:-[_ ]+)?(\d{2,3})(?:v\d+)?(?:[_ ]*\([^)]*\))?(?:[_ ]*\[[0-9A-Fa-f]{8}\])?$/
  );

  if (!match) return null;

  return {
    fansubGroup: match[1]!,
    seriesTitle: match[2]!.replace(/[_]/g, ' ').trim(),
    seasonNumber: 1,
    episodeNumber: parseInt(match[3]!, 10),
  };
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
 *
 * Priority order:
 * 1. Season folder parent (e.g., /Breaking Bad/Season 1/ → "Breaking Bad")
 * 2. Parent folder if not generic (e.g., /Digimon.Digital.Monsters.DUBBED/ → "Digimon Digital Monsters")
 * 3. Library parser from filename (e.g., "Game.of.Thrones.S01E01.720p.mp4" → "Game of Thrones")
 * 4. "Unknown Series" fallback
 */
function extractSeriesTitle(filePath: string, _episodeMatch: EpisodePatternMatch): string {
  const fileName = path.basename(filePath);
  const dirPath = path.dirname(filePath);

  // First, try to get series title from folder structure (most reliable)
  const folderTitle = extractSeriesTitleFromSeasonFolder(dirPath);
  if (folderTitle) {
    return folderTitle;
  }

  // Second, try parent folder (often has full series name, e.g. release folder)
  // Skip generic container folders like "Videos", "Movies", "Downloads"
  const parts = dirPath.split(path.sep);
  const lastFolder = parts[parts.length - 1];
  if (lastFolder) {
    const isSeasonFolder = SEASON_FOLDER_PATTERNS.some((p) => p.test(lastFolder));
    const isGenericFolder = GENERIC_FOLDER_NAMES.has(lastFolder.toLowerCase());

    if (!isSeasonFolder && !isGenericFolder) {
      const cleaned = cleanupTitle(lastFolder);
      if (cleaned && cleaned.length > 0 && !looksLikeSceneRelease(cleaned)) {
        return cleaned;
      }
    }
  }

  // Third, try using the library for scene release parsing
  const libraryResult = parseSeason(fileName);
  if (libraryResult?.seriesTitle && libraryResult.seriesTitle.length > 0) {
    // Clean up any trailing brackets or artifacts from the library
    const cleaned = cleanupSeriesTitle(libraryResult.seriesTitle);
    if (cleaned.length > 0) {
      return cleaned;
    }
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

/**
 * Clean up a series title from the library parser
 *
 * The library sometimes leaves trailing brackets or other artifacts.
 */
function cleanupSeriesTitle(raw: string): string {
  let title = raw;

  // Remove trailing brackets or partial brackets
  title = title.replace(/\s*\[.*$/, '');
  title = title.replace(/\s*\(.*$/, '');

  // Remove trailing dashes, dots, or whitespace
  title = title.replace(/[-.\s]+$/, '').trim();

  return title;
}

/**
 * Check if a title looks like a scene release name
 *
 * Scene releases typically have:
 * - Dots separating words instead of spaces (e.g., "Movie.Name.2020")
 * - Quality indicators (720p, 1080p, BluRay, etc.)
 * - Release group names
 *
 * Used by both content-type detection (for series titles from metadata)
 * and directory-adapter (for embedded metadata titles).
 *
 * Examples of bad titles:
 * - "DVDRip XviD-KIDSROCK"
 * - "WEB-DL 1080p"
 * - "Movie.Name.2020.1080p.BluRay"
 */
export function looksLikeSceneRelease(title: string): boolean {
  // If it has multiple dots with words between them (e.g., "Movie.Name.2020")
  const dotCount = (title.match(/\./g) || []).length;
  if (dotCount >= 3) {
    return true;
  }

  // Quality/release indicators that shouldn't be in a real title
  const scenePatterns = [
    /\b(720p|1080p|2160p|4K|480p|576p)\b/i,
    /\b(HDTV|WEB-?DL|WEB-?Rip|BluRay|BRRip|DVDRip|BDRip)\b/i,
    /\b(x264|x265|h\.?264|h\.?265|HEVC|XviD|DivX|AVC)\b/i,
    /\b(AAC|AC3|DTS|DTS-HD|DD5\.1|FLAC|TrueHD)\b/i,
    /\b(REMUX|REPACK|PROPER|INTERNAL)\b/i,
    /-[A-Z0-9]+$/i, // Release group suffix
  ];

  return scenePatterns.some((pattern) => pattern.test(title));
}

/**
 * Parse filename using @ctrl/video-filename-parser library
 *
 * Used as a fallback for scene release detection when standard patterns don't match.
 */
function parseFilenameWithLibrary(fileName: string): {
  title?: string;
  year?: number;
} {
  // Remove extension for better parsing
  const nameWithoutExt = removeFileExtension(fileName);

  // Use library to extract title and year
  const parsed = parseTitleAndYear(nameWithoutExt);

  const result: { title?: string; year?: number } = {};

  // Clean and validate parsed title
  if (parsed.title) {
    // Replace dots and underscores with spaces
    let title = parsed.title.replace(/[._]/g, ' ').trim();
    // Capitalize first letter of each word (title case)
    title = title.replace(/\b\w/g, (c) => c.toUpperCase());
    // Only use if it looks like a valid title (not just quality info)
    if (title.length > 1 && !/^\d+p$/i.test(title)) {
      result.title = title;
    }
  }

  // Parse year if available
  if (parsed.year) {
    const year = parseInt(parsed.year, 10);
    if (year >= 1888 && year <= new Date().getFullYear() + 2) {
      result.year = year;
    }
  }

  return result;
}
