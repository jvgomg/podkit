/**
 * VideoDirectoryAdapter - Scans filesystem directories for video files
 *
 * Similar to the audio DirectoryAdapter, but handles video-specific
 * metadata extraction and content type detection.
 */

import { glob } from 'glob';
import { extname, basename, resolve } from 'node:path';
import type { ContentType, VideoMetadata, VideoMetadataAdapter } from './metadata.js';
import type { VideoSourceAnalysis } from './types.js';
import { EmbeddedVideoMetadataAdapter } from './metadata-embedded.js';
import { probeVideo, VideoProbeError } from './probe.js';
import { detectContentType } from './content-type.js';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a title looks like a scene release name
 *
 * Scene releases typically have:
 * - Dots separating words instead of spaces
 * - Quality indicators (720p, 1080p, BluRay, etc.)
 * - Release group names
 *
 * We want to detect these so we can prefer filename-parsed titles instead.
 */
function looksLikeSceneRelease(title: string): boolean {
  // If it has multiple dots with words between them (e.g., "Movie.Name.2020")
  const dotCount = (title.match(/\./g) || []).length;
  if (dotCount >= 3) {
    return true;
  }

  // Quality/release indicators
  const scenePatterns = [
    /\b(720p|1080p|2160p|4K|480p|576p)\b/i,
    /\b(HDTV|WEB-?DL|WEB-?Rip|BluRay|BRRip|DVDRip|BDRip)\b/i,
    /\b(x264|x265|h\.?264|h\.?265|HEVC|XviD|DivX|AVC)\b/i,
    /\b(AAC|AC3|DTS|DTS-HD|DD5\.1|FLAC|TrueHD)\b/i,
    /\b(REMUX|REPACK|PROPER|INTERNAL)\b/i,
    /-[A-Z0-9]+$/i, // Release group suffix like "-FraMeSToR"
  ];

  return scenePatterns.some((pattern) => pattern.test(title));
}

// =============================================================================
// Types
// =============================================================================

/**
 * A video from a collection source
 *
 * Combines file information, technical analysis, and metadata
 * for video sync operations.
 */
export interface CollectionVideo {
  /**
   * Unique identifier within collection
   * (file path for directory adapter)
   */
  id: string;

  /** Absolute path to the video file */
  filePath: string;

  /** Content type: movie or tvshow */
  contentType: ContentType;

  // From VideoMetadata
  /** Video title (movie title or episode title) */
  title: string;

  /** Release year */
  year?: number;

  /** Description or synopsis */
  description?: string;

  /** Primary genre */
  genre?: string;

  // Movie-specific
  /** Director name */
  director?: string;

  /** Production studio */
  studio?: string;

  // TV-specific
  /** Series/show title */
  seriesTitle?: string;

  /** Season number (1-based) */
  seasonNumber?: number;

  /** Episode number within season (1-based) */
  episodeNumber?: number;

  /** Episode identifier string (e.g., 'S01E01') */
  episodeId?: string;

  /** Network or streaming service */
  network?: string;

  // From VideoSourceAnalysis
  /** Container format (e.g., 'mkv', 'mp4') */
  container: string;

  /** Video codec name (e.g., 'h264', 'hevc') */
  videoCodec: string;

  /** Audio codec name (e.g., 'aac', 'ac3') */
  audioCodec: string;

  /** Video width in pixels */
  width: number;

  /** Video height in pixels */
  height: number;

  /** Duration in seconds */
  duration: number;
}

/**
 * Progress information during video directory scan
 */
export interface VideoScanProgress {
  /** Current phase of the scan */
  phase: 'discovering' | 'analyzing';

  /** Number of files processed so far */
  processed: number;

  /** Total number of files (0 during discovery) */
  total: number;

  /** Current file being processed */
  currentFile?: string;
}

/**
 * Warning emitted during video directory scanning
 */
export interface VideoScanWarning {
  /** Path to the file that caused the warning */
  file: string;

  /** Warning message describing the issue */
  message: string;
}

/**
 * Filter for querying videos from a collection
 */
export interface VideoFilter {
  /** Content type filter (movie or tvshow) */
  contentType?: ContentType;

  /** Genre filter (case-insensitive partial match) */
  genre?: string;

  /** Year filter (exact match) */
  year?: number;

  /** Series title filter for TV shows (case-insensitive partial match) */
  seriesTitle?: string;

  /** Season number filter for TV shows */
  seasonNumber?: number;

  /** Path pattern filter (glob-style) */
  pathPattern?: string;
}

/**
 * Configuration for VideoDirectoryAdapter
 */
export interface VideoDirectoryAdapterConfig {
  /** Root directory to scan for video files */
  path: string;

  /** File extensions to include (defaults to common video formats) */
  extensions?: string[];

  /** Custom metadata adapter (defaults to EmbeddedVideoMetadataAdapter) */
  metadataAdapter?: VideoMetadataAdapter;

  /** Progress callback for scan updates */
  onProgress?: (progress: VideoScanProgress) => void;

