/**
 * Collection adapter interfaces
 *
 * Adapters provide a uniform interface for reading track metadata
 * from different sources (directories, music players, databases).
 */

import type { AudioFileType, TrackFilter } from '../types.js';
import type { Readable } from 'node:stream';

/**
 * Source of a Sound Check value, indicating which tag format it was extracted from.
 */
export type SoundCheckSource = 'iTunNORM' | 'replayGain_track' | 'replayGain_album';

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

  // Volume normalization
  /**
   * Sound Check value for volume normalization.
   * Extracted from ReplayGain or iTunNORM tags.
   */
  soundcheck?: number;

  /**
   * Source of the Sound Check value (which tag format it was extracted from).
   * Only populated by collection adapters, not available from the iPod database.
   */
  soundcheckSource?: SoundCheckSource;

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
   * Technical adapter type identifier (e.g., 'directory', 'subsonic')
   */
  readonly adapterType: string;

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
   * Get file access for a track
   *
   * Local adapters return: { type: 'path', path: '/absolute/path.flac' }
   * Remote adapters return: { type: 'stream', getStream: () => ..., size: 12345 }
   *
   * @param track - The track to get file access for
   * @returns FileAccess object for reading the track's audio data
   */
  getFileAccess(track: CollectionTrack): FileAccess | Promise<FileAccess>;

  /**
   * Disconnect from source and cleanup resources
   */
  disconnect(): Promise<void>;
}

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
