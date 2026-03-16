import { describe, expect, it } from 'bun:test';
import {
  formatDuration,
  truncate,
  getFieldValue,
  parseFields,
  calculateColumnWidths,
  formatTable,
  formatJson,
  formatCsv,
  escapeCsv,
  computeStats,
  formatStatsText,
  aggregateAlbums,
  formatAlbumsTable,
  aggregateArtists,
  formatArtistsTable,
  DEFAULT_FIELDS,
  DEFAULT_COLUMN_WIDTHS,
  AVAILABLE_FIELDS,
  type DisplayTrack,
  type FieldName,
  type ContentStats,
} from './display-utils.js';

// =============================================================================
// Test fixtures
// =============================================================================

const createTrack = (overrides: Partial<DisplayTrack> = {}): DisplayTrack => ({
  title: 'Test Song',
  artist: 'Test Artist',
  album: 'Test Album',
  duration: 185000, // 3:05
  albumArtist: 'Test Album Artist',
  genre: 'Rock',
  year: 2023,
  trackNumber: 5,
  discNumber: 1,
  filePath: '/music/test.flac',
  artwork: true,
  format: 'FLAC',
  bitrate: 320,
  ...overrides,
});

// =============================================================================
// formatDuration tests
// =============================================================================

describe('formatDuration', () => {
  it('returns "--:--" for undefined', () => {
    expect(formatDuration(undefined)).toBe('--:--');
  });

  it('returns "--:--" for null', () => {
    // Type assertion needed since function expects number | undefined
    expect(formatDuration(null as unknown as undefined)).toBe('--:--');
  });

  it('returns "--:--" for 0', () => {
    expect(formatDuration(0)).toBe('--:--');
  });

  it('returns "--:--" for negative values', () => {
    expect(formatDuration(-1000)).toBe('--:--');
    expect(formatDuration(-60000)).toBe('--:--');
  });

  it('formats seconds under 60 correctly', () => {
    expect(formatDuration(45000)).toBe('0:45'); // 45 seconds
    expect(formatDuration(1000)).toBe('0:01'); // 1 second
    expect(formatDuration(5000)).toBe('0:05'); // 5 seconds
    expect(formatDuration(59000)).toBe('0:59'); // 59 seconds
  });

  it('formats minutes and seconds correctly', () => {
    expect(formatDuration(185000)).toBe('3:05'); // 3 minutes 5 seconds
    expect(formatDuration(60000)).toBe('1:00'); // 1 minute exactly
    expect(formatDuration(120000)).toBe('2:00'); // 2 minutes exactly
    expect(formatDuration(3723000)).toBe('62:03'); // 62 minutes 3 seconds
  });

  it('pads seconds with leading zero', () => {
    expect(formatDuration(61000)).toBe('1:01');
    expect(formatDuration(65000)).toBe('1:05');
    expect(formatDuration(69000)).toBe('1:09');
  });
});

// =============================================================================
// truncate tests
// =============================================================================

describe('truncate', () => {
  it('returns string unchanged if shorter than max length', () => {
    expect(truncate('hello', 10)).toBe('hello');
    expect(truncate('hi', 5)).toBe('hi');
    expect(truncate('', 5)).toBe('');
  });

  it('returns string unchanged if equal to max length', () => {
    expect(truncate('hello', 5)).toBe('hello');
    expect(truncate('test', 4)).toBe('test');
  });

  it('truncates with ellipsis if longer than max length', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
    expect(truncate('this is a long string', 10)).toBe('this is...');
  });

  it('does not add ellipsis when max length <= 3', () => {
    expect(truncate('hello', 3)).toBe('hel');
    expect(truncate('hello', 2)).toBe('he');
    expect(truncate('hello', 1)).toBe('h');
    expect(truncate('hello', 0)).toBe('');
  });

  it('handles empty string', () => {
    expect(truncate('', 10)).toBe('');
    expect(truncate('', 0)).toBe('');
    expect(truncate('', 3)).toBe('');
  });

  it('handles exact ellipsis boundary (length 4)', () => {
    // With maxLength=4, we need room for 1 char + "..."
    expect(truncate('hello', 4)).toBe('h...');
  });
});

// =============================================================================
// getFieldValue tests
// =============================================================================

