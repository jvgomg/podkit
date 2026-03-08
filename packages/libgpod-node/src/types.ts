/**
 * TypeScript type definitions for libgpod bindings.
 *
 * These types represent the structures exposed by libgpod,
 * translated to TypeScript-friendly interfaces.
 */

// ============================================================================
// TrackHandle - Opaque reference to a track in the database
// ============================================================================

/**
 * Opaque handle to a track in the database.
 *
 * This is the primary way to reference tracks for operations.
 * The handle remains valid until the database is closed or the
 * track is removed.
 *
 * To get track metadata, use `db.getTrack(handle)`.
 *
 * TrackHandle uses a branded type pattern to prevent accidentally
 * passing plain numbers where handles are expected.
 *
 * @example
 * ```typescript
 * const handle = db.addTrack({ title: 'Song', artist: 'Artist' });
 * const track = db.getTrack(handle);
 * console.log(track.title);
 *
 * // Update track metadata
 * db.updateTrack(handle, { rating: 80 });
 *
 * // Copy audio file to iPod
 * db.copyTrackToDevice(handle, '/path/to/song.mp3');
 * ```
 */
export interface TrackHandle {
  /** Brand to prevent accidental use of plain numbers */
  readonly __brand: 'TrackHandle';
  /** Internal index into the native track array */
  readonly index: number;
}

// ============================================================================
// iPod Device Types
// ============================================================================

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
 *
 * This is a point-in-time snapshot of track metadata. Changes made
 * to the track in the database will not be reflected here until you
 * call `db.getTrack(handle)` again.
 */
export interface Track {
  /**
   * Track ID (assigned on save, may be 0 before save).
   *
   * Note: This ID is re-assigned every time the database is written,
   * so it should not be persisted or used across database operations.
   * Use TrackHandle to reference tracks.
   */
  id?: number;
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

  // Video-specific fields
  /** TV show name (for TV show episodes) */
  tvShow: string | null;
  /** Episode name/title (for TV show episodes, as a string) */
  tvEpisode: string | null;
  /** TV show name for sorting */
  sortTvShow: string | null;
  /** Season number (0 if not set) */
  seasonNumber: number;
  /** Episode number (0 if not set) */
  episodeNumber: number;
  /** Whether this track is a movie */
  movieFlag: boolean;
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

