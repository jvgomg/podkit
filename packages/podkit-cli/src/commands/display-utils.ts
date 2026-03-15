/**
 * Display utility functions for formatting track listings
 *
 * Shared between device.ts and collection.ts for consistent output formatting
 * of track tables, JSON, and CSV exports.
 */

import type { SoundCheckSource } from '@podkit/core';

// =============================================================================
// Types and Constants
// =============================================================================

/**
 * Track data structure for display purposes.
 * Contains common fields that can be displayed in various formats.
 */
export interface DisplayTrack {
  title: string;
  artist: string;
  album: string;
  duration?: number;
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNumber?: number;
  discNumber?: number;
  filePath?: string;
  artwork?: boolean;
  compilation?: boolean;
  format?: string;
  bitrate?: number;
  soundcheck?: number;
  soundcheckSource?: SoundCheckSource;
}

/**
 * Available fields that can be displayed/exported.
 */
export const AVAILABLE_FIELDS = [
  'title',
  'artist',
  'album',
  'duration',
  'albumArtist',
  'genre',
  'year',
  'trackNumber',
  'discNumber',
  'filePath',
  'artwork',
  'compilation',
  'format',
  'bitrate',
  'soundcheck',
] as const;

export type FieldName = (typeof AVAILABLE_FIELDS)[number];

/**
 * Default fields to display when none are specified.
 */
export const DEFAULT_FIELDS: FieldName[] = ['title', 'artist', 'album', 'duration'];

/**
 * Human-readable headers for each field.
 */
export const FIELD_HEADERS: Record<FieldName, string> = {
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  duration: 'Duration',
  albumArtist: 'Album Artist',
  genre: 'Genre',
  year: 'Year',
  trackNumber: 'Track',
  discNumber: 'Disc',
  filePath: 'File',
  artwork: 'Art',
  compilation: 'Comp',
  format: 'Format',
  bitrate: 'Bitrate',
  soundcheck: 'SndChk',
};

/**
 * Default maximum column widths for table output.
 */
export const DEFAULT_COLUMN_WIDTHS: Record<FieldName, number> = {
  title: 30,
  artist: 25,
  album: 25,
  duration: 8,
  albumArtist: 25,
  genre: 15,
  year: 6,
  trackNumber: 6,
  discNumber: 6,
  filePath: 50,
  artwork: 3,
  compilation: 4,
  format: 8,
  bitrate: 7,
  soundcheck: 10,
};

// =============================================================================
// Formatting Functions
// =============================================================================

/**
 * Format bytes as human-readable size with appropriate unit.
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);

  return `${value.toFixed(decimals)} ${sizes[i]}`;
}

/**
 * Format a number with thousands separators.
 */
export function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

/**
 * Format duration in milliseconds as MM:SS.
 */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || ms === null || ms <= 0) {
    return '--:--';
  }
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Truncate a string to fit within a maximum length.
 * Adds ellipsis (...) if truncated.
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  if (maxLength <= 3) {
    return str.slice(0, maxLength);
  }
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Get the display value for a specific field from a track.
 */
export function getFieldValue(track: DisplayTrack, field: FieldName): string {
  switch (field) {
    case 'title':
      return track.title || 'Unknown Title';
    case 'artist':
      return track.artist || 'Unknown Artist';
    case 'album':
      return track.album || 'Unknown Album';
    case 'duration':
      return formatDuration(track.duration);
    case 'albumArtist':
      return track.albumArtist || '';
    case 'genre':
      return track.genre || '';
    case 'year':
      return track.year ? String(track.year) : '';
    case 'trackNumber':
      return track.trackNumber ? String(track.trackNumber) : '';
    case 'discNumber':
      return track.discNumber ? String(track.discNumber) : '';
    case 'filePath':
      return track.filePath || '';
    case 'artwork':
      return track.artwork === true ? '\u2713' : track.artwork === false ? '\u2717' : '-';
    case 'compilation':
      return track.compilation === true ? '\u2713' : track.compilation === false ? '\u2717' : '-';
    case 'format':
      return track.format || '';
    case 'bitrate':
      return track.bitrate ? `${track.bitrate}` : '';
    case 'soundcheck':
      return track.soundcheck ? `${track.soundcheck}` : '';
    default:
      return '';
  }
}

// Build a case-insensitive field name lookup map
const FIELD_NAME_MAP: Record<string, FieldName> = {};
for (const field of AVAILABLE_FIELDS) {
  FIELD_NAME_MAP[field.toLowerCase()] = field;
}