describe('getFieldValue', () => {
  describe('title field', () => {
    it('returns title when present', () => {
      const track = createTrack({ title: 'My Song' });
      expect(getFieldValue(track, 'title')).toBe('My Song');
    });

    it('returns "Unknown Title" for empty string', () => {
      const track = createTrack({ title: '' });
      expect(getFieldValue(track, 'title')).toBe('Unknown Title');
    });
  });

  describe('artist field', () => {
    it('returns artist when present', () => {
      const track = createTrack({ artist: 'The Artist' });
      expect(getFieldValue(track, 'artist')).toBe('The Artist');
    });

    it('returns "Unknown Artist" as fallback', () => {
      const track = createTrack({ artist: '' });
      expect(getFieldValue(track, 'artist')).toBe('Unknown Artist');
    });
  });

  describe('album field', () => {
    it('returns album when present', () => {
      const track = createTrack({ album: 'Greatest Hits' });
      expect(getFieldValue(track, 'album')).toBe('Greatest Hits');
    });

    it('returns "Unknown Album" as fallback', () => {
      const track = createTrack({ album: '' });
      expect(getFieldValue(track, 'album')).toBe('Unknown Album');
    });
  });

  describe('duration field', () => {
    it('returns formatted duration', () => {
      const track = createTrack({ duration: 185000 });
      expect(getFieldValue(track, 'duration')).toBe('3:05');
    });

    it('returns "--:--" for undefined duration', () => {
      const track = createTrack({ duration: undefined });
      expect(getFieldValue(track, 'duration')).toBe('--:--');
    });
  });

  describe('year field', () => {
    it('returns year as string', () => {
      const track = createTrack({ year: 2023 });
      expect(getFieldValue(track, 'year')).toBe('2023');
    });

    it('returns empty string for 0 or undefined year', () => {
      expect(getFieldValue(createTrack({ year: 0 }), 'year')).toBe('');
      expect(getFieldValue(createTrack({ year: undefined }), 'year')).toBe('');
    });
  });

  describe('trackNumber field', () => {
    it('returns track number as string', () => {
      const track = createTrack({ trackNumber: 5 });
      expect(getFieldValue(track, 'trackNumber')).toBe('5');
    });

    it('returns empty string for 0 or undefined', () => {
      expect(getFieldValue(createTrack({ trackNumber: 0 }), 'trackNumber')).toBe('');
      expect(getFieldValue(createTrack({ trackNumber: undefined }), 'trackNumber')).toBe('');
    });
  });

  describe('artwork field', () => {
    it('returns checkmark for true', () => {
      const track = createTrack({ artwork: true });
      expect(getFieldValue(track, 'artwork')).toBe('\u2713'); // ✓
    });

    it('returns X for false', () => {
      const track = createTrack({ artwork: false });
      expect(getFieldValue(track, 'artwork')).toBe('\u2717'); // ✗
    });

    it('returns dash for undefined', () => {
      const track = createTrack({ artwork: undefined });
      expect(getFieldValue(track, 'artwork')).toBe('-');
    });
  });

  describe('compilation field', () => {
    it('returns checkmark for true', () => {
      const track = createTrack({ compilation: true });
      expect(getFieldValue(track, 'compilation')).toBe('\u2713'); // ✓
    });

    it('returns X for false', () => {
      const track = createTrack({ compilation: false });
      expect(getFieldValue(track, 'compilation')).toBe('\u2717'); // ✗
    });

    it('returns dash for undefined', () => {
      const track = createTrack({ compilation: undefined });
      expect(getFieldValue(track, 'compilation')).toBe('-');
    });
  });

  describe('format field', () => {
    it('returns format when present', () => {
      const track = createTrack({ format: 'FLAC' });
      expect(getFieldValue(track, 'format')).toBe('FLAC');
    });

    it('returns empty string when undefined', () => {
      const track = createTrack({ format: undefined });
      expect(getFieldValue(track, 'format')).toBe('');
    });
  });

  describe('bitrate field', () => {
    it('returns bitrate as string', () => {
      const track = createTrack({ bitrate: 320 });
      expect(getFieldValue(track, 'bitrate')).toBe('320');
    });

    it('returns empty string for 0 or undefined', () => {
      expect(getFieldValue(createTrack({ bitrate: 0 }), 'bitrate')).toBe('');
      expect(getFieldValue(createTrack({ bitrate: undefined }), 'bitrate')).toBe('');
    });
  });

  describe('other fields', () => {
    it('returns albumArtist or empty string', () => {
      expect(getFieldValue(createTrack({ albumArtist: 'Various' }), 'albumArtist')).toBe('Various');
      expect(getFieldValue(createTrack({ albumArtist: undefined }), 'albumArtist')).toBe('');
    });

    it('returns genre or empty string', () => {
      expect(getFieldValue(createTrack({ genre: 'Rock' }), 'genre')).toBe('Rock');
      expect(getFieldValue(createTrack({ genre: undefined }), 'genre')).toBe('');
    });

    it('returns discNumber or empty string', () => {
      expect(getFieldValue(createTrack({ discNumber: 2 }), 'discNumber')).toBe('2');
      expect(getFieldValue(createTrack({ discNumber: undefined }), 'discNumber')).toBe('');
    });

    it('returns filePath or empty string', () => {
      expect(getFieldValue(createTrack({ filePath: '/music/song.mp3' }), 'filePath')).toBe(
        '/music/song.mp3'
      );
      expect(getFieldValue(createTrack({ filePath: undefined }), 'filePath')).toBe('');
    });
  });
});

// =============================================================================
// parseFields tests
// =============================================================================

