/**
 * Display utility functions for formatting track listings
 *
 * Shared between device.ts and collection.ts for consistent output formatting
 * of track tables, JSON, and CSV exports.
 */

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
  format?: string;
  bitrate?: number;
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
  'format',
  'bitrate',
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
  format: 'Format',
  bitrate: 'Bitrate',
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
  format: 8,
  bitrate: 7,
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
    case 'format':
      return track.format || '';
    case 'bitrate':
      return track.bitrate ? `${track.bitrate}` : '';
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
