/**
 * Embedded video metadata adapter
 *
 * Extracts metadata from video file tags using ffprobe.
 * This is the primary/default adapter for reading video metadata.
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import type { SpawnFn } from './probe.js';
import {
  type VideoMetadata,
  type VideoMetadataAdapter,
  type MovieMetadata,
  type TVShowMetadata,
  formatEpisodeId,
} from './metadata.js';

/**
 * Default FFprobe binary name
 */
const DEFAULT_FFPROBE = 'ffprobe';

/**
 * Supported video file extensions
 */
const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mkv', '.avi', '.mov', '.webm']);

/**
 * Configuration options for EmbeddedVideoMetadataAdapter
 */
export interface EmbeddedVideoMetadataConfig {
  /** Override FFprobe binary path */
  ffprobePath?: string;
  /** Custom spawn function for testing */
  _spawnFn?: SpawnFn;
}

/**
 * FFprobe format tags output structure
 */
interface FFprobeFormatTags {
  title?: string;
  date?: string;
  year?: string;
  description?: string;
  comment?: string;
  synopsis?: string;
  genre?: string;
  // Movie fields
  artist?: string;
  album_artist?: string;
  // TV show fields
  show?: string;
  season_number?: string;
  episode_sort?: string;
  episode_id?: string;
  network?: string;
}

/**
 * FFprobe format output structure
 */
interface FFprobeFormat {
  format_name?: string;
  duration?: string;
  tags?: FFprobeFormatTags;
}

/**
 * FFprobe JSON output structure
 */
interface FFprobeMetadataOutput {
  format?: FFprobeFormat;
}

/**
 * Error thrown when metadata extraction fails
 */
export class VideoMetadataError extends Error {
  constructor(
    message: string,
    public readonly exitCode?: number,
    public readonly stderr?: string
  ) {
    super(message);
    this.name = 'VideoMetadataError';
  }
}

/**
 * Execute ffprobe and return stdout/stderr
 */
async function execFFprobe(
  ffprobePath: string,
  args: string[],
  spawnFn: SpawnFn = spawn
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawnFn(ffprobePath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err: Error) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new VideoMetadataError(`ffprobe not found: ${ffprobePath}`));
      } else {
        reject(new VideoMetadataError(`Failed to execute ffprobe: ${err.message}`));
      }
    });

    proc.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0,
      });
    });
  });
}

/**
 * Parse year from date string
 *
 * Handles formats like:
 * - "2024"
 * - "2024-05-15"
 * - "May 15, 2024"
 */
function parseYear(dateStr: string | undefined): number | undefined {
  if (!dateStr) return undefined;

  // Try to match a 4-digit year
  const yearMatch = dateStr.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) {
    return parseInt(yearMatch[0], 10);
  }

  return undefined;
}

/**
 * Check if tags indicate TV show content
 */
function isTVShowTags(tags: FFprobeFormatTags): boolean {
  return !!(tags.show || tags.season_number || tags.episode_sort || tags.episode_id);
}

/**
 * Build movie metadata from tags
 */
function buildMovieMetadata(tags: FFprobeFormatTags, fallbackTitle: string): MovieMetadata {
  return {
    contentType: 'movie',
    title: tags.title || fallbackTitle,
    year: parseYear(tags.date) ?? parseYear(tags.year),
    description: tags.description || tags.comment || tags.synopsis,
    genre: tags.genre,
    director: tags.artist,
    studio: tags.album_artist,
  };
}

/**
 * Build TV show metadata from tags
 */
function buildTVShowMetadata(tags: FFprobeFormatTags, fallbackTitle: string): TVShowMetadata {
  const seasonNumber = tags.season_number ? parseInt(tags.season_number, 10) : 1;
  const episodeNumber = tags.episode_sort ? parseInt(tags.episode_sort, 10) : 1;

  return {
    contentType: 'tvshow',
    title: tags.title || fallbackTitle,
    seriesTitle: tags.show || tags.title || fallbackTitle,
    seasonNumber,
    episodeNumber,
    episodeId: tags.episode_id || formatEpisodeId(seasonNumber, episodeNumber),
    year: parseYear(tags.date) ?? parseYear(tags.year),
    description: tags.description || tags.comment || tags.synopsis,
    genre: tags.genre,
    network: tags.network,
  };
}

/**
 * Result of filename parsing
 */
interface FilenameParsed {
  title: string;
  year?: number;
  seasonNumber?: number;
  episodeNumber?: number;
}

/**
 * Scene release token patterns used to detect cruft in episode title parts
 *
 * When a filename like "Show.S01E01.DVDRip.XviD-DEiMOS.avi" is parsed,
 * the part after the episode ID ("DVDRip.XviD-DEiMOS") should be discarded
 * as scene release cruft rather than used as the episode title.
 */
