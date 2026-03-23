/**
 * Canned demo data for the podkit demo CLI build.
 *
 * Contains mock device info, Rick Astley album tracks, and Shrek movies.
 */

// =============================================================================
// Device
// =============================================================================

export const DEMO_MOUNT_POINT = '/tmp/podkit-demo/ipod';

export const DEMO_DEVICE_INFO = {
  modelName: 'iPod Classic (160GB)',
  modelNumber: 'MC297',
  generation: 'classic_3',
  capacity: 160,
  supportsArtwork: true,
  supportsVideo: true,
  supportsPhoto: true,
  supportsPodcast: true,
} as const;

export const DEMO_PLATFORM_DEVICE = {
  identifier: 'disk4s2',
  volumeName: 'IPOD',
  volumeUuid: 'DEMO-UUID-1234-5678',
  size: 160 * 1024 * 1024 * 1024, // 160 GB
  isMounted: true,
  mountPoint: DEMO_MOUNT_POINT,
  mediaType: 'iPod',
} as const;

// =============================================================================
// Rick Astley - Whenever You Need Somebody (1987)
// =============================================================================

const ALBUM = 'Whenever You Need Somebody';
const ARTIST = 'Rick Astley';
const YEAR = 1987;
const GENRE = 'Pop';

interface DemoTrackData {
  title: string;
  trackNumber: number;
  durationMs: number;
}

const TRACK_LIST: DemoTrackData[] = [
  { title: 'Never Gonna Give You Up', trackNumber: 1, durationMs: 213000 },
  { title: 'Whenever You Need Somebody', trackNumber: 2, durationMs: 219000 },
  { title: 'Together Forever', trackNumber: 3, durationMs: 205000 },
  { title: 'It Would Take a Strong Strong Man', trackNumber: 4, durationMs: 228000 },
  { title: 'The Love Has Gone', trackNumber: 5, durationMs: 237000 },
  { title: "Don't Say Goodbye", trackNumber: 6, durationMs: 244000 },
  { title: 'Slipping Away', trackNumber: 7, durationMs: 251000 },
  { title: 'No More Looking for Love', trackNumber: 8, durationMs: 222000 },
  { title: 'You Move Me', trackNumber: 9, durationMs: 230000 },
  { title: 'When I Fall in Love', trackNumber: 10, durationMs: 187000 },
];

/**
 * Collection tracks (source side) for the Rick Astley album.
 */
export function getDemoCollectionTracks() {
  return TRACK_LIST.map((t) => ({
    id: `demo-${t.trackNumber}`,
    title: t.title,
    artist: ARTIST,
    album: ALBUM,
    albumArtist: ARTIST,
    genre: GENRE,
    year: YEAR,
    trackNumber: t.trackNumber,
    discNumber: 1,
    duration: t.durationMs,
    filePath: `/demo/music/${ARTIST}/${ALBUM}/${String(t.trackNumber).padStart(2, '0')} - ${t.title}.flac`,
    fileType: 'flac' as const,
    codec: 'flac',
    lossless: true,
    bitrate: 900,
  }));
}

/**
 * iPod tracks (after sync) for the Rick Astley album.
 */
export function getDemoIpodTracks() {
  return TRACK_LIST.map((t) => ({
    title: t.title,
    artist: ARTIST,
    album: ALBUM,
    albumArtist: ARTIST,
    genre: GENRE,
    year: YEAR,
    trackNumber: t.trackNumber,
    totalTracks: TRACK_LIST.length,
    discNumber: 1,
    totalDiscs: 1,
    duration: t.durationMs,
    bitrate: 256,
    sampleRate: 44100,
    size: Math.round(((t.durationMs / 1000) * (256 * 1000)) / 8),
    bpm: undefined,
    filetype: 'AAC audio file',
    mediaType: 0x0001, // Audio
    filePath: `:iPod_Control:Music:F0${t.trackNumber}:DEMO${String(t.trackNumber).padStart(4, '0')}.m4a`,
    timeAdded: Math.floor(Date.now() / 1000),
    timeModified: Math.floor(Date.now() / 1000),
    timePlayed: 0,
    timeReleased: 0,
    playCount: 0,
    skipCount: 0,
    rating: 0,
    hasArtwork: true,
    hasFile: true,
    compilation: false,
  }));
}