  /** Warning callback for non-fatal issues during scanning */
  onWarning?: (warning: VideoScanWarning) => void;
}

// =============================================================================
// Constants
// =============================================================================

/** Default video file extensions to scan */
const DEFAULT_EXTENSIONS = ['mkv', 'mp4', 'm4v', 'avi', 'mov', 'webm', 'wmv'];

// =============================================================================
// VideoDirectoryAdapter
// =============================================================================

/**
 * VideoDirectoryAdapter implementation
 *
 * Scans a directory recursively for video files, extracts metadata
 * using a VideoMetadataAdapter, and probes technical information.
 */
export class VideoDirectoryAdapter {
  readonly name = 'video-directory';

  private rootPath: string;
  private extensions: string[];
  private metadataAdapter: VideoMetadataAdapter;
  private onProgress?: (progress: VideoScanProgress) => void;
  private onWarning?: (warning: VideoScanWarning) => void;
  private cache: CollectionVideo[] = [];
  private connected = false;

  constructor(config: VideoDirectoryAdapterConfig) {
    this.rootPath = resolve(config.path);
    this.extensions = config.extensions ?? DEFAULT_EXTENSIONS;
    this.metadataAdapter = config.metadataAdapter ?? new EmbeddedVideoMetadataAdapter();
    this.onProgress = config.onProgress;
    this.onWarning = config.onWarning;
  }

  /**
   * Connect to the collection by scanning the directory
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    await this.scan();
    this.connected = true;
  }

  /**
   * Scan the directory for video files and extract metadata
   */
  private async scan(): Promise<void> {
    // Report discovery phase
    this.onProgress?.({
      phase: 'discovering',
      processed: 0,
      total: 0,
    });

    // Build glob pattern for video files
    const pattern =
      this.extensions.length === 1
        ? `**/*.${this.extensions[0]}`
        : `**/*.{${this.extensions.join(',')}}`;

    // Find all video files
    const files = await glob(pattern, {
      cwd: this.rootPath,
      absolute: true,
      nodir: true,
      // Handle special characters in paths
      nocase: process.platform === 'darwin' || process.platform === 'win32',
    });

    // Sort files for consistent ordering
    files.sort();

    // Analyze each file
    this.cache = [];
    const total = files.length;

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i]!;

      this.onProgress?.({
        phase: 'analyzing',
        processed: i,
        total,
        currentFile: filePath,
      });