describe('parseFields', () => {
  it('returns DEFAULT_FIELDS for undefined', () => {
    expect(parseFields(undefined)).toEqual(DEFAULT_FIELDS);
  });

  it('returns DEFAULT_FIELDS for empty string', () => {
    expect(parseFields('')).toEqual(DEFAULT_FIELDS);
  });

  it('parses valid fields correctly', () => {
    expect(parseFields('title,artist')).toEqual(['title', 'artist']);
    expect(parseFields('duration,year,format')).toEqual(['duration', 'year', 'format']);
  });

  it('is case insensitive', () => {
    expect(parseFields('Title,ARTIST,Album')).toEqual(['title', 'artist', 'album']);
    expect(parseFields('DURATION')).toEqual(['duration']);
    expect(parseFields('AlbumArtist')).toEqual(['albumArtist']);
  });

  it('ignores invalid fields', () => {
    expect(parseFields('title,invalid,artist')).toEqual(['title', 'artist']);
    expect(parseFields('foo,bar,baz')).toEqual(DEFAULT_FIELDS); // All invalid -> defaults
  });

  it('returns only valid fields when mixed with invalid', () => {
    expect(parseFields('invalid1,title,invalid2,duration')).toEqual(['title', 'duration']);
  });

  it('handles whitespace around field names', () => {
    expect(parseFields('  title  ,  artist  ')).toEqual(['title', 'artist']);
    expect(parseFields('title , album , year')).toEqual(['title', 'album', 'year']);
  });

  it('returns all available fields when specified', () => {
    const allFields = AVAILABLE_FIELDS.join(',');
    expect(parseFields(allFields)).toEqual([...AVAILABLE_FIELDS]);
  });
});

// =============================================================================
// calculateColumnWidths tests
// =============================================================================

describe('calculateColumnWidths', () => {
  it('calculates widths based on content length', () => {
    const tracks = [
      createTrack({ title: 'Short', artist: 'A' }),
      createTrack({ title: 'Medium Length', artist: 'Artist Name' }),
    ];
    const widths = calculateColumnWidths(tracks, ['title', 'artist']);

    // 'Medium Length' is 13 chars, longer than header 'Title' (5 chars)
    expect(widths.get('title')).toBe(13);
    // 'Artist Name' is 11 chars, longer than header 'Artist' (6 chars)
    expect(widths.get('artist')).toBe(11);
  });

  it('uses header width when content is shorter', () => {
    const tracks = [createTrack({ title: 'X', artist: 'Y' })];
    const widths = calculateColumnWidths(tracks, ['title', 'artist']);

    // Header 'Title' is 5 chars, content 'X' is 1 char
    expect(widths.get('title')).toBe('Title'.length);
    // Header 'Artist' is 6 chars, content 'Y' is 1 char
    expect(widths.get('artist')).toBe('Artist'.length);
  });

  it('caps width at DEFAULT_COLUMN_WIDTHS maximum', () => {
    const tracks = [createTrack({ title: 'A'.repeat(100) })];
    const widths = calculateColumnWidths(tracks, ['title']);

    // Should cap at DEFAULT_COLUMN_WIDTHS.title (30)
    expect(widths.get('title')).toBe(DEFAULT_COLUMN_WIDTHS.title);
    expect(widths.get('title')).toBe(30);
  });

  it('handles empty tracks array', () => {
    const widths = calculateColumnWidths([], ['title', 'artist', 'album']);

    // Should use header widths when no tracks
    expect(widths.get('title')).toBe('Title'.length);
    expect(widths.get('artist')).toBe('Artist'.length);
    expect(widths.get('album')).toBe('Album'.length);
  });

  it('handles multiple fields correctly', () => {
    const tracks = [
      createTrack({
        title: 'Bohemian Rhapsody',
        artist: 'Queen',
        album: 'A Night at the Opera',
        duration: 355000,
      }),
    ];
    const widths = calculateColumnWidths(tracks, ['title', 'artist', 'album', 'duration']);

    expect(widths.get('title')).toBe(17); // 'Bohemian Rhapsody'.length
    expect(widths.get('artist')).toBe('Artist'.length); // 'Queen' < 'Artist'
    expect(widths.get('album')).toBe(20); // 'A Night at the Opera'.length
    expect(widths.get('duration')).toBe('Duration'.length); // '5:55' < 'Duration'
  });

  it('returns Map with correct field keys', () => {
    const tracks = [createTrack()];
    const fields: FieldName[] = ['title', 'artist', 'year', 'format'];
    const widths = calculateColumnWidths(tracks, fields);

    expect(widths.size).toBe(4);
    expect(widths.has('title')).toBe(true);
    expect(widths.has('artist')).toBe(true);
    expect(widths.has('year')).toBe(true);
    expect(widths.has('format')).toBe(true);
  });
});

// =============================================================================
// formatTable tests
// =============================================================================

