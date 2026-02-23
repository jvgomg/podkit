/**
 * DirectoryAdapter - Scans filesystem directories for audio files
 *
 * Uses music-metadata library to parse metadata from audio files.
 * Supports FLAC, MP3, M4A, OGG, and OPUS formats.
 */

import { glob } from 'glob';
import * as mm from 'music-metadata';
import { extname, basename, resolve } from 'node:path';
import type { CollectionAdapter, CollectionTrack } from './interface.js';
import type { AudioFileType, TrackFilter } from '../types.js';

/**
 * Configuration for DirectoryAdapter
 */
export interface DirectoryAdapterConfig {
  /** Root directory to scan for audio files */
  path: string;
  /** File extensions to include (defaults to common audio formats) */
  extensions?: string[];
  /** Progress callback for scan updates */
  onProgress?: (progress: ScanProgress) => void;
}

/**
 * Progress information during directory scan
 */
export interface ScanProgress {
  /** Current phase of the scan */
  phase: 'discovering' | 'parsing';
  /** Number of files processed so far */
  processed: number;
  /** Total number of files (0 during discovery) */
  total: number;
  /** Current file being processed */
  currentFile?: string;
}

/** Default audio file extensions to scan */
const DEFAULT_EXTENSIONS = ['flac', 'mp3', 'm4a', 'ogg', 'opus'];

/** Map of file extensions to AudioFileType */
const EXTENSION_TO_TYPE: Record<string, AudioFileType> = {
  '.flac': 'flac',
  '.mp3': 'mp3',
  '.m4a': 'm4a',
  '.aac': 'aac',
  '.ogg': 'ogg',
  '.opus': 'opus',
  '.wav': 'wav',
};

/**
 * DirectoryAdapter implementation
 *
 * Scans a directory recursively for audio files and parses their metadata
 * using the music-metadata library.
 */
export class DirectoryAdapter implements CollectionAdapter {
  readonly name = 'directory';

  private rootPath: string;
  private extensions: string[];
  private onProgress?: (progress: ScanProgress) => void;
  private cache: CollectionTrack[] = [];
  private connected = false;

  constructor(config: DirectoryAdapterConfig) {
    this.rootPath = resolve(config.path);
    this.extensions = config.extensions ?? DEFAULT_EXTENSIONS;
    this.onProgress = config.onProgress;
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
   * Scan the directory for audio files and parse metadata
   */
  private async scan(): Promise<void> {
    // Report discovery phase
    this.onProgress?.({
      phase: 'discovering',
      processed: 0,
      total: 0,
    });

    // Build glob pattern for audio files
    const pattern =
      this.extensions.length === 1
        ? `**/*.${this.extensions[0]}`
        : `**/*.{${this.extensions.join(',')}}`;

    // Find all audio files
    const files = await glob(pattern, {
      cwd: this.rootPath,
      absolute: true,
      nodir: true,
      // Handle special characters in paths
      nocase: process.platform === 'darwin' || process.platform === 'win32',
    });

    // Sort files for consistent ordering
    files.sort();

    // Parse each file
    this.cache = [];
    const total = files.length;

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i]!;

      this.onProgress?.({
        phase: 'parsing',
        processed: i,
        total,
        currentFile: filePath,
      });

      try {
        const track = await this.parseFile(filePath);
        this.cache.push(track);
      } catch (err) {
        // Log warning but continue with other files
        // Users with unreadable files shouldn't have entire scan fail
        // eslint-disable-next-line no-console
        console.warn(`Failed to parse ${filePath}:`, err instanceof Error ? err.message : err);
      }
    }

    // Final progress report
    this.onProgress?.({
      phase: 'parsing',
      processed: total,
      total,
    });
  }

  /**
   * Parse metadata from a single audio file
   */
  private async parseFile(filePath: string): Promise<CollectionTrack> {
    // Parse metadata with music-metadata
    const metadata = await mm.parseFile(filePath, {
      // Skip picture data during scanning for performance
      // Artwork extraction happens separately during sync
      skipCovers: true,
    });

    const { common, format } = metadata;

    // Note: We could get file stats for size and mtime here if needed
    // Currently not used but reserved for future use

    // Build track object
    const track: CollectionTrack = {
      // Use file path as unique ID
      id: filePath,

      // Core metadata (with fallbacks)
      title: common.title || this.getTitleFromPath(filePath),
      artist: common.artist || 'Unknown Artist',
      album: common.album || 'Unknown Album',

      // Extended metadata
      albumArtist: common.albumartist,
      genre: common.genre?.[0],
      year: common.year,
      trackNumber: common.track?.no ?? undefined,
      discNumber: common.disk?.no ?? undefined,
      duration: format.duration ? Math.floor(format.duration * 1000) : undefined,

      // File info
      filePath,
      fileType: this.getFileType(filePath),

      // External identifiers
      musicBrainzRecordingId: common.musicbrainz_recordingid,
      musicBrainzReleaseId: common.musicbrainz_albumid,
      acoustId: common.acoustid_id,
    };

    return track;
  }

  /**
   * Extract title from filename when metadata is missing
   */
  private getTitleFromPath(filePath: string): string {
    const filename = basename(filePath);
    const ext = extname(filename);
    // Remove extension and clean up common patterns
    let title = filename.slice(0, -ext.length);

    // Remove leading track numbers like "01 - ", "01. ", "01_"
    title = title.replace(/^\d{1,3}[\s._-]+/, '');

    return title || 'Unknown Title';
  }

  /**
   * Determine audio file type from extension
   */
  private getFileType(filePath: string): AudioFileType {
    const ext = extname(filePath).toLowerCase();
    return EXTENSION_TO_TYPE[ext] ?? 'm4a';
  }

  /**
   * Get all tracks in the collection
   */
  async getTracks(): Promise<CollectionTrack[]> {
    if (!this.connected) {
      await this.connect();
    }
    return this.cache;
  }

  /**
   * Get tracks matching filter criteria
   */
  async getFilteredTracks(filter: TrackFilter): Promise<CollectionTrack[]> {
    if (!this.connected) {
      await this.connect();
    }

    return this.cache.filter((track) => {
      // Artist filter (case-insensitive partial match)
      if (filter.artist && !this.matchesFilter(track.artist, filter.artist)) {
        // Also check albumArtist
        if (!track.albumArtist || !this.matchesFilter(track.albumArtist, filter.artist)) {
          return false;
        }
      }

      // Album filter (case-insensitive partial match)
      if (filter.album && !this.matchesFilter(track.album, filter.album)) {
        return false;
      }

      // Genre filter (case-insensitive partial match)
      if (filter.genre && (!track.genre || !this.matchesFilter(track.genre, filter.genre))) {
        return false;
      }

      // Year filter (exact match)
      if (filter.year !== undefined && track.year !== filter.year) {
        return false;
      }

      // Path pattern filter (glob-style matching)
      if (filter.pathPattern) {
        // Simple glob matching - supports * and **
        const regex = this.globToRegex(filter.pathPattern);
        if (!regex.test(track.filePath)) {
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
   * Get the source file path for a track
   */
  getFilePath(track: CollectionTrack): string {
    return track.filePath;
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
   * Get the number of tracks in the cache
   */
  getTrackCount(): number {
    return this.cache.length;
  }
}

/**
 * Create a DirectoryAdapter instance
 */
export function createDirectoryAdapter(config: DirectoryAdapterConfig): DirectoryAdapter {
  return new DirectoryAdapter(config);
}
