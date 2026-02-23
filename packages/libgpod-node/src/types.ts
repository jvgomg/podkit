/**
 * TypeScript type definitions for libgpod bindings.
 *
 * These types represent the structures exposed by libgpod,
 * translated to TypeScript-friendly interfaces.
 */

/**
 * iPod generation identifier.
 */
export type IpodGeneration =
  | 'unknown'
  | 'first'
  | 'second'
  | 'third'
  | 'fourth'
  | 'photo'
  | 'mobile'
  | 'mini_1'
  | 'mini_2'
  | 'shuffle_1'
  | 'shuffle_2'
  | 'shuffle_3'
  | 'shuffle_4'
  | 'nano_1'
  | 'nano_2'
  | 'nano_3'
  | 'nano_4'
  | 'nano_5'
  | 'nano_6'
  | 'video_1'
  | 'video_2'
  | 'classic_1'
  | 'classic_2'
  | 'classic_3'
  | 'touch_1'
  | 'touch_2'
  | 'touch_3'
  | 'touch_4'
  | 'iphone_1'
  | 'iphone_2'
  | 'iphone_3'
  | 'iphone_4'
  | 'ipad_1';

/**
 * iPod model identifier.
 */
export type IpodModel =
  | 'invalid'
  | 'unknown'
  | 'color'
  | 'color_u2'
  | 'regular'
  | 'regular_u2'
  | 'mini'
  | 'mini_blue'
  | 'mini_pink'
  | 'mini_green'
  | 'mini_gold'
  | 'shuffle'
  | 'nano_white'
  | 'nano_black'
  | 'video_white'
  | 'video_black'
  | 'mobile_1'
  | 'video_u2'
  | 'nano_silver'
  | 'nano_blue'
  | 'nano_green'
  | 'nano_pink'
  | 'nano_red'
  | 'nano_yellow'
  | 'nano_purple'
  | 'nano_orange'
  | 'iphone_1'
  | 'shuffle_silver'
  | 'shuffle_pink'
  | 'shuffle_blue'
  | 'shuffle_green'
  | 'shuffle_orange'
  | 'shuffle_purple'
  | 'shuffle_red'
  | 'shuffle_black'
  | 'shuffle_gold'
  | 'shuffle_stainless'
  | 'classic_silver'
  | 'classic_black'
  | 'touch_silver'
  | 'iphone_white'
  | 'iphone_black'
  | 'ipad';

/**
 * Media type flags for tracks.
 */
export const MediaType = {
  Audio: 0x0001,
  Movie: 0x0002,
  Podcast: 0x0004,
  Audiobook: 0x0008,
  MusicVideo: 0x0020,
  TVShow: 0x0040,
  Ringtone: 0x4000,
  Rental: 0x8000,
  ITunesExtra: 0x10000,
  Memo: 0x100000,
  ITunesU: 0x200000,
  EpubBook: 0x400000,
  PdfBook: 0x800000,
} as const;

export type MediaTypeValue = (typeof MediaType)[keyof typeof MediaType];

/**
 * Device capabilities and information.
 */
export interface DeviceInfo {
  /** Model number string (e.g., "MA147") */
  modelNumber: string | null;
  /** Human-readable model name (e.g., "iPod Video (60GB)") */
  modelName: string;
  /** iPod generation */
  generation: IpodGeneration;
  /** iPod model type */
  model: IpodModel;
  /** Capacity in GB */
  capacity: number;
  /** Number of music directories */
  musicDirs: number;
  /** Whether device supports artwork */
  supportsArtwork: boolean;
  /** Whether device supports video */
  supportsVideo: boolean;
  /** Whether device supports photos */
  supportsPhoto: boolean;
  /** Whether device supports podcasts */
  supportsPodcast: boolean;
}

/**
 * Database information.
 */
export interface DatabaseInfo {
  /** Mount point path */
  mountpoint: string;
  /** Database version */
  version: number;
  /** Database ID */
  id: bigint;
  /** Number of tracks */
  trackCount: number;
  /** Number of playlists */
  playlistCount: number;
  /** Device information */
  device: DeviceInfo;
}

/**
 * Track metadata structure.
 * Represents an Itdb_Track from libgpod.
 */
export interface Track {
  /** Unique track ID */
  id: number;
  /** Database ID */
  dbid: bigint;

  // Core metadata
  /** Track title */
  title: string | null;
  /** Artist name */
  artist: string | null;
  /** Album name */
  album: string | null;
  /** Album artist */
  albumArtist: string | null;
  /** Genre */
  genre: string | null;
  /** Composer */
  composer: string | null;
  /** Comment */
  comment: string | null;
  /** Grouping */
  grouping: string | null;