      try {
        const video = await this.analyzeFile(filePath);
        this.cache.push(video);
      } catch (err) {
        // Report warning but continue with other files
        this.onWarning?.({
          file: filePath,
          message: `Failed to analyze: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    // Final progress report
    this.onProgress?.({
      phase: 'analyzing',
      processed: total,
      total,
    });
  }

  /**
   * Analyze a single video file - extract metadata and probe technical info
   */
  private async analyzeFile(filePath: string): Promise<CollectionVideo> {
    // Probe video for technical information
    let analysis: VideoSourceAnalysis;
    try {
      analysis = await probeVideo(filePath);
    } catch (err) {
      // Re-throw VideoProbeError with more context
      if (err instanceof VideoProbeError) {
        throw err;
      }
      throw new Error(`Failed to probe video: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Extract metadata
    let metadata: VideoMetadata | null = null;
    if (await this.metadataAdapter.canHandle(filePath)) {
      try {
        metadata = await this.metadataAdapter.getMetadata(filePath);
      } catch (err) {
        // Metadata extraction is not fatal - fall back to filename/path detection
        this.onWarning?.({
          file: filePath,
          message: `Metadata extraction failed, using filename: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    // Determine content type and extract additional info
    const contentTypeResult = detectContentType(filePath, metadata ?? undefined);

    // Determine title based on content type
    let title: string;
    const metadataTitle = metadata?.title;
    const metadataTitleIsSceneRelease = metadataTitle && looksLikeSceneRelease(metadataTitle);

    if (contentTypeResult.type === 'tvshow') {
      // For TV shows, title should be episode-specific, not series title
      // Use episode ID format (e.g., "S01E01") or leave for later formatting
      if (metadataTitle && !metadataTitleIsSceneRelease) {
        // Use clean metadata title as episode title
        title = metadataTitle;
      } else if (contentTypeResult.episodeId) {
        // Use episode ID as title (e.g., "S01E01")
        title = contentTypeResult.episodeId;
      } else {
        // Fallback to filename
        title = this.getTitleFromPath(filePath);
      }
    } else if (metadataTitle && !metadataTitleIsSceneRelease) {
      // Prefer embedded metadata title if it's clean (not a scene release name)
      title = metadataTitle;
    } else if (contentTypeResult.type === 'movie' && contentTypeResult.parsedTitle) {
      // For movies, use library-parsed title
      title = contentTypeResult.parsedTitle;
    } else {
      // Fallback to filename-based title
      title = this.getTitleFromPath(filePath);
    }

    // Determine year (for movies)
    const year =
      metadata?.year ??
      (contentTypeResult.type === 'movie' ? contentTypeResult.parsedYear : undefined);

    // Build CollectionVideo
    const video: CollectionVideo = {
      id: filePath,
      filePath,
      contentType: contentTypeResult.type,
      title,

      // Metadata fields
      year,
      description: metadata?.description,
      genre: metadata?.genre,

      // Movie-specific (from metadata if it's a movie)
      director: metadata?.contentType === 'movie' ? metadata.director : undefined,
      studio: metadata?.contentType === 'movie' ? metadata.studio : undefined,

      // TV-specific (use content type detection which already handles metadata)
      seriesTitle: contentTypeResult.seriesTitle,
      seasonNumber:
        metadata?.contentType === 'tvshow' ? metadata.seasonNumber : contentTypeResult.seasonNumber,
      episodeNumber:
        metadata?.contentType === 'tvshow'
          ? metadata.episodeNumber
          : contentTypeResult.episodeNumber,
      episodeId:
        metadata?.contentType === 'tvshow' ? metadata.episodeId : contentTypeResult.episodeId,
      network: metadata?.contentType === 'tvshow' ? metadata.network : undefined,

      // Technical info from probe
      container: analysis.container,
      videoCodec: analysis.videoCodec,
      audioCodec: analysis.audioCodec,
      width: analysis.width,
      height: analysis.height,
      duration: analysis.duration,
    };

    return video;
  }

  /**
   * Extract title from filename when metadata is missing
   */
  private getTitleFromPath(filePath: string): string {
    const filename = basename(filePath);
    const ext = extname(filename);
    // Remove extension and clean up common patterns
    let title = filename.slice(0, -ext.length);

    // Replace dots and underscores with spaces
    title = title.replace(/[._]/g, ' ');

    // Remove common quality/release indicators
    title = title.replace(/\b(720p|1080p|2160p|4K|HDTV|WEB-?DL|BluRay|BRRip)\b/gi, '');
    title = title.replace(/\b(x264|x265|h\.?264|h\.?265|HEVC)\b/gi, '');
    title = title.replace(/\b(AAC|AC3|DTS|DD5\.1)\b/gi, '');

    // Remove year in parentheses/brackets but keep the title
    title = title.replace(/\s*[[(]\d{4}[\])]\s*$/, '');

    // Clean up whitespace
    title = title.replace(/\s+/g, ' ').trim();

    return title || 'Unknown Video';
  }

  /**
   * Get all videos in the collection
   */
  async getVideos(): Promise<CollectionVideo[]> {
    if (!this.connected) {
      await this.connect();
    }
    return this.cache;
  }

  /**
   * Get videos matching filter criteria
   */
  async getFilteredVideos(filter: VideoFilter): Promise<CollectionVideo[]> {
    if (!this.connected) {
      await this.connect();
    }

    return this.cache.filter((video) => {
      // Content type filter
      if (filter.contentType && video.contentType !== filter.contentType) {
        return false;
      }

      // Genre filter (case-insensitive partial match)
      if (filter.genre && (!video.genre || !this.matchesFilter(video.genre, filter.genre))) {
        return false;
      }

      // Year filter (exact match)
      if (filter.year !== undefined && video.year !== filter.year) {
        return false;
      }

      // Series title filter for TV shows
      if (
        filter.seriesTitle &&
        (!video.seriesTitle || !this.matchesFilter(video.seriesTitle, filter.seriesTitle))
      ) {
        return false;
      }

      // Season number filter
      if (filter.seasonNumber !== undefined && video.seasonNumber !== filter.seasonNumber) {
        return false;
      }

      // Path pattern filter (glob-style matching)
      if (filter.pathPattern) {
        const regex = this.globToRegex(filter.pathPattern);
        if (!regex.test(video.filePath)) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Case-insensitive partial match for filter strings
   */
  private matchesFilter(value: string, filter: string): boolean {
    return value.toLowerCase().includes(filter.toLowerCase());
  }

  /**
   * Convert glob pattern to regex
   */
  private globToRegex(pattern: string): RegExp {
    // Escape special regex characters except * and **
    const regex = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/{{GLOBSTAR}}/g, '.*');

    return new RegExp(regex, 'i');
  }

  /**
   * Get the source file path for a video
   */
  getFilePath(video: CollectionVideo): string {
    return video.filePath;
  }

  /**
   * Disconnect and cleanup resources
   */
  async disconnect(): Promise<void> {
    this.cache = [];
    this.connected = false;
  }

  /**
   * Get the root path being scanned
   */
  getRootPath(): string {
    return this.rootPath;
  }

  /**
   * Get the number of videos in the cache
   */
  getVideoCount(): number {
    return this.cache.length;
  }
}

/**
 * Create a VideoDirectoryAdapter instance
 */
export function createVideoDirectoryAdapter(
  config: VideoDirectoryAdapterConfig
): VideoDirectoryAdapter {
  return new VideoDirectoryAdapter(config);
}