const SCENE_TOKEN_PATTERNS: RegExp[] = [
  /^(720p|1080p|2160p|4K|480p|576p)$/i,
  /^(HDTV|WEB-?DL|WEB-?Rip|BluRay|BRRip|DVDRip|BDRip|REMUX|REPACK|PROPER|INTERNAL)$/i,
  /^(x264|x265|h\.?264|h\.?265|HEVC|XviD|DivX|AVC)$/i,
  /^(AAC|AC3|DTS|DTS-?HD|DD5\.?1|FLAC|TrueHD|5\.1|7\.1)$/i,
  /^(DUBBED|SUBBED|MULTI|DUAL[.-]?AUDIO)$/i,
];

/**
 * Language tokens to strip from episode title parts
 */
const LANGUAGE_TOKEN_PATTERN =
  /\b(?:Part\s+)?(Chinese|Japanese|English|Korean|French|German|Spanish|Italian|JPN|ENG|CHN|KOR|FRE|GER|SPA|ITA)\b/gi;

/**
 * Check if a title part from a parsed filename is entirely scene release cruft
 *
 * Returns the cleaned title if it contains real content, or null if it's all cruft.
 */
function cleanEpisodeTitlePart(titlePart: string): string | null {
  // Replace dots with spaces and strip release group suffix (e.g., "-DEiMOS")
  let cleaned = titlePart
    .replace(/\./g, ' ')
    .replace(/\s*-\s*[A-Za-z0-9]+$/, '')
    .trim();

  // Strip language tokens
  cleaned = cleaned.replace(LANGUAGE_TOKEN_PATTERN, '').trim();

  // Check if remaining words are all scene tokens
  const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return null;

  const allSceneCruft = words.every((word) =>
    SCENE_TOKEN_PATTERNS.some((pattern) => pattern.test(word))
  );

  return allSceneCruft ? null : cleaned;
}

/**
 * Parse metadata from filename
 *
 * Handles patterns like:
 * - "Movie Name (2024).mp4" -> title: "Movie Name", year: 2024
 * - "Movie Name [2024].mp4" -> title: "Movie Name", year: 2024
 * - "Show.S01E05.Episode.Title.mp4" -> TV show pattern
 * - "Show.1x05.Episode.Title.mp4" -> TV show pattern
 * - "Show - S01E05 - Episode Title.mp4" -> TV show pattern
 * - "[Group]_Show_Name_15_(h264)_[CRC].mkv" -> Anime fansub pattern
 */
export function parseFilename(filePath: string): FilenameParsed {
  const basename = path.basename(filePath);
  const ext = path.extname(basename);
  const nameWithoutExt = basename.slice(0, -ext.length);

  // Try anime fansub pattern first (before SxxExx since fansub files never have SxxExx)
  // Match: "[Group]_Show_Name_15_(h264)_[8FBCA82D]" or "[Group] Show - 03 [CRC]"
  const fansubMatch = nameWithoutExt.match(
    /^\[([^\]]+)\][_ ]+(.+?)[_ ]+(?:-[_ ]+)?(\d{2,3})(?:v\d+)?(?:[_ ]*\([^)]*\))?(?:[_ ]*\[[0-9A-Fa-f]{8}\])?$/
  );
  if (fansubMatch) {
    return {
      title: fansubMatch[2]!.replace(/[_]/g, ' ').trim(),
      seasonNumber: 1,
      episodeNumber: parseInt(fansubMatch[3]!, 10),
    };
  }

  // Try to parse TV show patterns
  // Match: "Show.S01E05.Title" or "Show - S01E05 - Title" or "Show S01E05 Title"
  const sxxexxMatch = nameWithoutExt.match(/^(.+?)[.\s-]+[Ss](\d+)[Ee](\d+)(?:[.\s-]+(.*))?$/);
  if (sxxexxMatch) {
    const [, showPart, season, episode, titlePart] = sxxexxMatch;
    const cleanedTitle = titlePart ? cleanEpisodeTitlePart(titlePart) : null;
    return {
      title: cleanedTitle || (showPart || '').replace(/\./g, ' ').trim(),
      seasonNumber: parseInt(season!, 10),
      episodeNumber: parseInt(episode!, 10),
    };
  }

  // Match: "Show.1x05.Title" or "Show - 1x05 - Title"
  const nxnnMatch = nameWithoutExt.match(/^(.+?)[.\s-]+(\d+)x(\d+)(?:[.\s-]+(.*))?$/);
  if (nxnnMatch) {
    const [, showPart, season, episode, titlePart] = nxnnMatch;
    const cleanedTitle = titlePart ? cleanEpisodeTitlePart(titlePart) : null;
    return {
      title: cleanedTitle || (showPart || '').replace(/\./g, ' ').trim(),
      seasonNumber: parseInt(season!, 10),
      episodeNumber: parseInt(episode!, 10),
    };
  }

  // Try to extract year from movie-style filenames
  // Match: "Movie Name (2024)" or "Movie Name [2024]"
  const yearMatch = nameWithoutExt.match(/^(.+?)\s*[[(]((?:19|20)\d{2})[\])]\s*$/);
  if (yearMatch) {
    return {
      title: yearMatch[1]!.replace(/\./g, ' ').trim(),
      year: parseInt(yearMatch[2]!, 10),
    };
  }

  // Match: "Movie.Name.2024" (year at end, dot-separated)
  const dotYearMatch = nameWithoutExt.match(/^(.+?)\.+((?:19|20)\d{2})$/);
  if (dotYearMatch) {
    return {
      title: dotYearMatch[1]!.replace(/\./g, ' ').trim(),
      year: parseInt(dotYearMatch[2]!, 10),
    };
  }

  // No special patterns found, just clean up the filename
  return {
    title: nameWithoutExt.replace(/\./g, ' ').trim(),
  };
}

