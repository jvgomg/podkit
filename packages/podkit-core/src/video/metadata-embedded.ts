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
const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.m4v',
  '.mkv',
  '.avi',
  '.mov',
  '.webm',
]);

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
function buildMovieMetadata(
  tags: FFprobeFormatTags,
  fallbackTitle: string
): MovieMetadata {
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
function buildTVShowMetadata(
  tags: FFprobeFormatTags,
  fallbackTitle: string
): TVShowMetadata {
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
 * Parse metadata from filename
 *
 * Handles patterns like:
 * - "Movie Name (2024).mp4" -> title: "Movie Name", year: 2024
 * - "Movie Name [2024].mp4" -> title: "Movie Name", year: 2024
 * - "Show.S01E05.Episode.Title.mp4" -> TV show pattern
 * - "Show.1x05.Episode.Title.mp4" -> TV show pattern
 * - "Show - S01E05 - Episode Title.mp4" -> TV show pattern
 */
export function parseFilename(filePath: string): FilenameParsed {
  const basename = path.basename(filePath);
  const ext = path.extname(basename);
  const nameWithoutExt = basename.slice(0, -ext.length);

  // Try to parse TV show patterns first
  // Match: "Show.S01E05.Title" or "Show - S01E05 - Title" or "Show S01E05 Title"
  const sxxexxMatch = nameWithoutExt.match(
    /^(.+?)[.\s-]+[Ss](\d+)[Ee](\d+)(?:[.\s-]+(.*))?$/
  );
  if (sxxexxMatch) {
    const [, showPart, season, episode, titlePart] = sxxexxMatch;
    return {
      title: (titlePart || showPart || '').replace(/\./g, ' ').trim(),
      seasonNumber: parseInt(season!, 10),
      episodeNumber: parseInt(episode!, 10),
    };
  }

  // Match: "Show.1x05.Title" or "Show - 1x05 - Title"
  const nxnnMatch = nameWithoutExt.match(
    /^(.+?)[.\s-]+(\d+)x(\d+)(?:[.\s-]+(.*))?$/
  );
  if (nxnnMatch) {
    const [, showPart, season, episode, titlePart] = nxnnMatch;
    return {
      title: (titlePart || showPart || '').replace(/\./g, ' ').trim(),
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
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      filePath,
    ];

    const result = await execFFprobe(this.ffprobePath, args, this.spawnFn);

    if (result.exitCode !== 0) {
      // Check for common error patterns
      if (result.stderr.includes('No such file or directory')) {
        throw new VideoMetadataError(
          `File not found: ${filePath}`,
          result.exitCode,
          result.stderr
        );
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
      throw new VideoMetadataError(
        'Failed to parse ffprobe JSON output',
        undefined,
        result.stdout
      );
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
