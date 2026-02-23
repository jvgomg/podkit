/* eslint-disable no-console */
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getContext } from '../context.js';

/**
 * Unified track type for display purposes
 * Used by both iPod and collection tracks
 */
export interface DisplayTrack {
  title: string;
  artist: string;
  album: string;
  duration?: number; // milliseconds
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNumber?: number;
  discNumber?: number;
  filePath?: string;
}

/**
 * Available fields for display
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
] as const;

export type FieldName = (typeof AVAILABLE_FIELDS)[number];

/**
 * Default fields to display if none specified
 */
export const DEFAULT_FIELDS: FieldName[] = ['title', 'artist', 'album', 'duration'];

/**
 * Column headers for fields
 */
const FIELD_HEADERS: Record<FieldName, string> = {
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
};

/**
 * Default column widths (max characters before truncation)
 */
const DEFAULT_COLUMN_WIDTHS: Record<FieldName, number> = {
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
};

/**
 * Format duration from milliseconds to MM:SS
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
 * Truncate string with ellipsis if too long
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
 * Get value for a field from a track
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
    default:
      return '';
  }
}

/**
 * Field name mapping for case-insensitive lookup
 */
const FIELD_NAME_MAP: Record<string, FieldName> = {};
for (const field of AVAILABLE_FIELDS) {
  FIELD_NAME_MAP[field.toLowerCase()] = field;
}

/**
 * Parse fields option into field names
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
 * Calculate column widths based on data
 */
export function calculateColumnWidths(
  tracks: DisplayTrack[],
  fields: FieldName[]
): Map<FieldName, number> {
  const widths = new Map<FieldName, number>();

  for (const field of fields) {
    // Start with header width
    let maxWidth = FIELD_HEADERS[field].length;

    // Check all values
    for (const track of tracks) {
      const value = getFieldValue(track, field);
      maxWidth = Math.max(maxWidth, value.length);
    }

    // Cap at default max width
    widths.set(field, Math.min(maxWidth, DEFAULT_COLUMN_WIDTHS[field]));
  }

  return widths;
}

/**
 * Format tracks as a table
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

  // Separator line using Unicode box drawing character
  const separatorWidth = fields.reduce((sum, field) => {
    return sum + (widths.get(field) || DEFAULT_COLUMN_WIDTHS[field]);
  }, 0) + (fields.length - 1) * 2; // account for spacing between columns
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
 * Format tracks as JSON
 */
export function formatJson(tracks: DisplayTrack[], fields: FieldName[]): string {
  const output = tracks.map((track) => {
    const obj: Record<string, string | number | undefined> = {};
    for (const field of fields) {
      if (field === 'duration') {
        // Include both raw milliseconds and formatted string
        obj['duration'] = track.duration;
        obj['durationFormatted'] = formatDuration(track.duration);
      } else {
        obj[field] = track[field as keyof DisplayTrack] as string | number | undefined;
      }
    }
    return obj;
  });
  return JSON.stringify(output, null, 2);
}

/**
 * Escape a value for CSV output
 */
export function escapeCsv(value: string): string {
  // If value contains comma, quote, or newline, wrap in quotes and escape quotes
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/**
 * Format tracks as CSV
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

/**
 * Load tracks from an iPod device
 */
async function loadIpodTracks(device: string | undefined): Promise<DisplayTrack[]> {
  // Dynamic import to avoid loading libgpod-node when not needed
  const { Database } = await import('@podkit/libgpod-node');

  if (!device) {
    throw new Error(
      'No iPod device specified. Use --device option or set device in config file.'
    );
  }

  if (!existsSync(device)) {
    throw new Error(`iPod not found at path: ${device}`);
  }

  const db = await Database.open(device);
  try {
    const tracks = db.getTracks();
    return tracks.map((t) => ({
      title: t.title || 'Unknown Title',
      artist: t.artist || 'Unknown Artist',
      album: t.album || 'Unknown Album',
      duration: t.duration,
      albumArtist: t.albumArtist || undefined,
      genre: t.genre || undefined,
      year: t.year > 0 ? t.year : undefined,
      trackNumber: t.trackNumber > 0 ? t.trackNumber : undefined,
      discNumber: t.discNumber > 0 ? t.discNumber : undefined,
      filePath: t.ipodPath || undefined,
    }));
  } finally {
    db.close();
  }
}

/**
 * Collection track type for source directory
 */
interface SourceTrack {
  title: string;
  artist: string;
  album: string;
  duration?: number;
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNumber?: number;
  discNumber?: number;
  filePath: string;
}

/**
 * Load tracks from a source directory
 */
async function loadSourceTracks(sourcePath: string): Promise<DisplayTrack[]> {
  // Dynamic import to avoid loading podkit-core when not needed
  const { createDirectoryAdapter } = await import('@podkit/core');

  const resolved = resolve(sourcePath);
  if (!existsSync(resolved)) {
    throw new Error(`Source directory not found: ${sourcePath}`);
  }

  const adapter = createDirectoryAdapter({ path: resolved });
  await adapter.connect();
  try {
    const tracks = (await adapter.getTracks()) as SourceTrack[];
    return tracks.map((t) => ({
      title: t.title,
      artist: t.artist,
      album: t.album,
      duration: t.duration,
      albumArtist: t.albumArtist,
      genre: t.genre,
      year: t.year,
      trackNumber: t.trackNumber,
      discNumber: t.discNumber,
      filePath: t.filePath,
    }));
  } finally {
    await adapter.disconnect();
  }
}

export const listCommand = new Command('list')
  .description('list tracks on iPod or in collection')
  .option('-s, --source <path>', 'list from collection directory instead of iPod')
  .option('--format <fmt>', 'output format: table, json, csv', 'table')
  .option('--fields <list>', 'fields to show (comma-separated): title,artist,album,duration')
  .action(async (options) => {
    const { config, globalOpts } = getContext();

    // Use config.source as default if --source not specified
    const source = options.source ?? config.source;
    const format = globalOpts.json ? 'json' : options.format;
    const fields = parseFields(options.fields);

    try {
      let tracks: DisplayTrack[];

      if (source) {
        // Load from source directory
        tracks = await loadSourceTracks(source);
      } else {
        // Load from iPod
        tracks = await loadIpodTracks(config.device);
      }

      // Format and output
      let output: string;
      switch (format) {
        case 'json':
          output = formatJson(tracks, fields);
          break;
        case 'csv':
          output = formatCsv(tracks, fields);
          break;
        case 'table':
        default:
          output = formatTable(tracks, fields);
          break;
      }

      console.log(output);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (format === 'json') {
        console.log(
          JSON.stringify(
            {
              error: true,
              message,
            },
            null,
            2
          )
        );
      } else {
        console.error(`Error: ${message}`);
      }
      process.exitCode = 1;
    }
  });
