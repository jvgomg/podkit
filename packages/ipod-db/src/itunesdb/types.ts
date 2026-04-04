/**
 * Type definitions for parsed iTunesDB records.
 *
 * The iTunesDB is a binary database stored on iPod devices. It contains
 * tracks, playlists, albums, and associated metadata. Every record begins
 * with a 4-byte ASCII tag, a header length, and a total length.
 */

// ── MHOD (Object Data) ─────────────────────────────────────────────

/** Well-known MHOD type identifiers. */
export const MhodType = {
  Title: 1,
  Path: 2,
  Album: 3,
  Artist: 4,
  Genre: 5,
  Filetype: 6,
  EqSetting: 7,
  Comment: 8,
  Category: 9,
  Composer: 12,
  Grouping: 13,
  Description: 14,
  PodcastUrl: 15,
  PodcastRss: 16,
  ChapterData: 17,
  Subtitle: 18,
  TvShow: 19,
  TvEpisode: 20,
  TvNetwork: 21,
  AlbumArtist: 22,
  SortArtist: 23,
  Keywords: 24,
  SortTitle: 27,
  SortAlbum: 28,
  SortAlbumArtist: 29,
  SortComposer: 30,
  SortTvShow: 31,
  SmartPlaylistPref: 50,
  SmartPlaylistRules: 51,
  LibPlaylistIndex: 52,
  LibPlaylistJumpTable: 53,
  PlaylistOrder: 100,
  AlbumAlbum: 200,
  AlbumArtistName: 201,
  AlbumSortArtist: 202,
  AlbumArtistMhii: 300,
} as const;

/** MHOD holding a decoded UTF-16 or UTF-8 string. */
export interface MhodStringRecord {
  type: 'string';
  mhodType: number;
  value: string;
}

/** MHOD holding opaque binary data (smart-playlist rules, indices, etc.). */
export interface MhodOpaqueRecord {
  type: 'opaque';
  mhodType: number;
  data: Uint8Array;
}

/** MHOD holding a playlist-item position (type 100). */
export interface MhodPositionRecord {
  type: 'position';
  mhodType: 100;
  position: number;
}

export type MhodRecord = MhodStringRecord | MhodOpaqueRecord | MhodPositionRecord;

// ── MHIT (Track Item) ──────────────────────────────────────────────

export interface MhitRecord {
  trackId: number;
  visible: number;
  filetypeMarker: number;
  type1: number;
  type2: number;
  compilation: number;
  rating: number;
  dateModified: number;
  size: number;
  trackLength: number;
  trackNumber: number;
  trackTotal: number;
  year: number;
  bitrate: number;
  sampleRate: number;
  sampleRateLow: number;
  volume: number;
  startTime: number;
  stopTime: number;
  soundCheck: number;
  playCount: number;
  playCount2: number;
  lastPlayed: number;
  discNumber: number;
  discTotal: number;
  drmUserId: number;
  dateAdded: number;
  bookmarkTime: number;
  dbid: bigint;
  checked: number;
  appRating: number;
  bpm: number;
  artworkCount: number;
  artworkSize: number;
  sampleRate2: number;

  /* Extended fields (header >= 0xf4) */
  skipCount?: number;
  lastSkipped?: number;
  hasArtwork?: number;
  skipWhenShuffling?: number;
  rememberPlaybackPosition?: number;
  flag4?: number;
  dbid2?: bigint;
  lyricsFlag?: number;
  movieFlag?: number;
  markUnplayed?: number;
  pregap?: number;
  sampleCount?: bigint;
  postgap?: number;
  mediaType?: number;
  seasonNumber?: number;
  episodeNumber?: number;

  /* Extended fields (header >= 0x148) */
  gaplessData?: number;
  gaplessTrackFlag?: number;
  gaplessAlbumFlag?: number;

  mhods: MhodRecord[];
  unknownHeaderBytes: Uint8Array;
}

// ── MHLT (Track List) ──────────────────────────────────────────────

export interface MhltRecord {
  trackCount: number;
  tracks: MhitRecord[];
}

// ── MHIP (Playlist Item) ───────────────────────────────────────────

export interface MhipRecord {
  dataObjectCount: number;
  podcastGroupingFlag: number;
  groupId: number;
  trackId: number;
  timestamp: number;
  mhods: MhodRecord[];
  unknownHeaderBytes: Uint8Array;
}

// ── MHYP (Playlist) ────────────────────────────────────────────────

export interface MhypRecord {
  mhodCount: number;
  itemCount: number;
  hidden: number;
  timestamp: number;
  playlistId: bigint;
  podcastFlag: number;
  sortOrder: number;
  items: MhipRecord[];
  mhods: MhodRecord[];
  unknownHeaderBytes: Uint8Array;
}

// ── MHLP (Playlist List) ───────────────────────────────────────────

export interface MhlpRecord {
  playlistCount: number;
  playlists: MhypRecord[];
}

// ── MHIA (Album Item) ──────────────────────────────────────────────

export interface MhiaRecord {
  imageId: number;
  unknownHeaderBytes: Uint8Array;
}

// ── MHBA (Album) ───────────────────────────────────────────────────

export interface MhbaRecord {
  mhodCount: number;
  mhiaCount: number;
  albumId: number;
  albumType: number;
  items: MhiaRecord[];
  mhods: MhodRecord[];
  unknownHeaderBytes: Uint8Array;
}

// ── MHLA (Album List) ──────────────────────────────────────────────

export interface MhlaRecord {
  albumCount: number;
  albums: MhbaRecord[];
}

// ── MHSD (Section Data) ────────────────────────────────────────────

export interface MhsdTrackSection {
  sectionType: 1;
  trackList: MhltRecord;
}

export interface MhsdPlaylistSection {
  sectionType: 2 | 3 | 5;
  playlistList: MhlpRecord;
}

export interface MhsdAlbumSection {
  sectionType: 4;
  albumList: MhlaRecord;
}

export interface MhsdOpaqueSection {
  sectionType: number;
  data: Uint8Array;
}

export type MhsdRecord =
  | MhsdTrackSection
  | MhsdPlaylistSection
  | MhsdAlbumSection
  | MhsdOpaqueSection;

// ── MHBD (Database Header) ─────────────────────────────────────────

export interface MhbdRecord {
  headerLen: number;
  totalLen: number;
  version: number;
  childCount: number;
  dbId: bigint;
  platform: number;
  language: number;
  persistentId: bigint;
  timezoneOffset: number;
  sections: MhsdRecord[];
  unknownHeaderBytes: Uint8Array;
}

// ── Top-level parsed database ───────────────────────────────────────

export interface ITunesDatabase {
  header: MhbdRecord;
  tracks: MhitRecord[];
  playlists: MhypRecord[];
  albums: MhbaRecord[];
}