/**
 * Parse a comma-separated field list option into validated field names.
 * Returns DEFAULT_FIELDS if no valid fields are found.
 */
export function parseFields(fieldsOption: string | undefined): FieldName[] {
  if (!fieldsOption) {
    return DEFAULT_FIELDS;
  }

  const requested = fieldsOption.split(',').map((f) => f.trim().toLowerCase());
  const valid: FieldName[] = [];

  for (const field of requested) {
    const mappedField = FIELD_NAME_MAP[field];
    if (mappedField) {
      valid.push(mappedField);
    }
  }

  return valid.length > 0 ? valid : DEFAULT_FIELDS;
}

/**
 * Calculate optimal column widths based on track data.
 * Respects DEFAULT_COLUMN_WIDTHS as maximum widths.
 */
export function calculateColumnWidths(
  tracks: DisplayTrack[],
  fields: FieldName[]
): Map<FieldName, number> {
  const widths = new Map<FieldName, number>();

  for (const field of fields) {
    let maxWidth = FIELD_HEADERS[field].length;

    for (const track of tracks) {
      const value = getFieldValue(track, field);
      maxWidth = Math.max(maxWidth, value.length);
    }

    widths.set(field, Math.min(maxWidth, DEFAULT_COLUMN_WIDTHS[field]));
  }

  return widths;
}

// =============================================================================
// Output Formatters
// =============================================================================

/**
 * Format tracks as an ASCII table.
 */
export function formatTable(tracks: DisplayTrack[], fields: FieldName[]): string {
  if (tracks.length === 0) {
    return 'No tracks found.';
  }

  const widths = calculateColumnWidths(tracks, fields);
  const lines: string[] = [];

  // Header row
  const headerParts = fields.map((field) => {
    const width = widths.get(field) || DEFAULT_COLUMN_WIDTHS[field];
    return FIELD_HEADERS[field].padEnd(width);
  });
  lines.push(headerParts.join('  '));

  // Separator line
  const separatorWidth =
    fields.reduce((sum, field) => {
      return sum + (widths.get(field) || DEFAULT_COLUMN_WIDTHS[field]);
    }, 0) +
    (fields.length - 1) * 2;
  lines.push('\u2500'.repeat(separatorWidth));

  // Data rows
  for (const track of tracks) {
    const rowParts = fields.map((field) => {
      const width = widths.get(field) || DEFAULT_COLUMN_WIDTHS[field];
      const value = getFieldValue(track, field);
      const truncated = truncate(value, width);
      return truncated.padEnd(width);
    });
    lines.push(rowParts.join('  '));
  }

  return lines.join('\n');
}

/**
 * Format tracks as JSON.
 * Includes both raw duration and formatted duration string.
 */
export function formatJson(tracks: DisplayTrack[], fields: FieldName[]): string {
  const output = tracks.map((track) => {
    const obj: Record<string, string | number | boolean | undefined> = {};
    for (const field of fields) {
      if (field === 'duration') {
        obj['duration'] = track.duration;
        obj['durationFormatted'] = formatDuration(track.duration);
      } else {
        obj[field] = track[field as keyof DisplayTrack] as string | number | boolean | undefined;
      }
    }
    return obj;
  });
  return JSON.stringify(output, null, 2);
}

/**
 * Escape a value for CSV output.
 * Wraps in quotes and escapes internal quotes if needed.
 */
export function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/**
 * Format tracks as CSV.
 */
