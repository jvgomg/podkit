/**
 * Collection adapter interfaces
 *
 * Adapters provide a uniform interface for reading track metadata
 * from different sources (directories, music players, databases).
 */

import type { AudioFileType, TrackFilter } from '../types.js';

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

  // Identifiers (optional, for advanced matching)
  musicBrainzRecordingId?: string;
  musicBrainzReleaseId?: string;
  acoustId?: string;
}

/**
 * Adapter for reading tracks from a collection source
 *
 * Implementations:
 * - DirectoryAdapter: Scan filesystem directories
 * - Future: StrawberryAdapter, BeetsAdapter, etc.
 */
export interface CollectionAdapter {
  /**
   * Human-readable name for this adapter
   */
  readonly name: string;

  /**
   * Connect to the collection source
   * May perform initial validation or setup
   */
  connect(): Promise<void>;

  /**
   * Get all tracks in collection
   */
  getTracks(): Promise<CollectionTrack[]>;

  /**
   * Get tracks matching filter criteria
   */
  getFilteredTracks(filter: TrackFilter): Promise<CollectionTrack[]>;

  /**
   * Get the source file path for a track
   * Returns the absolute path to the audio file
   */
  getFilePath(track: CollectionTrack): string;

  /**
   * Disconnect from source and cleanup resources
   */
  disconnect(): Promise<void>;
}

/**
 * Configuration for creating an adapter
 */
export interface AdapterConfig {
  /** Type of adapter to create */
  type: 'directory';
  /** Source path (directory path, database path, etc.) */
  path: string;
  /** File extensions to include (defaults to common audio formats) */
  extensions?: string[];
}
