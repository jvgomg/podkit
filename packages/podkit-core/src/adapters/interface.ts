/**
 * Collection adapter interfaces
 *
 * Adapters provide a uniform interface for reading track metadata
 * from different sources (directories, music players, databases).
 */

import type { AudioFileType, TrackFilter } from '../types.js';
import type { Readable } from 'node:stream';
import type { AudioNormalization } from '../metadata/normalization.js';

/**
 * Unified file access - supports both local and remote sources
 *
 * Local adapters return path-based access for direct file operations.
 * Remote adapters return stream-based access for downloading content.
 */
export type FileAccess =
  | { type: 'path'; path: string }
  | { type: 'stream'; getStream: () => Promise<ReadableStream | Readable>; size?: number };

/**
 * A track from a collection source
 */
export interface CollectionTrack {
  /**
   * Unique identifier within collection
   * Implementation-specific (e.g., file path hash, database ID)
   */
  id: string;

  // Core metadata (required)
  title: string;
  artist: string;
  album: string;

  // Extended metadata (optional)
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNumber?: number;
  discNumber?: number;
  compilation?: boolean;
  duration?: number; // milliseconds

  // File info
  filePath: string;
  fileType: AudioFileType;

  // Audio format details (optional, for transcoding decisions)
  /**
   * Audio codec name (e.g., 'flac', 'mp3', 'aac', 'alac', 'vorbis', 'opus', 'pcm_s16le')
   * Used to detect ALAC vs AAC in M4A containers
   */
  codec?: string;

  /**
   * Whether the source is lossless (true for flac, alac, wav, aiff, pcm codecs)
   * Derived from codec or fileType
   */
  lossless?: boolean;

  /**
   * Source bitrate in kbps (for logging/display purposes)
   */
  bitrate?: number;

  // Artwork
  /**
   * Whether the source file has embedded artwork.
   * Used by upgrade detection to flag `artwork-added` when the iPod track has
   * no artwork but the source does.
   *
   * - `true`:  artwork is embedded in the source file (or available on the server for remote sources)
   * - `false`: no artwork detected
   * - `undefined`: artwork availability not determined (treated as unknown — no upgrade triggered)
   */
  hasArtwork?: boolean;

  /**
   * Hash of the artwork bytes (8-char lowercase hex, xxHash truncated to 32 bits).
   * Populated by adapters when `--check-artwork` is enabled.
   * Used to detect artwork changes (not just presence/absence) via sync tags.
   *
   * `hasArtwork` may be `true` while `artworkHash` is `undefined` — this is the
   * normal case when `--check-artwork` is not passed (artwork present but hash
   * not computed).
   */
  artworkHash?: string;

  // Volume normalization
  /** Audio normalization data (ReplayGain, Sound Check) in native source format */
  normalization?: AudioNormalization;

  // Identifiers (optional, for advanced matching)
  musicBrainzRecordingId?: string;
  musicBrainzReleaseId?: string;
  acoustId?: string;
}

/**
 * Generic adapter for reading items from a collection source
 *
 * @typeParam TItem - The item type returned by the adapter (e.g., CollectionTrack, CollectionVideo)
 * @typeParam TFilter - The filter type for querying items (e.g., TrackFilter, VideoFilter)
 *
 * Implementations:
 * - DirectoryAdapter: Scan filesystem directories for audio files
 * - SubsonicAdapter: Fetch tracks from Subsonic-compatible servers
 * - VideoDirectoryAdapter: Scan filesystem directories for video files
 */
export interface CollectionAdapter<TItem = CollectionTrack, TFilter = TrackFilter> {
  /**
   * Human-readable name for this adapter
   */
  readonly name: string;

  /**
   * Technical adapter type identifier (e.g., 'directory', 'subsonic', 'video-directory')
   */
  readonly adapterType: string;

  /**
   * Connect to the collection source
   * May perform initial validation or setup
   */
  connect(): Promise<void>;

  /**
   * Get all items in collection
   */
  getItems(): Promise<TItem[]>;

  /**
   * Get items matching filter criteria
   */
  getFilteredItems(filter: TFilter): Promise<TItem[]>;

  /**
   * Get file access for an item
   *
   * Local adapters return: { type: 'path', path: '/absolute/path.flac' }
   * Remote adapters return: { type: 'stream', getStream: () => ..., size: 12345 }
   *
   * @param item - The item to get file access for
   * @returns FileAccess object for reading the item's data
   */
  getFileAccess(item: TItem): FileAccess | Promise<FileAccess>;

  /**
   * Disconnect from source and cleanup resources
   */
  disconnect(): Promise<void>;
}

/**
 * Music collection adapter type alias
 *
 * Adapters that provide audio tracks with track-based filtering.
 */
export type MusicAdapter = CollectionAdapter<CollectionTrack, TrackFilter>;

/**
 * Video collection adapter type alias
 *
 * Adapters that provide video items with video-based filtering.
 * Note: VideoAdapter uses types from the video module — import CollectionVideo
 * and VideoFilter from '../video/directory-adapter.js' when needed.
 */
// VideoAdapter is defined as a re-export in the package index to avoid
// circular imports (video types are in the video module, not here).
// See: src/index.ts for the VideoAdapter type alias.

/**
 * Configuration for creating a directory adapter
 */
export interface DirectoryAdapterConfig {
  type: 'directory';
  /** Directory path to scan for audio files */
  path: string;
  /** File extensions to include (defaults to common audio formats) */
  extensions?: string[];
}

/**
 * Configuration for creating a Subsonic adapter
 */
export interface SubsonicAdapterConfig {
  type: 'subsonic';
  /** Subsonic server URL */
  url: string;
  /** Username for authentication */
  username: string;
  /** Password for authentication */
  password: string;
}

/**
 * Configuration for creating an adapter
 */
export type AdapterConfig = DirectoryAdapterConfig | SubsonicAdapterConfig;