  // Track info
  /** Track number on disc */
  trackNumber: number;
  /** Total tracks on disc */
  totalTracks: number;
  /** Disc number */
  discNumber: number;
  /** Total discs */
  totalDiscs: number;
  /** Release year */
  year: number;

  // Technical info
  /** Track duration in milliseconds */
  duration: number;
  /** Bitrate in kbps */
  bitrate: number;
  /** Sample rate in Hz */
  sampleRate: number;
  /** File size in bytes */
  size: number;
  /** Beats per minute */
  bpm: number;

  // File type
  /** File type description (e.g., "MPEG audio file") */
  filetype: string | null;
  /** Media type flags */
  mediaType: number;

  // Path on iPod
  /** Relative path on iPod (colon-separated) */
  ipodPath: string | null;

  // Timestamps (Unix seconds)
  /** Time added to library */
  timeAdded: number;
  /** Time last modified */
  timeModified: number;
  /** Time last played */
  timePlayed: number;
  /** Release time (for podcasts) */
  timeReleased: number;

  // Play statistics
  /** Play count */
  playCount: number;
  /** Skip count */
  skipCount: number;
  /** Rating (0-100, where 20 = 1 star) */
  rating: number;

  // Artwork
  /** Whether track has artwork */
  hasArtwork: boolean;

  // Compilation
  /** Whether track is part of a compilation */
  compilation: boolean;

  // Transfer status
  /** Whether track file has been transferred to iPod */
  transferred: boolean;
}

/**
 * Input for creating a new track.
 * Only title is required; other fields are optional.
 */
export interface TrackInput {
  /** Track title */
  title: string;
  /** Artist name */
  artist?: string;
  /** Album name */
  album?: string;
  /** Album artist */
  albumArtist?: string;
  /** Genre */
  genre?: string;
  /** Composer */
  composer?: string;
  /** Comment */
  comment?: string;
  /** Grouping */
  grouping?: string;

  /** Track number */
  trackNumber?: number;
  /** Total tracks */
  totalTracks?: number;
  /** Disc number */
  discNumber?: number;
  /** Total discs */
  totalDiscs?: number;
  /** Year */
  year?: number;

  /** Duration in ms */
  duration?: number;
  /** Bitrate in kbps */
  bitrate?: number;
  /** Sample rate in Hz */
  sampleRate?: number;
  /** File size in bytes */
  size?: number;
  /** BPM */
  bpm?: number;

  /** File type description */
  filetype?: string;
  /** Media type */
  mediaType?: number;

  /** Compilation flag */
  compilation?: boolean;

  /** Rating (0-100, where 20 = 1 star) - for updates */
  rating?: number;
  /** Play count - for updates */
  playCount?: number;
  /** Skip count - for updates */
  skipCount?: number;
}

/**
 * Playlist information.
 */
export interface Playlist {
  /** Playlist ID */
  id: bigint;
  /** Playlist name */
  name: string | null;
  /** Whether this is the master playlist */
  isMaster: boolean;
  /** Whether this is a smart playlist */
  isSmart: boolean;
  /** Whether this is the podcasts playlist */
  isPodcasts: boolean;
  /** Number of tracks */
  trackCount: number;
  /** Creation timestamp */
  timestamp: number;
}

/**
 * Artwork capability information for the device.
 *
 * Note: The detailed artwork formats are handled internally by libgpod.
 * This interface provides basic capability information to help determine
 * if artwork operations are supported.
 */
export interface ArtworkCapabilities {
  /** Whether the device supports artwork */
  supportsArtwork: boolean;
  /** iPod generation (for determining supported artwork sizes) */
  generation: string;
  /** iPod model type */
  model: string;
}

/**
 * Error codes from libgpod.
 */
export enum LibgpodErrorCode {
  Seek = 'SEEK',
  Corrupt = 'CORRUPT',
  NotFound = 'NOT_FOUND',
  Rename = 'RENAME',
  ItdbCorrupt = 'ITDB_CORRUPT',
  Sqlite = 'SQLITE',
  Unknown = 'UNKNOWN',
}

/**
 * Error thrown by libgpod operations.
 */
export class LibgpodError extends Error {
  /** Error code */
  readonly code: LibgpodErrorCode;
  /** Operation that failed */
  readonly operation: string;

  constructor(message: string, code: LibgpodErrorCode, operation: string) {
    super(message);
    this.name = 'LibgpodError';
    this.code = code;
    this.operation = operation;
  }
}