describe('formatTable', () => {
  it('returns "No tracks found." for empty array', () => {
    expect(formatTable([], DEFAULT_FIELDS)).toBe('No tracks found.');
  });

  it('formats a single track correctly', () => {
    const track = createTrack({
      title: 'Song',
      artist: 'Artist',
      album: 'Album',
      duration: 180000,
    });
    const result = formatTable([track], ['title', 'artist', 'album', 'duration']);

    // Should have header, separator, and one data row
    const lines = result.split('\n');
    expect(lines.length).toBe(3);

    // Check header contains field names
    expect(lines[0]).toContain('Title');
    expect(lines[0]).toContain('Artist');
    expect(lines[0]).toContain('Album');
    expect(lines[0]).toContain('Duration');

    // Check separator line (unicode horizontal line)
    expect(lines[1]).toMatch(/^[\u2500]+$/);

    // Check data row
    expect(lines[2]).toContain('Song');
    expect(lines[2]).toContain('Artist');
    expect(lines[2]).toContain('Album');
    expect(lines[2]).toContain('3:00');
  });

  it('formats multiple tracks with header', () => {
    const tracks = [
      createTrack({ title: 'Song 1', artist: 'Artist 1' }),
      createTrack({ title: 'Song 2', artist: 'Artist 2' }),
      createTrack({ title: 'Song 3', artist: 'Artist 3' }),
    ];
    const result = formatTable(tracks, ['title', 'artist']);

    const lines = result.split('\n');
    expect(lines.length).toBe(5); // header + separator + 3 data rows

    expect(lines[2]).toContain('Song 1');
    expect(lines[3]).toContain('Song 2');
    expect(lines[4]).toContain('Song 3');
  });

  it('truncates long values to column width', () => {
    const track = createTrack({
      title: 'This Is A Very Long Song Title That Exceeds The Default Width',
    });
    const result = formatTable([track], ['title']);

    // Title column default width is 30
    const lines = result.split('\n');
    const dataRow = lines[2]!;

    // The title should be truncated with ellipsis
    expect(dataRow).toContain('...');
    // The row length should be constrained
    expect(dataRow.length).toBeLessThanOrEqual(35); // Some padding allowed
  });

  it('uses custom field subsets', () => {
    const track = createTrack({ year: 2020, format: 'MP3' });
    const result = formatTable([track], ['year', 'format']);

    expect(result).toContain('Year');
    expect(result).toContain('Format');
    expect(result).toContain('2020');
    expect(result).toContain('MP3');
    expect(result).not.toContain('Title');
    expect(result).not.toContain('Artist');
  });
});

// =============================================================================
// formatJson tests
// =============================================================================