  // Video-specific fields
  /** TV show name (for TV show episodes) */
  tvShow?: string;
  /** Episode name/title (for TV show episodes, as a string) */
  tvEpisode?: string;
  /** TV show name for sorting (optional, defaults to tvShow) */
  sortTvShow?: string;
  /** Season number (1-99) */
  seasonNumber?: number;
  /** Episode number (1-999) */
  episodeNumber?: number;
  /** Whether this track is a movie */
  movieFlag?: boolean;
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
 * Device capability information.
 *
 * Contains all capability flags and device identification
 * from libgpod's device capability checking APIs.
 */
export interface DeviceCapabilities {
  /** Whether the device supports album artwork */
  supportsArtwork: boolean;
  /** Whether the device supports video playback */
  supportsVideo: boolean;
  /** Whether the device supports photo display */
  supportsPhoto: boolean;
  /** Whether the device supports podcasts */
  supportsPodcast: boolean;
  /** Whether the device supports chapter images (for audiobooks/podcasts) */
  supportsChapterImage: boolean;
  /** iPod generation identifier */
  generation: IpodGeneration | 'unknown';
  /** iPod model type */
  model: IpodModel | 'unknown';
  /** Model number string (e.g., "MA147") or null if unknown */
  modelNumber: string | null;
  /** Human-readable model name (e.g., "iPod Video (60GB)") */
  modelName: string;
}

// ============================================================================
// Smart Playlist Types
// ============================================================================

/**
 * Smart playlist match operator.
 * Determines how multiple rules are combined.
 */
export enum SPLMatch {
  /** All rules must match (AND) */
  And = 0,
  /** Any rule can match (OR) */
  Or = 1,
}

/**
 * Smart playlist limit type.
 * Determines the unit for playlist size limits.
 */
export enum SPLLimitType {
  Minutes = 0x01,
  MB = 0x02,
  Songs = 0x03,
  Hours = 0x04,
  GB = 0x05,
}

/**
 * Smart playlist limit sort order.
 * Determines which tracks to include when limiting.
 */
export enum SPLLimitSort {
  Random = 0x02,
  SongName = 0x03,
  Album = 0x04,
  Artist = 0x05,
  Genre = 0x07,
  MostRecentlyAdded = 0x10,
  LeastRecentlyAdded = 0x80000010,
  MostOftenPlayed = 0x14,
  LeastOftenPlayed = 0x80000014,
  MostRecentlyPlayed = 0x15,
  LeastRecentlyPlayed = 0x80000015,
  HighestRating = 0x17,
  LowestRating = 0x80000017,
}

/**
 * Smart playlist rule field.
 * The track attribute to match against.
 */
export enum SPLField {
  SongName = 0x02,
  Album = 0x03,
  Artist = 0x04,
  Bitrate = 0x05,
  SampleRate = 0x06,
  Year = 0x07,
  Genre = 0x08,
  Kind = 0x09,
  DateModified = 0x0a,
  TrackNumber = 0x0b,
  Size = 0x0c,
  Time = 0x0d,
  Comment = 0x0e,
  DateAdded = 0x10,
  Composer = 0x12,
  PlayCount = 0x16,
  LastPlayed = 0x17,
  DiscNumber = 0x18,
  Rating = 0x19,
  Compilation = 0x1f,
  BPM = 0x23,
  Grouping = 0x27,
  Playlist = 0x28,
  VideoKind = 0x3c,
  TVShow = 0x3e,
  SeasonNumber = 0x3f,
  SkipCount = 0x44,
  LastSkipped = 0x45,
  AlbumArtist = 0x47,
}

/**
 * Smart playlist rule action.
 * The comparison operation to perform.
 */
export enum SPLAction {
  // Integer actions
  Is = 0x00000001,
  IsGreaterThan = 0x00000010,
  IsLessThan = 0x00000040,
  IsInTheRange = 0x00000100,
  IsInTheLast = 0x00000200,
  BinaryAnd = 0x00000400,

  // String actions
  IsString = 0x01000001,
  Contains = 0x01000002,
  StartsWith = 0x01000004,
  EndsWith = 0x01000008,

  // Negated integer actions
  IsNot = 0x02000001,
  IsNotGreaterThan = 0x02000010,
  IsNotLessThan = 0x02000040,
  IsNotInTheRange = 0x02000100,
  IsNotInTheLast = 0x02000200,

