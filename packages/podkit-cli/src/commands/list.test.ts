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
  DEFAULT_FIELDS,
  type DisplayTrack,
  type FieldName,
} from './list.js';

describe('list command utilities', () => {
  describe('formatDuration', () => {
    it('formats undefined as --:--', () => {
      expect(formatDuration(undefined)).toBe('--:--');
    });

    it('formats 0 as --:--', () => {
      expect(formatDuration(0)).toBe('--:--');
    });

    it('formats negative values as --:--', () => {
      expect(formatDuration(-1000)).toBe('--:--');
    });

    it('formats seconds correctly', () => {
      expect(formatDuration(5000)).toBe('0:05');
      expect(formatDuration(30000)).toBe('0:30');
      expect(formatDuration(59000)).toBe('0:59');
    });

    it('formats minutes and seconds', () => {
      expect(formatDuration(60000)).toBe('1:00');
      expect(formatDuration(90000)).toBe('1:30');
      expect(formatDuration(125000)).toBe('2:05');
    });

    it('formats longer durations', () => {
      expect(formatDuration(355000)).toBe('5:55'); // Bohemian Rhapsody
      expect(formatDuration(216000)).toBe('3:36'); // Another One Bites the Dust
      expect(formatDuration(3600000)).toBe('60:00'); // 1 hour
    });
  });

  describe('truncate', () => {
    it('returns short strings unchanged', () => {
      expect(truncate('Hello', 10)).toBe('Hello');
    });

    it('returns exact length strings unchanged', () => {
      expect(truncate('Hello', 5)).toBe('Hello');
    });

    it('truncates long strings with ellipsis', () => {
      expect(truncate('Hello World', 8)).toBe('Hello...');
    });

    it('handles very short max lengths', () => {
      expect(truncate('Hello', 3)).toBe('Hel');
      expect(truncate('Hello', 2)).toBe('He');
      expect(truncate('Hello', 1)).toBe('H');
    });

    it('truncates to exactly maxLength characters', () => {
      expect(truncate('A Night at the Opera', 12).length).toBe(12);
      expect(truncate('A Night at the Opera', 12)).toBe('A Night a...');
    });
  });

  describe('getFieldValue', () => {
    const track: DisplayTrack = {
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      album: 'A Night at the Opera',
      duration: 355000,
      albumArtist: 'Queen',
      genre: 'Rock',
      year: 1975,
      trackNumber: 11,
      discNumber: 1,
      filePath: '/music/queen/rhapsody.flac',
    };

    it('returns title', () => {
      expect(getFieldValue(track, 'title')).toBe('Bohemian Rhapsody');
    });

    it('returns artist', () => {
      expect(getFieldValue(track, 'artist')).toBe('Queen');
    });

    it('returns album', () => {
      expect(getFieldValue(track, 'album')).toBe('A Night at the Opera');
    });

    it('returns formatted duration', () => {
      expect(getFieldValue(track, 'duration')).toBe('5:55');
    });

    it('returns albumArtist', () => {
      expect(getFieldValue(track, 'albumArtist')).toBe('Queen');
    });

    it('returns genre', () => {
      expect(getFieldValue(track, 'genre')).toBe('Rock');
    });

    it('returns year as string', () => {
      expect(getFieldValue(track, 'year')).toBe('1975');
    });

    it('returns trackNumber as string', () => {
      expect(getFieldValue(track, 'trackNumber')).toBe('11');
    });

    it('returns discNumber as string', () => {
      expect(getFieldValue(track, 'discNumber')).toBe('1');
    });

    it('returns filePath', () => {
      expect(getFieldValue(track, 'filePath')).toBe('/music/queen/rhapsody.flac');
    });

    it('returns fallback values for missing fields', () => {
      const emptyTrack: DisplayTrack = {
        title: '',
        artist: '',
        album: '',
      };
      expect(getFieldValue(emptyTrack, 'title')).toBe('Unknown Title');
      expect(getFieldValue(emptyTrack, 'artist')).toBe('Unknown Artist');
      expect(getFieldValue(emptyTrack, 'album')).toBe('Unknown Album');
      expect(getFieldValue(emptyTrack, 'duration')).toBe('--:--');
      expect(getFieldValue(emptyTrack, 'genre')).toBe('');
      expect(getFieldValue(emptyTrack, 'year')).toBe('');
    });
  });

  describe('parseFields', () => {
    it('returns default fields when undefined', () => {
      expect(parseFields(undefined)).toEqual(DEFAULT_FIELDS);
    });

    it('returns default fields when empty string', () => {
      expect(parseFields('')).toEqual(DEFAULT_FIELDS);
    });

    it('parses single field', () => {
      expect(parseFields('title')).toEqual(['title']);
    });

    it('parses multiple fields', () => {
      expect(parseFields('title,artist,album')).toEqual(['title', 'artist', 'album']);
    });

    it('handles whitespace around fields', () => {
      expect(parseFields('title , artist , album')).toEqual(['title', 'artist', 'album']);
    });

    it('handles case insensitivity', () => {
      expect(parseFields('Title,ARTIST,Album')).toEqual(['title', 'artist', 'album']);
    });

    it('filters out invalid fields', () => {
      expect(parseFields('title,invalid,artist')).toEqual(['title', 'artist']);
    });

    it('returns default fields if all invalid', () => {
      expect(parseFields('foo,bar,baz')).toEqual(DEFAULT_FIELDS);
    });

    it('includes all available fields when specified', () => {
      const allFields = parseFields(
        'title,artist,album,duration,albumArtist,genre,year,trackNumber,discNumber,filePath'
      );
      expect(allFields).toEqual([
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
      ]);
    });
  });

  describe('calculateColumnWidths', () => {
    const tracks: DisplayTrack[] = [
      { title: 'Short', artist: 'A', album: 'X', duration: 60000 },
      { title: 'Medium Length', artist: 'Artist', album: 'Album Name', duration: 120000 },
    ];

    it('calculates widths based on content', () => {
      const fields: FieldName[] = ['title', 'artist', 'album'];
      const widths = calculateColumnWidths(tracks, fields);

      expect(widths.get('title')).toBe('Medium Length'.length);
      expect(widths.get('artist')).toBe('Artist'.length);
      expect(widths.get('album')).toBe('Album Name'.length);
    });

    it('uses header width when content is shorter', () => {
      const shortTracks: DisplayTrack[] = [{ title: 'X', artist: 'Y', album: 'Z' }];
      const fields: FieldName[] = ['title', 'artist', 'album'];
      const widths = calculateColumnWidths(shortTracks, fields);

      expect(widths.get('title')).toBe('Title'.length);
      expect(widths.get('artist')).toBe('Artist'.length);
      expect(widths.get('album')).toBe('Album'.length);
    });

    it('caps at max column width', () => {
      const longTracks: DisplayTrack[] = [
        { title: 'A'.repeat(100), artist: 'B', album: 'C' },
      ];
      const fields: FieldName[] = ['title'];
      const widths = calculateColumnWidths(longTracks, fields);

      expect(widths.get('title')).toBe(30); // DEFAULT_COLUMN_WIDTHS.title
    });
  });

  describe('formatTable', () => {
    const tracks: DisplayTrack[] = [
      {
        title: 'Bohemian Rhapsody',
        artist: 'Queen',
        album: 'A Night at the Opera',
        duration: 355000,
      },
      {
        title: 'Another One Bites the Dust',
        artist: 'Queen',
        album: 'The Game',
        duration: 216000,
      },
    ];

    it('returns message for empty tracks', () => {
      expect(formatTable([], ['title', 'artist'])).toBe('No tracks found.');
    });

    it('includes header row', () => {
      const output = formatTable(tracks, ['title', 'artist', 'album', 'duration']);
      const lines = output.split('\n');

      expect(lines[0]).toContain('Title');
      expect(lines[0]).toContain('Artist');
      expect(lines[0]).toContain('Album');
      expect(lines[0]).toContain('Duration');
    });

    it('includes separator line', () => {
      const output = formatTable(tracks, ['title']);
      const lines = output.split('\n');

      // Second line should be all box-drawing characters
      expect(lines[1]).toMatch(/^[\u2500]+$/);
    });

    it('includes data rows', () => {
      const output = formatTable(tracks, ['title', 'artist']);
      const lines = output.split('\n');

      expect(lines.length).toBe(4); // header + separator + 2 tracks
      expect(lines[2]).toContain('Bohemian Rhapsody');
      expect(lines[2]).toContain('Queen');
      expect(lines[3]).toContain('Another One Bites the Dust');
    });

    it('truncates long values', () => {
      const longTracks: DisplayTrack[] = [
        {
          title: 'This Is A Very Long Title That Should Be Truncated',
          artist: 'Artist',
          album: 'Album',
        },
      ];
      const output = formatTable(longTracks, ['title']);
      const lines = output.split('\n');

      expect(lines[2]).toContain('...');
      expect(lines[2]!.length).toBeLessThanOrEqual(35); // title width + padding
    });

    it('formats duration as MM:SS', () => {
      const output = formatTable(tracks, ['title', 'duration']);
      const lines = output.split('\n');

      expect(lines[2]).toContain('5:55');
      expect(lines[3]).toContain('3:36');
    });
  });

  describe('formatJson', () => {
    const tracks: DisplayTrack[] = [
      {
        title: 'Test Song',
        artist: 'Test Artist',
        album: 'Test Album',
        duration: 180000,
        genre: 'Rock',
      },
    ];

    it('outputs valid JSON', () => {
      const output = formatJson(tracks, ['title', 'artist']);
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it('outputs array', () => {
      const output = formatJson(tracks, ['title']);
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
    });

    it('includes only requested fields', () => {
      const output = formatJson(tracks, ['title', 'artist']);
      const parsed = JSON.parse(output);

      expect(parsed[0].title).toBe('Test Song');
      expect(parsed[0].artist).toBe('Test Artist');
      expect(parsed[0].album).toBeUndefined();
      expect(parsed[0].genre).toBeUndefined();
    });

    it('includes duration in both raw and formatted', () => {
      const output = formatJson(tracks, ['title', 'duration']);
      const parsed = JSON.parse(output);

      expect(parsed[0].duration).toBe(180000);
      expect(parsed[0].durationFormatted).toBe('3:00');
    });

    it('handles empty tracks array', () => {
      const output = formatJson([], ['title']);
      const parsed = JSON.parse(output);
      expect(parsed).toEqual([]);
    });
  });

  describe('escapeCsv', () => {
    it('returns simple strings unchanged', () => {
      expect(escapeCsv('Hello')).toBe('Hello');
      expect(escapeCsv('Test String')).toBe('Test String');
    });

    it('wraps strings with commas in quotes', () => {
      expect(escapeCsv('Hello, World')).toBe('"Hello, World"');
    });

    it('wraps strings with quotes and escapes them', () => {
      expect(escapeCsv('Say "Hello"')).toBe('"Say ""Hello"""');
    });

    it('wraps strings with newlines in quotes', () => {
      expect(escapeCsv('Line1\nLine2')).toBe('"Line1\nLine2"');
    });

    it('handles combination of special characters', () => {
      expect(escapeCsv('Hello, "World"\nGoodbye')).toBe('"Hello, ""World""\nGoodbye"');
    });
  });

  describe('formatCsv', () => {
    const tracks: DisplayTrack[] = [
      {
        title: 'Test Song',
        artist: 'Test Artist',
        album: 'Test Album',
        duration: 180000,
      },
      {
        title: 'Another Song',
        artist: 'Another Artist',
        album: 'Another Album',
        duration: 240000,
      },
    ];

    it('includes header row', () => {
      const output = formatCsv(tracks, ['title', 'artist', 'album', 'duration']);
      const lines = output.split('\n');

      expect(lines[0]).toBe('Title,Artist,Album,Duration');
    });

    it('includes data rows', () => {
      const output = formatCsv(tracks, ['title', 'artist']);
      const lines = output.split('\n');

      expect(lines.length).toBe(3); // header + 2 tracks
      expect(lines[1]).toBe('Test Song,Test Artist');
      expect(lines[2]).toBe('Another Song,Another Artist');
    });

    it('escapes values with commas', () => {
      const tracksWithCommas: DisplayTrack[] = [
        { title: 'Hello, World', artist: 'Test', album: 'Album' },
      ];
      const output = formatCsv(tracksWithCommas, ['title', 'artist']);
      const lines = output.split('\n');

      expect(lines[1]).toBe('"Hello, World",Test');
    });

    it('formats duration as MM:SS', () => {
      const output = formatCsv(tracks, ['title', 'duration']);
      const lines = output.split('\n');

      expect(lines[1]).toBe('Test Song,3:00');
      expect(lines[2]).toBe('Another Song,4:00');
    });

    it('handles empty tracks array', () => {
      const output = formatCsv([], ['title', 'artist']);
      const lines = output.split('\n');

      expect(lines.length).toBe(1);
      expect(lines[0]).toBe('Title,Artist');
    });

    it('handles only requested fields', () => {
      const output = formatCsv(tracks, ['artist', 'album']);
      const lines = output.split('\n');

      expect(lines[0]).toBe('Artist,Album');
      expect(lines[1]).toBe('Test Artist,Test Album');
    });
  });
});