describe('formatJson', () => {
  it('returns valid JSON', () => {
    const track = createTrack();
    const result = formatJson([track], ['title', 'artist']);

    expect(() => JSON.parse(result)).not.toThrow();
    const parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('includes only requested fields', () => {
    const track = createTrack({
      title: 'Song',
      artist: 'Artist',
      album: 'Album',
      year: 2023,
    });
    const result = formatJson([track], ['title', 'year']);
    const parsed = JSON.parse(result);

    expect(parsed[0]).toHaveProperty('title', 'Song');
    expect(parsed[0]).toHaveProperty('year', 2023);
    expect(parsed[0]).not.toHaveProperty('artist');
    expect(parsed[0]).not.toHaveProperty('album');
  });

  it('includes both raw and formatted duration', () => {
    const track = createTrack({ duration: 185000 });
    const result = formatJson([track], ['duration']);
    const parsed = JSON.parse(result);

    expect(parsed[0]).toHaveProperty('duration', 185000);
    expect(parsed[0]).toHaveProperty('durationFormatted', '3:05');
  });

  it('handles multiple tracks', () => {
    const tracks = [createTrack({ title: 'Song 1' }), createTrack({ title: 'Song 2' })];
    const result = formatJson(tracks, ['title']);
    const parsed = JSON.parse(result);

    expect(parsed.length).toBe(2);
    expect(parsed[0].title).toBe('Song 1');
    expect(parsed[1].title).toBe('Song 2');
  });

  it('handles empty tracks array', () => {
    const result = formatJson([], ['title']);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual([]);
  });

  it('preserves undefined values as undefined in JSON', () => {
    const track = createTrack({ genre: undefined, bitrate: undefined });
    const result = formatJson([track], ['genre', 'bitrate']);
    const parsed = JSON.parse(result);

    // undefined becomes null or is omitted in JSON
    // In this implementation, undefined is preserved
    expect(parsed[0].genre).toBeUndefined();
    expect(parsed[0].bitrate).toBeUndefined();
  });
});

// =============================================================================
// escapeCsv tests
// =============================================================================

describe('escapeCsv', () => {
  it('does not quote normal values', () => {
    expect(escapeCsv('hello')).toBe('hello');
    expect(escapeCsv('simple text')).toBe('simple text');
    expect(escapeCsv('123')).toBe('123');
  });

  it('quotes values containing commas', () => {
    expect(escapeCsv('hello, world')).toBe('"hello, world"');
    expect(escapeCsv('a,b,c')).toBe('"a,b,c"');
  });

  it('quotes and escapes values containing quotes', () => {
    expect(escapeCsv('say "hello"')).toBe('"say ""hello"""');
    expect(escapeCsv('"quoted"')).toBe('"""quoted"""');
  });

  it('quotes values containing newlines', () => {
    expect(escapeCsv('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsv('multi\nline\ntext')).toBe('"multi\nline\ntext"');
  });

  it('handles values with multiple special characters', () => {
    expect(escapeCsv('hello, "world"\n')).toBe('"hello, ""world""\n"');
  });

  it('handles empty string', () => {
    expect(escapeCsv('')).toBe('');
  });
});

// =============================================================================
// formatCsv tests
// =============================================================================

describe('formatCsv', () => {
  it('includes header row', () => {
    const track = createTrack();
    const result = formatCsv([track], ['title', 'artist', 'album']);
    const lines = result.split('\n');

    expect(lines[0]).toBe('Title,Artist,Album');
  });

  it('properly escapes values with commas', () => {
    const track = createTrack({ title: 'Song, Part 1' });
    const result = formatCsv([track], ['title']);
    const lines = result.split('\n');

    expect(lines[1]).toBe('"Song, Part 1"');
  });

  it('properly escapes values with quotes', () => {
    const track = createTrack({ title: 'Say "Hello"' });
    const result = formatCsv([track], ['title']);
    const lines = result.split('\n');

    expect(lines[1]).toBe('"Say ""Hello"""');
  });

  it('properly escapes values with newlines', () => {
    const track = createTrack({ title: 'Line 1\nLine 2' });
    const result = formatCsv([track], ['title']);

    // The newline is inside quotes, so splitting by \n affects it
    // Verify the content directly instead
    expect(result).toContain('"Line 1\nLine 2"');
  });

  it('does not quote normal values', () => {
    const track = createTrack({ title: 'Simple Song', artist: 'Simple Artist' });
    const result = formatCsv([track], ['title', 'artist']);
    const lines = result.split('\n');

    expect(lines[1]).toBe('Simple Song,Simple Artist');
  });

  it('formats multiple tracks', () => {
    const tracks = [
      createTrack({ title: 'Song 1', artist: 'Artist 1' }),
      createTrack({ title: 'Song 2', artist: 'Artist 2' }),
    ];
    const result = formatCsv(tracks, ['title', 'artist']);
    const lines = result.split('\n');

    expect(lines.length).toBe(3); // header + 2 data rows
    expect(lines[1]).toBe('Song 1,Artist 1');
    expect(lines[2]).toBe('Song 2,Artist 2');
  });

  it('handles empty tracks array', () => {
    const result = formatCsv([], ['title', 'artist']);
    const lines = result.split('\n');

    expect(lines.length).toBe(1); // header only
    expect(lines[0]).toBe('Title,Artist');
  });

  it('uses human-readable headers from FIELD_HEADERS', () => {
    const track = createTrack();
    const result = formatCsv([track], ['albumArtist', 'trackNumber']);
    const lines = result.split('\n');

    expect(lines[0]).toBe('Album Artist,Track');
  });
});

// =============================================================================
// computeStats tests
// =============================================================================

describe('computeStats', () => {
  it('returns zeroes for empty tracks', () => {
    const stats = computeStats([]);
    expect(stats.tracks).toBe(0);
    expect(stats.albums).toBe(0);
    expect(stats.artists).toBe(0);
    expect(stats.compilationAlbums).toBe(0);
    expect(stats.compilationTracks).toBe(0);
    expect(Object.keys(stats.fileTypes)).toHaveLength(0);
  });

  it('counts tracks, unique albums, and unique artists', () => {
    const tracks = [
      createTrack({ title: 'Song 1', artist: 'Artist A', album: 'Album X' }),
      createTrack({ title: 'Song 2', artist: 'Artist A', album: 'Album X' }),
      createTrack({ title: 'Song 3', artist: 'Artist B', album: 'Album Y' }),
    ];
    const stats = computeStats(tracks);
    expect(stats.tracks).toBe(3);
    expect(stats.albums).toBe(2);
    expect(stats.artists).toBe(2);
  });

  it('counts file types', () => {
    const tracks = [
      createTrack({ format: 'FLAC' }),
      createTrack({ format: 'FLAC' }),
      createTrack({ format: 'MP3' }),
      createTrack({ format: undefined }),
    ];
    const stats = computeStats(tracks);
    expect(stats.fileTypes).toEqual({ FLAC: 2, MP3: 1 });
  });

  it('counts compilation albums and tracks', () => {
    const tracks = [
      createTrack({ album: 'Comp Album', compilation: true }),
      createTrack({ album: 'Comp Album', compilation: true }),
      createTrack({ album: 'Another Comp', compilation: true }),
      createTrack({ album: 'Normal Album', compilation: false }),
      createTrack({ album: 'No Flag Album' }),
    ];
    const stats = computeStats(tracks);
    expect(stats.compilationTracks).toBe(3);
    expect(stats.compilationAlbums).toBe(2);
  });

  it('returns zero compilation counts when no compilations exist', () => {
    const tracks = [
      createTrack({ album: 'Album A', compilation: false }),
      createTrack({ album: 'Album B' }),
    ];
    const stats = computeStats(tracks);
    expect(stats.compilationTracks).toBe(0);
    expect(stats.compilationAlbums).toBe(0);
  });

  it('counts tracks with soundcheck data', () => {
    const tracks = [
      createTrack({ soundcheck: 1024 }),
      createTrack({ soundcheck: 2048 }),
      createTrack({ soundcheck: undefined }),
      createTrack({ soundcheck: 0 }),
    ];
    const stats = computeStats(tracks);
    expect(stats.soundCheckTracks).toBe(2);
  });

  it('returns zero soundCheckTracks when no tracks have soundcheck', () => {
    const tracks = [createTrack({ soundcheck: undefined }), createTrack({ soundcheck: 0 })];
    const stats = computeStats(tracks);
    expect(stats.soundCheckTracks).toBe(0);
  });

  it('aggregates soundcheck sources', () => {
    const tracks = [
      createTrack({ soundcheck: 1024, soundcheckSource: 'iTunNORM' }),
      createTrack({ soundcheck: 2048, soundcheckSource: 'iTunNORM' }),
      createTrack({ soundcheck: 512, soundcheckSource: 'replayGain_track' }),
      createTrack({ soundcheck: undefined }),
    ];
    const stats = computeStats(tracks);
    expect(stats.soundCheckSources).toEqual({
      iTunNORM: 2,
      replayGain_track: 1,
    });
  });

  it('returns undefined soundCheckSources when no sources present', () => {
    const tracks = [
      createTrack({ soundcheck: 1024 }), // no source info
      createTrack({ soundcheck: undefined }),
    ];
    const stats = computeStats(tracks);
    expect(stats.soundCheckSources).toBeUndefined();
  });
});

// =============================================================================
// formatStatsText tests
// =============================================================================

describe('formatStatsText', () => {
  it('includes heading and counts', () => {
    const stats: ContentStats = {
      tracks: 1247,
      albums: 98,
      artists: 45,
      compilationAlbums: 0,
      compilationTracks: 0,
      soundCheckTracks: 0,
      fileTypes: { FLAC: 892, MP3: 280 },
    };
    const result = formatStatsText(stats, 'Music on TERAPOD:');

    expect(result).toContain('Music on TERAPOD:');
    expect(result).toContain('Tracks:');
    expect(result).toContain('1,247');
    expect(result).toContain('Albums:');
    expect(result).toContain('Artists:');
    expect(result).toContain('File Types:');
    expect(result).toContain('FLAC');
    expect(result).toContain('MP3');
  });

  it('omits file types section when empty', () => {
    const stats: ContentStats = {
      tracks: 5,
      albums: 2,
      artists: 1,
      compilationAlbums: 0,
      compilationTracks: 0,
      soundCheckTracks: 0,
      fileTypes: {},
    };
    const result = formatStatsText(stats, 'Music:');

    expect(result).not.toContain('File Types:');
  });

  it('includes compilations line when compilations exist', () => {
    const stats: ContentStats = {
      tracks: 100,
      albums: 10,
      artists: 8,
      compilationAlbums: 3,
      compilationTracks: 25,
      soundCheckTracks: 0,
      fileTypes: {},
    };
    const result = formatStatsText(stats, 'Music:');

    expect(result).toContain('Compilations: 3 albums (25 tracks)');
  });

  it('omits compilations line when no compilations', () => {
    const stats: ContentStats = {
      tracks: 100,
      albums: 10,
      artists: 8,
      compilationAlbums: 0,
      compilationTracks: 0,
      soundCheckTracks: 0,
      fileTypes: {},
    };
    const result = formatStatsText(stats, 'Music:');

    expect(result).not.toContain('Compilations');
  });

  it('includes Sound Check line with percentage format', () => {
    const stats: ContentStats = {
      tracks: 100,
      albums: 10,
      artists: 8,
      compilationAlbums: 0,
      compilationTracks: 0,
      soundCheckTracks: 75,
      fileTypes: {},
    };
    const result = formatStatsText(stats, 'Music:');

    expect(result).toContain('Sound Check: 75 (75%)');
  });

  it('floors the percentage (never rounds up to 100%)', () => {
    const stats: ContentStats = {
      tracks: 1000,
      albums: 10,
      artists: 8,
      compilationAlbums: 0,
      compilationTracks: 0,
      soundCheckTracks: 997,
      fileTypes: {},
    };
    const result = formatStatsText(stats, 'Music:');

    // 997/1000 = 99.7%, should floor to 99%
    expect(result).toContain('Sound Check: 997 (99%)');
    expect(result).not.toContain('100%');
  });

  it('shows 100% only when all tracks have soundcheck', () => {
    const stats: ContentStats = {
      tracks: 100,
      albums: 10,
      artists: 8,
      compilationAlbums: 0,
      compilationTracks: 0,
      soundCheckTracks: 100,
      fileTypes: {},
    };
    const result = formatStatsText(stats, 'Music:');

    expect(result).toContain('Sound Check: 100 (100%)');
  });

  it('omits Sound Check line when no tracks have soundcheck data', () => {
    const stats: ContentStats = {
      tracks: 100,
      albums: 10,
      artists: 8,
      compilationAlbums: 0,
      compilationTracks: 0,
      soundCheckTracks: 0,
      fileTypes: {},
    };
    const result = formatStatsText(stats, 'Music:');

    expect(result).not.toContain('Sound Check');
  });

  it('shows source line in verbose mode with source info', () => {
    const stats: ContentStats = {
      tracks: 10,
      albums: 2,
      artists: 1,
      compilationAlbums: 0,
      compilationTracks: 0,
      soundCheckTracks: 0,
      fileTypes: {},
    };
    const result = formatStatsText(stats, 'Music:', {
      verbose: true,
      source: { adapterType: 'directory', location: '/Volumes/Music/FLAC' },
    });

    expect(result).toContain('Source: directory (/Volumes/Music/FLAC)');
  });

  it('does not show source line without verbose flag', () => {
    const stats: ContentStats = {
      tracks: 10,
      albums: 2,
      artists: 1,
      compilationAlbums: 0,
      compilationTracks: 0,
      soundCheckTracks: 0,
      fileTypes: {},
    };
    const result = formatStatsText(stats, 'Music:', {
      verbose: false,
      source: { adapterType: 'directory', location: '/Volumes/Music/FLAC' },
    });

    expect(result).not.toContain('Source:');
  });

  it('shows sound check source breakdown in verbose mode', () => {
    const stats: ContentStats = {
      tracks: 100,
      albums: 10,
      artists: 5,
      compilationAlbums: 0,
      compilationTracks: 0,
      soundCheckTracks: 80,
      soundCheckSources: {
        iTunNORM: 50,
        replayGain_track: 25,
        replayGain_album: 5,
      },
      fileTypes: {},
    };
    const result = formatStatsText(stats, 'Music:', { verbose: true });

    expect(result).toContain('iTunNORM');
    expect(result).toContain('ReplayGain (track)');
    expect(result).toContain('ReplayGain (album)');
  });

  it('does not show source breakdown without verbose flag', () => {
    const stats: ContentStats = {
      tracks: 100,
      albums: 10,
      artists: 5,
      compilationAlbums: 0,
      compilationTracks: 0,
      soundCheckTracks: 80,
      soundCheckSources: {
        iTunNORM: 50,
        replayGain_track: 25,
        replayGain_album: 5,
      },
      fileTypes: {},
    };
    const result = formatStatsText(stats, 'Music:');

    expect(result).not.toContain('iTunNORM');
    expect(result).not.toContain('ReplayGain (track)');
  });

  it('shows tip when partial sound check coverage', () => {
    const stats: ContentStats = {
      tracks: 100,
      albums: 10,
      artists: 5,
      compilationAlbums: 0,
      compilationTracks: 0,
      soundCheckTracks: 80,
      fileTypes: {},
    };
    const result = formatStatsText(stats, 'Music:');

    expect(result).toContain('Tip:');
    expect(result).toContain('Some tracks are missing Sound Check data');
    expect(result).toContain('https://jvgomg.github.io/podkit/user-guide/syncing/sound-check/');
  });

  it('does not show tip when all tracks have sound check', () => {
    const stats: ContentStats = {
      tracks: 100,
      albums: 10,
      artists: 5,
      compilationAlbums: 0,
      compilationTracks: 0,
      soundCheckTracks: 100,
      fileTypes: {},
    };
    const result = formatStatsText(stats, 'Music:');

    expect(result).not.toContain('Tip:');
  });

  it('does not show tip when no tracks have sound check', () => {
    const stats: ContentStats = {
      tracks: 100,
      albums: 10,
      artists: 5,
      compilationAlbums: 0,
      compilationTracks: 0,
      soundCheckTracks: 0,
      fileTypes: {},
    };
    const result = formatStatsText(stats, 'Music:');

    expect(result).not.toContain('Tip:');
  });

  it('shows tips after file types section', () => {
    const stats: ContentStats = {
      tracks: 100,
      albums: 10,
      artists: 5,
      compilationAlbums: 0,
      compilationTracks: 0,
      soundCheckTracks: 80,
      fileTypes: { flac: 100 },
    };
    const result = formatStatsText(stats, 'Music:');

    const fileTypesIdx = result.indexOf('File Types:');
    const tipsIdx = result.indexOf('Tip:');
    expect(fileTypesIdx).toBeGreaterThan(-1);
    expect(tipsIdx).toBeGreaterThan(fileTypesIdx);
  });

  it('suppresses tips when tips option is false', () => {
    const stats: ContentStats = {
      tracks: 100,
      albums: 10,
      artists: 5,
      compilationAlbums: 0,
      compilationTracks: 0,
      soundCheckTracks: 80,
      fileTypes: {},
    };
    const result = formatStatsText(stats, 'Music:', { tips: false });

    expect(result).not.toContain('Tip:');
  });
});

// =============================================================================
// aggregateAlbums tests
// =============================================================================

describe('aggregateAlbums', () => {
  it('returns empty array for no tracks', () => {
    expect(aggregateAlbums([])).toEqual([]);
  });

  it('aggregates tracks by album', () => {
    const tracks = [
      createTrack({ album: 'Abbey Road', artist: 'The Beatles', albumArtist: 'The Beatles' }),
      createTrack({ album: 'Abbey Road', artist: 'The Beatles', albumArtist: 'The Beatles' }),
      createTrack({ album: 'Dark Side', artist: 'Pink Floyd', albumArtist: 'Pink Floyd' }),
    ];
    const albums = aggregateAlbums(tracks);

    expect(albums).toHaveLength(2);
    const abbeyRoad = albums.find((a) => a.album === 'Abbey Road');
    expect(abbeyRoad).toBeDefined();
    expect(abbeyRoad!.tracks).toBe(2);
    expect(abbeyRoad!.artist).toBe('The Beatles');
    expect(abbeyRoad!.isCompilation).toBe(false);
  });

  it('uses albumArtist over artist', () => {
    const tracks = [
      createTrack({ album: 'Compilation', artist: 'Track Artist', albumArtist: 'Various Artists' }),
    ];
    const albums = aggregateAlbums(tracks);
    expect(albums[0]!.artist).toBe('Various Artists');
  });

  it('sorts alphabetically by album name', () => {
    const tracks = [
      createTrack({ album: 'Zebra' }),
      createTrack({ album: 'Alpha' }),
      createTrack({ album: 'Middle' }),
    ];
    const albums = aggregateAlbums(tracks);
    expect(albums.map((a) => a.album)).toEqual(['Alpha', 'Middle', 'Zebra']);
  });

  it('marks compilation albums when any track has compilation flag', () => {
    const tracks = [
      createTrack({ album: 'Hits', albumArtist: 'Various', compilation: true }),
      createTrack({ album: 'Hits', albumArtist: 'Various', compilation: false }),
      createTrack({ album: 'Normal', albumArtist: 'Artist' }),
    ];
    const albums = aggregateAlbums(tracks);

    const hits = albums.find((a) => a.album === 'Hits');
    expect(hits).toBeDefined();
    expect(hits!.isCompilation).toBe(true);

    const normal = albums.find((a) => a.album === 'Normal');
    expect(normal).toBeDefined();
    expect(normal!.isCompilation).toBe(false);
  });

  it('marks album as non-compilation when no tracks have compilation flag', () => {
    const tracks = [createTrack({ album: 'Regular Album' })];
    const albums = aggregateAlbums(tracks);
    expect(albums[0]!.isCompilation).toBe(false);
  });
});

// =============================================================================
// formatAlbumsTable tests
// =============================================================================

describe('formatAlbumsTable', () => {
  it('returns "No albums found." for empty array', () => {
    expect(formatAlbumsTable([], 'Music:')).toBe('No albums found.');
  });

  it('includes heading and column headers', () => {
    const albums = [
      { album: 'Test Album', artist: 'Test Artist', tracks: 10, isCompilation: false },
    ];
    const result = formatAlbumsTable(albums, 'Music on iPod:');

    expect(result).toContain('Music on iPod:');
    expect(result).toContain('ALBUM');
    expect(result).toContain('ARTIST');
    expect(result).toContain('TRACKS');
    expect(result).toContain('Test Album');
    expect(result).toContain('10');
  });

  it('shows COMP column when compilations exist', () => {
    const albums = [
      { album: 'Comp Album', artist: 'Various', tracks: 12, isCompilation: true },
      { album: 'Normal Album', artist: 'Artist', tracks: 8, isCompilation: false },
    ];
    const result = formatAlbumsTable(albums, 'Music:');

    expect(result).toContain('COMP');
    // Compilation album should have checkmark
    const lines = result.split('\n');
    const compLine = lines.find((l) => l.includes('Comp Album'));
    expect(compLine).toContain('\u2713');
    // Normal album should not have checkmark
    const normalLine = lines.find((l) => l.includes('Normal Album'));
    expect(normalLine).not.toContain('\u2713');
  });

  it('omits COMP column when no compilations exist', () => {
    const albums = [
      { album: 'Album A', artist: 'Artist A', tracks: 5, isCompilation: false },
      { album: 'Album B', artist: 'Artist B', tracks: 3, isCompilation: false },
    ];
    const result = formatAlbumsTable(albums, 'Music:');

    expect(result).not.toContain('COMP');
  });
});

// =============================================================================
// aggregateArtists tests
// =============================================================================

describe('aggregateArtists', () => {
  it('returns empty array for no tracks', () => {
    expect(aggregateArtists([])).toEqual([]);
  });

  it('aggregates tracks by artist with album counts', () => {
    const tracks = [
      createTrack({ artist: 'Beatles', albumArtist: 'Beatles', album: 'Abbey Road' }),
      createTrack({ artist: 'Beatles', albumArtist: 'Beatles', album: 'Abbey Road' }),
      createTrack({ artist: 'Beatles', albumArtist: 'Beatles', album: 'Let It Be' }),
      createTrack({ artist: 'Floyd', albumArtist: 'Floyd', album: 'The Wall' }),
    ];
    const artists = aggregateArtists(tracks);

    expect(artists).toHaveLength(2);
    const beatles = artists.find((a) => a.artist === 'Beatles');
    expect(beatles).toBeDefined();
    expect(beatles!.albums).toBe(2);
    expect(beatles!.tracks).toBe(3);
  });

  it('sorts alphabetically by artist name', () => {
    const tracks = [createTrack({ albumArtist: 'Zeppelin' }), createTrack({ albumArtist: 'ABBA' })];
    const artists = aggregateArtists(tracks);
    expect(artists.map((a) => a.artist)).toEqual(['ABBA', 'Zeppelin']);
  });
});

// =============================================================================
// formatArtistsTable tests
// =============================================================================

describe('formatArtistsTable', () => {
  it('returns "No artists found." for empty array', () => {
    expect(formatArtistsTable([], 'Music:')).toBe('No artists found.');
  });

  it('includes heading and column headers', () => {
    const artists = [{ artist: 'Test Artist', albums: 3, tracks: 25 }];
    const result = formatArtistsTable(artists, 'Music on iPod:');

    expect(result).toContain('Music on iPod:');
    expect(result).toContain('ARTIST');
    expect(result).toContain('ALBUMS');
    expect(result).toContain('TRACKS');
    expect(result).toContain('Test Artist');
    expect(result).toContain('25');
  });
});