  // Negated string actions
  IsNotString = 0x03000001,
  DoesNotContain = 0x03000002,
  DoesNotStartWith = 0x03000004,
  DoesNotEndWith = 0x03000008,
}

/**
 * Time units for "in the last" rule actions.
 * Values are in seconds.
 */
export const SPLActionLastUnits = {
  Days: 86400,
  Weeks: 604800,
  Months: 2628000,
} as const;

/**
 * Smart playlist rule definition.
 */
export interface SPLRule {
  /** Field to match against */
  field: SPLField;
  /** Comparison action */
  action: SPLAction;
  /** String value for string comparisons */
  string?: string;
  /** From value for numeric/range comparisons */
  fromValue?: number;
  /** To value for range comparisons */
  toValue?: number;
  /** From date for date comparisons */
  fromDate?: number;
  /** To date for date comparisons */
  toDate?: number;
  /** Units for "in the last" comparisons (seconds) */
  fromUnits?: number;
  /** Units for "in the last" comparisons (seconds) */
  toUnits?: number;
}

/**
 * Smart playlist preferences/settings.
 */
export interface SPLPreferences {
  /** Whether to update track list automatically */
  liveUpdate?: boolean;
  /** Whether to check rules (if false, rules are ignored) */
  checkRules?: boolean;
  /** Whether to limit the playlist size */
  checkLimits?: boolean;
  /** Type of limit (songs, minutes, MB, etc.) */
  limitType?: SPLLimitType;
  /** How to sort when limiting */
  limitSort?: SPLLimitSort;
  /** Limit value */
  limitValue?: number;
  /** Only match checked/enabled tracks */
  matchCheckedOnly?: boolean;
}

/**
 * Input for creating a smart playlist.
 */
export interface SmartPlaylistInput {
  /** Playlist name */
  name: string;
  /** Match operator (AND/OR) */
  match?: SPLMatch;
  /** Smart playlist rules */
  rules?: SPLRule[];
  /** Smart playlist preferences */
  preferences?: SPLPreferences;
}

/**
 * Smart playlist information (extends Playlist).
 */
export interface SmartPlaylist extends Playlist {
  /** Always true for smart playlists */
  isSmart: true;
  /** Match operator for rules */
  match: SPLMatch;
  /** Smart playlist rules */
  rules: SPLRule[];
  /** Smart playlist preferences */
  preferences: SPLPreferences;
}

// ============================================================================
// Chapter Data Types (for Podcasts and Audiobooks)
// ============================================================================

/**
 * Chapter marker for podcasts and audiobooks.
 *
 * Chapters allow navigation within a track, showing title and start position.
 * They are commonly used with podcasts (mediaType = 4) and audiobooks (mediaType = 8).
 */
export interface Chapter {
  /** Chapter start position in milliseconds (min value is 1 for first chapter) */
  startPos: number;
  /** Chapter title */
  title: string;
}

/**
 * Input for creating a chapter.
 */
export interface ChapterInput {
  /** Chapter start position in milliseconds (0 will be converted to 1) */
  startPos: number;
  /** Chapter title */
  title: string;
}

// ============================================================================
// Photo Database Types
// ============================================================================

/**
 * Photo metadata structure.
 * Represents a photo in the PhotoDB (stored as Itdb_Artwork).
 *
 * Note: Photos are separate from track artwork. The PhotoDB is a completely
 * separate database from the iTunesDB (music database).
 */
export interface Photo {
  /** Unique photo ID (assigned automatically when writing) */
  id: number;
  /** Database ID */
  dbid: bigint;
  /** Rating from iPhoto * 20 (0-100) */
  rating: number;
  /** Date the image file was created (Unix timestamp) */
  creationDate: number;
  /** Date the image was taken (EXIF data, Unix timestamp) */
  digitizedDate: number;
  /** Size in bytes of the original source image */
  artworkSize: number;
}

/**
 * Transition direction for photo album slideshows.
 */
export enum PhotoTransitionDirection {
  None = 0,
  LeftToRight = 1,
  RightToLeft = 2,
  TopToBottom = 3,
  BottomToTop = 4,
}

/**
 * Photo album type identifiers.
 */
export enum PhotoAlbumType {
  /** Photo Library - the master album containing all photos */
  PhotoLibrary = 1,
  /** Normal user-created album */
  Normal = 2,
}

/**
 * Photo album structure.
 * Represents a photo album in the PhotoDB.
 */
export interface PhotoAlbum {
  /** Unique album ID (assigned automatically when writing) */
  id: number;
  /** Album name in UTF-8 */
  name: string | null;
  /** Album type (1 = Photo Library, 2 = normal album) */
  albumType: number;
  /** Whether this is the Photo Library (master album) */
  isPhotoLibrary: boolean;
  /** Number of photos in this album */
  photoCount: number;

  // Slideshow settings
  /** Play music during slideshow */
  playMusic: boolean;
  /** Repeat the slideshow */
  repeat: boolean;
  /** Show slides in random order */
  random: boolean;
  /** Show slide captions */
  showTitles: boolean;
  /** Transition direction (0=none, 1=left-to-right, etc.) */
  transitionDirection: number;
  /** Slide duration in seconds */
  slideDuration: number;
  /** Transition duration in milliseconds */
  transitionDuration: number;
  /** The dbid2 of a track to play during slideshow */
  songId: bigint;
}

/**
 * Photo database information.
 */
export interface PhotoDatabaseInfo {
  /** Mount point path */
  mountpoint: string | null;
  /** Number of photos */
  photoCount: number;
  /** Number of photo albums */
  albumCount: number;
  /** Device information */
  device: DeviceInfo | null;
}

// ============================================================================
// Error Types
// ============================================================================

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