export function formatCsv(tracks: DisplayTrack[], fields: FieldName[]): string {
  const lines: string[] = [];

  // Header row
  lines.push(fields.map((f) => FIELD_HEADERS[f]).join(','));

  // Data rows
  for (const track of tracks) {
    const values = fields.map((field) => {
      const value = getFieldValue(track, field);
      return escapeCsv(value);
    });
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

// =============================================================================
// Content Stats (summary view)
// =============================================================================

export interface ContentStats {
  tracks: number;
  albums: number;
  artists: number;
  compilationAlbums: number;
  compilationTracks: number;
  soundCheckTracks: number;
  soundCheckSources?: Record<SoundCheckSource, number>;
  fileTypes: Record<string, number>;
}

/**
 * Compute aggregate statistics from a list of display tracks.
 */
export function computeStats(tracks: DisplayTrack[]): ContentStats {
  const albums = new Set<string>();
  const artists = new Set<string>();
  const fileTypes: Record<string, number> = {};
  const soundCheckSources: Record<string, number> = {};
  const compilationAlbumSet = new Set<string>();
  let compilationTracks = 0;
  let soundCheckTracks = 0;

  for (const track of tracks) {
    const album = track.album || 'Unknown Album';
    const artist = track.artist || 'Unknown Artist';
    albums.add(album);
    artists.add(artist);

    if (track.compilation === true) {
      compilationTracks++;
      compilationAlbumSet.add(album);
    }

    if (track.soundcheck !== undefined && track.soundcheck > 0) {
      soundCheckTracks++;
      if (track.soundcheckSource) {
        soundCheckSources[track.soundcheckSource] =
          (soundCheckSources[track.soundcheckSource] || 0) + 1;
      }
    }

    if (track.format) {
      fileTypes[track.format] = (fileTypes[track.format] || 0) + 1;
    }
  }

  return {
    tracks: tracks.length,
    albums: albums.size,
    artists: artists.size,
    compilationAlbums: compilationAlbumSet.size,
    compilationTracks,
    soundCheckTracks,
    soundCheckSources:
      Object.keys(soundCheckSources).length > 0
        ? (soundCheckSources as Record<SoundCheckSource, number>)
        : undefined,
    fileTypes,
  };
}

// Re-export tips framework from output module for backward compatibility
import { collectTips, formatTips, printTips } from '../output/tips.js';
export { collectTips, formatTips, printTips };
export type { Tip, TipContext, TipDefinition } from '../output/tips.js';

// =============================================================================
// Stats formatting
// =============================================================================

export interface StatsFormatOptions {
  verbose?: boolean;
  source?: {
    adapterType: string;
    location: string;
  };
}

const SOUND_CHECK_SOURCE_LABELS: Record<SoundCheckSource, string> = {
  iTunNORM: 'iTunNORM',
  replayGain_track: 'ReplayGain (track)',
  replayGain_album: 'ReplayGain (album)',
};

/**
 * Format stats as human-readable text.
 * @param stats - computed stats
 * @param heading - heading line (e.g., "Music on TERAPOD:")
 * @param options - optional verbose and source info
 */
export function formatStatsText(
  stats: ContentStats,
  heading: string,
  options?: StatsFormatOptions
): string {
  const lines: string[] = [heading];

  if (options?.verbose && options?.source) {
    lines.push(`  Source: ${options.source.adapterType} (${options.source.location})`);
  }

  lines.push('');

  const trackLabel = formatNumber(stats.tracks);
  const albumLabel = formatNumber(stats.albums);
  const artistLabel = formatNumber(stats.artists);

  lines.push(`  Tracks:  ${trackLabel}`);
  lines.push(`  Albums:  ${albumLabel}`);
  lines.push(`  Artists: ${artistLabel}`);

  if (stats.compilationTracks > 0) {
    const compAlbums = formatNumber(stats.compilationAlbums);
    const compTracks = formatNumber(stats.compilationTracks);
    lines.push(`  Compilations: ${compAlbums} albums (${compTracks} tracks)`);
  }

  if (stats.soundCheckTracks > 0) {
    const scTracks = formatNumber(stats.soundCheckTracks);
    const pct = Math.floor((stats.soundCheckTracks / stats.tracks) * 100);
    lines.push(`  Sound Check: ${scTracks} (${pct}%)`);

    if (options?.verbose && stats.soundCheckSources) {
      const entries = Object.entries(stats.soundCheckSources).sort((a, b) => b[1] - a[1]);
      const maxLabelLen = Math.max(
        ...entries.map(([k]) => SOUND_CHECK_SOURCE_LABELS[k as SoundCheckSource].length)
      );
      for (const [source, count] of entries) {
        const label = SOUND_CHECK_SOURCE_LABELS[source as SoundCheckSource];
        lines.push(`    ${label.padEnd(maxLabelLen)}  ${formatNumber(count)}`);
      }
    }
  }

  const typeEntries = Object.entries(stats.fileTypes).sort((a, b) => b[1] - a[1]);
  if (typeEntries.length > 0) {
    lines.push('');
    lines.push('  File Types:');
    const maxTypeLen = Math.max(...typeEntries.map(([t]) => t.length));
    for (const [type, count] of typeEntries) {
      lines.push(`    ${type.padEnd(maxTypeLen)}  ${formatNumber(count)}`);
    }
  }

  const tipLines = formatTips(collectTips({ stats }));
  if (tipLines.length > 0) {
    lines.push('');
    lines.push(...tipLines);
  }

  return lines.join('\n');
}

// =============================================================================
// Album aggregation
// =============================================================================

export interface AlbumEntry {
  album: string;
  artist: string;
  tracks: number;
  isCompilation: boolean;
}

/**
 * Aggregate tracks by album.
 */
export function aggregateAlbums(tracks: DisplayTrack[]): AlbumEntry[] {
  const map = new Map<string, { artist: string; count: number; isCompilation: boolean }>();

  for (const track of tracks) {
    const album = track.album || 'Unknown Album';
    const artist = track.albumArtist || track.artist || 'Unknown Artist';
    const key = `${album}\0${artist}`;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
      if (track.compilation === true) {
        existing.isCompilation = true;
      }
    } else {
      map.set(key, { artist, count: 1, isCompilation: track.compilation === true });
    }
  }

  const entries: AlbumEntry[] = [];
  for (const [key, val] of map) {
    const album = key.split('\0')[0] ?? '';
    entries.push({
      album,
      artist: val.artist,
      tracks: val.count,
      isCompilation: val.isCompilation,
    });
  }

  return entries.sort((a, b) => a.album.localeCompare(b.album));
}

/**
 * Format album list as an ASCII table.
 */
export function formatAlbumsTable(albums: AlbumEntry[], heading: string): string {
  if (albums.length === 0) {
    return 'No albums found.';
  }

  const hasCompilations = albums.some((a) => a.isCompilation);
  const albumWidth = Math.min(35, Math.max(5, ...albums.map((a) => a.album.length)));
  const artistWidth = Math.min(25, Math.max(6, ...albums.map((a) => a.artist.length)));

  const lines: string[] = [heading, ''];
  const headerLine = hasCompilations
    ? `  ${'ALBUM'.padEnd(albumWidth)}  ${'ARTIST'.padEnd(artistWidth)}  ${'TRACKS'.padEnd(6)}  COMP`
    : `  ${'ALBUM'.padEnd(albumWidth)}  ${'ARTIST'.padEnd(artistWidth)}  TRACKS`;
  lines.push(headerLine);

  for (const entry of albums) {
    const album = truncate(entry.album, albumWidth).padEnd(albumWidth);
    const artist = truncate(entry.artist, artistWidth).padEnd(artistWidth);
    if (hasCompilations) {
      const comp = entry.isCompilation ? '\u2713' : '';
      lines.push(`  ${album}  ${artist}  ${String(entry.tracks).padEnd(6)}  ${comp}`);
    } else {
      lines.push(`  ${album}  ${artist}  ${entry.tracks}`);
    }
  }

  return lines.join('\n');
}

// =============================================================================
// Artist aggregation
// =============================================================================

export interface ArtistEntry {
  artist: string;
  albums: number;
  tracks: number;
}

/**
 * Aggregate tracks by artist.
 */
export function aggregateArtists(tracks: DisplayTrack[]): ArtistEntry[] {
  const map = new Map<string, { albums: Set<string>; count: number }>();

  for (const track of tracks) {
    const artist = track.albumArtist || track.artist || 'Unknown Artist';
    const album = track.album || 'Unknown Album';
    const existing = map.get(artist);
    if (existing) {
      existing.albums.add(album);
      existing.count++;
    } else {
      map.set(artist, { albums: new Set([album]), count: 1 });
    }
  }

  const entries: ArtistEntry[] = [];
  for (const [artist, val] of map) {
    entries.push({ artist, albums: val.albums.size, tracks: val.count });
  }

  return entries.sort((a, b) => a.artist.localeCompare(b.artist));
}

/**
 * Format artist list as an ASCII table.
 */
export function formatArtistsTable(artists: ArtistEntry[], heading: string): string {
  if (artists.length === 0) {
    return 'No artists found.';
  }

  const artistWidth = Math.min(30, Math.max(6, ...artists.map((a) => a.artist.length)));

  const lines: string[] = [heading, ''];
  lines.push(`  ${'ARTIST'.padEnd(artistWidth)}  ${'ALBUMS'.padEnd(6)}  TRACKS`);

  for (const entry of artists) {
    const artist = truncate(entry.artist, artistWidth).padEnd(artistWidth);
    lines.push(`  ${artist}  ${String(entry.albums).padEnd(6)}  ${entry.tracks}`);
  }

  return lines.join('\n');
}