/**
 * Embedded video metadata adapter
 *
 * Extracts metadata from video file tags using ffprobe.
 * Falls back to filename parsing when embedded tags are missing.
 */
export class EmbeddedVideoMetadataAdapter implements VideoMetadataAdapter {
  readonly name = 'embedded';

  private readonly ffprobePath: string;
  private readonly spawnFn: SpawnFn;

  constructor(config: EmbeddedVideoMetadataConfig = {}) {
    this.ffprobePath = config.ffprobePath ?? DEFAULT_FFPROBE;
    this.spawnFn = config._spawnFn ?? spawn;
  }

  /**
   * Check if this adapter can handle the given file
   *
   * Returns true for common video file extensions.
   */
  async canHandle(filePath: string): Promise<boolean> {
    const ext = path.extname(filePath).toLowerCase();
    return VIDEO_EXTENSIONS.has(ext);
  }

  /**
   * Extract metadata from the video file
   *
   * Uses ffprobe to read embedded tags. Falls back to filename
   * parsing when tags are missing or incomplete.
   */
  async getMetadata(filePath: string): Promise<VideoMetadata | null> {
    const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', filePath];

    const result = await execFFprobe(this.ffprobePath, args, this.spawnFn);

    if (result.exitCode !== 0) {
      // Check for common error patterns
      if (result.stderr.includes('No such file or directory')) {
        throw new VideoMetadataError(`File not found: ${filePath}`, result.exitCode, result.stderr);
      }
      throw new VideoMetadataError(
        `ffprobe failed with exit code ${result.exitCode}`,
        result.exitCode,
        result.stderr
      );
    }

    // Parse JSON output
    let data: FFprobeMetadataOutput;
    try {
      data = JSON.parse(result.stdout);
    } catch {
      throw new VideoMetadataError('Failed to parse ffprobe JSON output', undefined, result.stdout);
    }

    const tags = data.format?.tags ?? {};
    const filenameParsed = parseFilename(filePath);

    // Use filename-parsed title as fallback
    const fallbackTitle = filenameParsed.title;

    // Determine content type
    // Priority: embedded tags > filename pattern
    const hasTVShowTags = isTVShowTags(tags);
    const hasTVShowFilename = filenameParsed.seasonNumber !== undefined;

    if (hasTVShowTags) {
      // TV show with embedded metadata
      return buildTVShowMetadata(tags, fallbackTitle);
    }

    if (hasTVShowFilename) {
      // TV show detected from filename pattern
      // Use embedded tags where available, filename pattern for episode info
      const metadata: TVShowMetadata = {
        contentType: 'tvshow',
        title: tags.title || fallbackTitle,
        seriesTitle: tags.show || fallbackTitle,
        seasonNumber: filenameParsed.seasonNumber!,
        episodeNumber: filenameParsed.episodeNumber!,
        episodeId: formatEpisodeId(filenameParsed.seasonNumber!, filenameParsed.episodeNumber!),
        year: parseYear(tags.date) ?? parseYear(tags.year) ?? filenameParsed.year,
        description: tags.description || tags.comment || tags.synopsis,
        genre: tags.genre,
        network: tags.network,
      };
      return metadata;
    }

    // Movie (default)
    const movieMetadata = buildMovieMetadata(tags, fallbackTitle);

    // Apply filename-parsed year as fallback
    if (movieMetadata.year === undefined && filenameParsed.year !== undefined) {
      movieMetadata.year = filenameParsed.year;
    }

    return movieMetadata;
  }
}