// =============================================================================
// Shrek Movies
// =============================================================================

interface DemoVideoData {
  title: string;
  year: number;
  durationSeconds: number;
}

const SHREK_MOVIES: DemoVideoData[] = [
  { title: 'Shrek', year: 2001, durationSeconds: 5400 },
  { title: 'Shrek 2', year: 2004, durationSeconds: 5580 },
  { title: 'Shrek the Third', year: 2007, durationSeconds: 5580 },
];

/**
 * Collection videos (source side) for the Shrek movies.
 */
export function getDemoCollectionVideos() {
  return SHREK_MOVIES.map((m, i) => ({
    id: `demo-video-${i + 1}`,
    filePath: `/demo/videos/${m.title} (${m.year}).m4v`,
    contentType: 'movie' as const,
    title: m.title,
    year: m.year,
    description: `${m.title} (${m.year})`,
    genre: 'Animation',
    director: i === 0 ? 'Andrew Adamson' : i === 1 ? 'Andrew Adamson' : 'Chris Miller',
    studio: 'DreamWorks Animation',
    container: 'm4v',
    videoCodec: 'h264',
    audioCodec: 'aac',
    width: 640,
    height: 480,
    duration: m.durationSeconds,
  }));
}

/**
 * iPod video tracks (after sync) for the Shrek movies.
 */
export function getDemoIpodVideos() {
  return SHREK_MOVIES.map((m, i) => ({
    id: `demo-ipod-video-${i + 1}`,
    filePath: `:iPod_Control:Movies:DEMO${String(i + 1).padStart(4, '0')}.m4v`,
    contentType: 'movie' as const,
    title: m.title,
    year: m.year,
    duration: m.durationSeconds,
  }));
}

/**
 * iPod tracks for videos (after sync), used by IpodDatabase.getTracks().
 */
export function getDemoIpodVideoTracks() {
  return SHREK_MOVIES.map((m, i) => ({
    title: m.title,
    artist: '',
    album: '',
    genre: 'Animation',
    year: m.year,
    trackNumber: undefined,
    totalTracks: undefined,
    discNumber: undefined,
    totalDiscs: undefined,
    duration: m.durationSeconds * 1000,
    bitrate: 1500,
    sampleRate: 48000,
    size: Math.round((m.durationSeconds * 1500 * 1000) / 8),
    filetype: 'MPEG-4 video file',
    mediaType: 0x0002, // Movie
    filePath: `:iPod_Control:Movies:DEMO${String(i + 1).padStart(4, '0')}.m4v`,
    timeAdded: Math.floor(Date.now() / 1000),
    timeModified: Math.floor(Date.now() / 1000),
    timePlayed: 0,
    timeReleased: 0,
    playCount: 0,
    skipCount: 0,
    rating: 0,
    hasArtwork: false,
    hasFile: true,
    compilation: false,
    movieFlag: true,
    tvShow: undefined,
    tvEpisode: undefined,
    sortTvShow: undefined,
    seasonNumber: undefined,
    episodeNumber: undefined,
  }));
}

// =============================================================================
// Sync Plan Summary Data
// =============================================================================

/**
 * Pre-computed sync stats for the demo.
 */
export const DEMO_SYNC_STATS = {
  music: {
    tracksToAdd: TRACK_LIST.length,
    tracksToRemove: 0,
    tracksToUpdate: 0,
    addTranscodeCount: TRACK_LIST.length, // All FLAC -> AAC
    addDirectCopyCount: 0,
    estimatedSizeBytes: TRACK_LIST.reduce(
      (sum, t) => sum + Math.round(((t.durationMs / 1000) * (256 * 1000)) / 8),
      0
    ),
    estimatedTimeSeconds: 45,
    artworkCount: TRACK_LIST.length,
  },
  video: {
    videosToAdd: SHREK_MOVIES.length,
    videosToRemove: 0,
    addTranscodeCount: 0,
    addDirectCopyCount: SHREK_MOVIES.length, // M4V passthrough
    estimatedSizeBytes: SHREK_MOVIES.reduce(
      (sum, m) => sum + Math.round((m.durationSeconds * 1500 * 1000) / 8),
      0
    ),
    estimatedTimeSeconds: 120,
  },
} as const;
