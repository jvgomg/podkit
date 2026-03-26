/**
 * DirectoryAdapter - Scans filesystem directories for audio files
 *
 * Uses music-metadata library to parse metadata from audio files.
 * Supports FLAC, MP3, M4A, OGG, and OPUS formats.
 */

import { glob } from 'glob';
import * as mm from 'music-metadata';
import { extname, basename, resolve } from 'node:path';
import type { CollectionAdapter, CollectionTrack, FileAccess } from './interface.js';
import type { AudioFileType, TrackFilter } from '../types.js';
import { extractSoundcheck } from '../metadata/soundcheck.js';
import { selectBestPicture } from '../artwork/extractor.js';
import { hashArtwork } from '../artwork/hash.js';

/**
 * Warning emitted during directory scanning
 */
export interface ScanWarning {
  /** Path to the file that caused the warning */
  file: string;
  /** Warning message describing the issue */
  message: string;
}

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
  /** Warning callback for non-fatal issues during scanning */
  onWarning?: (warning: ScanWarning) => void;
  /** When true, compute artwork hashes for change detection (--check-artwork) */
  checkArtwork?: boolean;
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
const DEFAULT_EXTENSIONS = ['flac', 'mp3', 'm4a', 'ogg', 'opus', 'wav', 'aiff', 'aif'];

/** Map of file extensions to AudioFileType */
const EXTENSION_TO_TYPE: Record<string, AudioFileType> = {
  '.flac': 'flac',
  '.mp3': 'mp3',
  '.m4a': 'm4a',
  '.aac': 'aac',
  '.ogg': 'ogg',
  '.opus': 'opus',
  '.wav': 'wav',
  '.aiff': 'aiff',
  '.aif': 'aiff',
};

/** Codecs that are considered lossless */
const LOSSLESS_CODECS = new Set([
  'flac',
  'alac',
  'pcm_s16le',
  'pcm_s16be',
  'pcm_s24le',
  'pcm_s24be',
  'pcm_s32le',
  'pcm_s32be',
  'pcm_f32le',
  'pcm_f32be',
  'pcm_alaw',
  'pcm_mulaw',
  'aiff',
  'wav',
]);

/**
 * Determine if a codec is lossless
 */
function isLosslessCodec(codec: string | undefined, fileType: AudioFileType): boolean {
  // Unambiguously lossless by file type
  if (['flac', 'wav', 'aiff'].includes(fileType)) {
    return true;
  }

  // Check codec name
  if (codec) {
    const normalizedCodec = codec.toLowerCase();
    if (LOSSLESS_CODECS.has(normalizedCodec)) {
      return true;
    }
    // ALAC detection from codec name
    if (normalizedCodec.includes('alac')) {
      return true;
    }
  }

  return false;
}

/**
 * DirectoryAdapter implementation
 *
 * Scans a directory recursively for audio files and parses their metadata
 * using the music-metadata library.
 */
export class DirectoryAdapter implements CollectionAdapter<CollectionTrack, TrackFilter> {
  readonly name = 'directory';
  readonly adapterType = 'directory';

  private rootPath: string;
  private extensions: string[];
  private onProgress?: (progress: ScanProgress) => void;
  private onWarning?: (warning: ScanWarning) => void;
  private checkArtwork: boolean;
  private cache: CollectionTrack[] = [];
  private connected = false;

  constructor(config: DirectoryAdapterConfig) {
    this.rootPath = resolve(config.path);
    this.extensions = config.extensions ?? DEFAULT_EXTENSIONS;
    this.onProgress = config.onProgress;
    this.onWarning = config.onWarning;
    this.checkArtwork = config.checkArtwork ?? false;
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
        // Report warning but continue with other files
        // Users with unreadable files shouldn't have entire scan fail
        this.onWarning?.({
          file: filePath,
          message: `Failed to parse: ${err instanceof Error ? err.message : String(err)}`,
        });
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
    // Parse metadata with music-metadata.
    // We use skipCovers: false so that music-metadata populates common.picture,
    // allowing us to detect artwork presence for upgrade detection (artwork-added).
    // We immediately discard the raw image bytes after reading the count, so the
    // memory overhead is proportional to the number of files with artwork, not
    // the total artwork size — each IPicture object's .data field is freed once
    // we capture hasArtwork below.
    const metadata = await mm.parseFile(filePath, {
      skipCovers: false,
    });

    const { common, format } = metadata;

    // Note: We could get file stats for size and mtime here if needed
    // Currently not used but reserved for future use

    // Extract file type and codec information
    const fileType = this.getFileType(filePath);
    const codec = format.codec?.toLowerCase();
    const lossless = isLosslessCodec(codec, fileType);

    // Calculate bitrate in kbps
    let bitrate: number | undefined;
    if (format.bitrate) {
      bitrate = Math.round(format.bitrate / 1000);
    }

    // Detect artwork presence from embedded pictures.
    // common.picture is populated by music-metadata when skipCovers: false.
    // We only need to know whether artwork exists (boolean), not the actual bytes.
    const pictures = common.picture;
    const hasArtwork = (pictures?.length ?? 0) > 0;

    // Compute artwork hash for change detection (when --check-artwork is enabled)
    let artworkHash: string | undefined;
    if (this.checkArtwork && pictures && pictures.length > 0) {
      const bestPicture = selectBestPicture(pictures);
      artworkHash = hashArtwork(bestPicture.data);
    }

    // Volume normalization
    const scResult = extractSoundcheck(metadata);

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
      compilation: common.compilation ?? undefined,
      duration: format.duration ? Math.floor(format.duration * 1000) : undefined,

      // File info
      filePath,
      fileType,

      // Audio format details (for transcoding decisions)
      codec,
      lossless,
      bitrate,

      // Artwork
      hasArtwork,
      artworkHash,

      // Volume normalization
      soundcheck: scResult?.value,
      soundcheckSource: scResult?.source,

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
   * Get all items in the collection
   */
  async getItems(): Promise<CollectionTrack[]> {
    if (!this.connected) {
      await this.connect();
    }
    return this.cache;
  }

  /**
   * Get items matching filter criteria
   */
  async getFilteredItems(filter: TrackFilter): Promise<CollectionTrack[]> {
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
   * Get file access for a track
   *
   * DirectoryAdapter returns path-based access since files are local.
   */
  getFileAccess(track: CollectionTrack): FileAccess {
    return {
      type: 'path',
      path: track.filePath,
    };
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
