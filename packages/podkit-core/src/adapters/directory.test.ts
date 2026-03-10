/**
 * Unit tests for DirectoryAdapter
 *
 * These tests use mocks to avoid filesystem and music-metadata dependencies.
 */

import { describe, expect, it, beforeEach, mock } from 'bun:test';
import { DirectoryAdapter, createDirectoryAdapter } from './directory.js';
import type { ScanProgress, ScanWarning } from './directory.js';

// Mock the modules
const mockGlob = mock(async () => [] as string[]);
const mockParseFile = mock(async (_path: string) => ({
  common: {} as Record<string, unknown>,
  format: {} as Record<string, unknown>,
}));

// Replace imports with mocks
mock.module('glob', () => ({
  glob: mockGlob,
}));

mock.module('music-metadata', () => ({
  parseFile: mockParseFile,
}));

describe('DirectoryAdapter', () => {
  beforeEach(() => {
    mockGlob.mockReset();
    mockParseFile.mockReset();
    mockGlob.mockImplementation(async () => []);
    mockParseFile.mockImplementation(async () => ({
      common: {},
      format: {},
    }));
  });

  describe('constructor', () => {
    it('accepts path configuration', () => {
      const adapter = new DirectoryAdapter({ path: '/music' });
      expect(adapter.name).toBe('directory');
      expect(adapter.getRootPath()).toBe('/music');
    });

    it('resolves relative paths to absolute', () => {
      const adapter = new DirectoryAdapter({ path: './music' });
      expect(adapter.getRootPath()).toMatch(/^\/.*\/music$/);
    });

    it('accepts custom extensions', () => {
      const adapter = new DirectoryAdapter({
        path: '/music',
        extensions: ['wav', 'aiff'],
      });
      expect(adapter.name).toBe('directory');
    });
  });

  describe('createDirectoryAdapter', () => {
    it('creates DirectoryAdapter instance', () => {
      const adapter = createDirectoryAdapter({ path: '/music' });
      expect(adapter).toBeInstanceOf(DirectoryAdapter);
    });
  });

  describe('connect', () => {
    it('scans directory on connect', async () => {
      mockGlob.mockImplementation(async () => ['/music/song.mp3']);
      mockParseFile.mockImplementation(async () => ({
        common: { title: 'Test Song', artist: 'Artist', album: 'Album' },
        format: { duration: 180 },
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      await adapter.connect();

      expect(mockGlob).toHaveBeenCalled();
      expect(adapter.getTrackCount()).toBe(1);
    });

    it('does not rescan if already connected', async () => {
      mockGlob.mockImplementation(async () => ['/music/song.mp3']);
      mockParseFile.mockImplementation(async () => ({
        common: { title: 'Test' },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      await adapter.connect();
      await adapter.connect(); // Second connect

      // Glob should only be called once
      expect(mockGlob).toHaveBeenCalledTimes(1);
    });
  });

  describe('getTracks', () => {
    it('returns empty array for empty directory', async () => {
      mockGlob.mockImplementation(async () => []);

      const adapter = new DirectoryAdapter({ path: '/empty' });
      const tracks = await adapter.getTracks();

      expect(tracks).toEqual([]);
    });

    it('parses metadata from audio files', async () => {
      mockGlob.mockImplementation(async () => ['/music/song.flac']);
      mockParseFile.mockImplementation(async () => ({
        common: {
          title: 'Test Song',
          artist: 'Test Artist',
          album: 'Test Album',
          albumartist: 'Album Artist',
          genre: ['Rock', 'Alternative'],
          year: 2023,
          track: { no: 1 },
          disk: { no: 1 },
          composer: ['Composer Name'],
          musicbrainz_recordingid: 'mb-recording-123',
          musicbrainz_albumid: 'mb-album-456',
          acoustid_id: 'acoust-789',
        },
        format: {
          duration: 245.5,
        },
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const tracks = await adapter.getTracks();

      expect(tracks).toHaveLength(1);
      const track = tracks[0]!;
      expect(track.id).toBe('/music/song.flac');
      expect(track.title).toBe('Test Song');
      expect(track.artist).toBe('Test Artist');
      expect(track.album).toBe('Test Album');
      expect(track.albumArtist).toBe('Album Artist');
      expect(track.genre).toBe('Rock');
      expect(track.year).toBe(2023);
      expect(track.trackNumber).toBe(1);
      expect(track.discNumber).toBe(1);
      expect(track.duration).toBe(245500); // milliseconds
      expect(track.filePath).toBe('/music/song.flac');
      expect(track.fileType).toBe('flac');
      expect(track.musicBrainzRecordingId).toBe('mb-recording-123');
      expect(track.musicBrainzReleaseId).toBe('mb-album-456');
      expect(track.acoustId).toBe('acoust-789');
    });

    it('handles multiple audio formats', async () => {
      mockGlob.mockImplementation(async () => [
        '/music/song1.mp3',
        '/music/song2.m4a',
        '/music/song3.ogg',
        '/music/song4.opus',
      ]);
      mockParseFile.mockImplementation(async () => ({
        common: { title: 'Track' },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const tracks = await adapter.getTracks();

      expect(tracks).toHaveLength(4);
      expect(tracks[0]!.fileType).toBe('mp3');
      expect(tracks[1]!.fileType).toBe('m4a');
      expect(tracks[2]!.fileType).toBe('ogg');
      expect(tracks[3]!.fileType).toBe('opus');
    });

    it('auto-connects if not yet connected', async () => {
      mockGlob.mockImplementation(async () => ['/music/song.mp3']);
      mockParseFile.mockImplementation(async () => ({
        common: { title: 'Test' },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      // Call getTracks without connecting first
      const tracks = await adapter.getTracks();

      expect(tracks).toHaveLength(1);
    });
  });

  describe('missing metadata handling', () => {
    it('uses filename as title when title is missing', async () => {
      mockGlob.mockImplementation(async () => ['/music/My Song.mp3']);
      mockParseFile.mockImplementation(async () => ({
        common: { artist: 'Artist', album: 'Album' },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const tracks = await adapter.getTracks();

      expect(tracks[0]!.title).toBe('My Song');
    });

    it('strips track number prefix from filename', async () => {
      mockGlob.mockImplementation(async () => ['/music/01 - Track Name.flac']);
      mockParseFile.mockImplementation(async () => ({
        common: {},
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const tracks = await adapter.getTracks();

      expect(tracks[0]!.title).toBe('Track Name');
    });

    it('strips various track number formats from filename', async () => {
      const testCases = [
        { filename: '01. Track.mp3', expected: 'Track' },
        { filename: '1_Song.mp3', expected: 'Song' },
        { filename: '123 - Music.mp3', expected: 'Music' },
        { filename: '01- Test.mp3', expected: 'Test' },
      ];

      for (const { filename, expected } of testCases) {
        mockGlob.mockImplementation(async () => [`/music/${filename}`]);
        mockParseFile.mockImplementation(async () => ({
          common: {},
          format: {},
        }));

        const adapter = new DirectoryAdapter({ path: '/music' });
        const tracks = await adapter.getTracks();
        expect(tracks[0]!.title).toBe(expected);
      }
    });

    it('uses filename as-is when it looks like a track number without separator', async () => {
      // Edge case: filename is just a track number like "01.mp3"
      // The regex only strips "01 - " or "01. " patterns, not bare numbers
      mockGlob.mockImplementation(async () => ['/music/01.mp3']);
      mockParseFile.mockImplementation(async () => ({
        common: {},
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const tracks = await adapter.getTracks();

      expect(tracks[0]!.title).toBe('01');
    });

    it('uses Unknown Title for empty filename', async () => {
      // Edge case: filename with only whitespace that gets stripped
      mockGlob.mockImplementation(async () => ['/music/01 - .mp3']);
      mockParseFile.mockImplementation(async () => ({
        common: {},
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const tracks = await adapter.getTracks();

      expect(tracks[0]!.title).toBe('Unknown Title');
    });

    it('uses Unknown Artist when artist is missing', async () => {
      mockGlob.mockImplementation(async () => ['/music/song.mp3']);
      mockParseFile.mockImplementation(async () => ({
        common: { title: 'Song' },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const tracks = await adapter.getTracks();

      expect(tracks[0]!.artist).toBe('Unknown Artist');
    });

    it('uses Unknown Album when album is missing', async () => {
      mockGlob.mockImplementation(async () => ['/music/song.mp3']);
      mockParseFile.mockImplementation(async () => ({
        common: { title: 'Song', artist: 'Artist' },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const tracks = await adapter.getTracks();

      expect(tracks[0]!.album).toBe('Unknown Album');
    });

    it('handles missing optional fields gracefully', async () => {
      mockGlob.mockImplementation(async () => ['/music/song.mp3']);
      mockParseFile.mockImplementation(async () => ({
        common: { title: 'Song', artist: 'Artist', album: 'Album' },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const tracks = await adapter.getTracks();

      const track = tracks[0]!;
      expect(track.albumArtist).toBeUndefined();
      expect(track.genre).toBeUndefined();
      expect(track.year).toBeUndefined();
      expect(track.trackNumber).toBeUndefined();
      expect(track.discNumber).toBeUndefined();
      expect(track.duration).toBeUndefined();
      expect(track.musicBrainzRecordingId).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('continues parsing after file errors and calls onWarning', async () => {
      let callCount = 0;
      mockGlob.mockImplementation(async () => [
        '/music/good1.mp3',
        '/music/bad.mp3',
        '/music/good2.mp3',
      ]);
      mockParseFile.mockImplementation(async (path: string) => {
        callCount++;
        if (path.includes('bad')) {
          throw new Error('Corrupted file');
        }
        return {
          common: { title: `Track ${callCount}` },
          format: {},
        };
      });

      const warnings: ScanWarning[] = [];
      const adapter = new DirectoryAdapter({
        path: '/music',
        onWarning: (warning) => warnings.push(warning),
      });

      const tracks = await adapter.getTracks();

      expect(tracks).toHaveLength(2);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.file).toBe('/music/bad.mp3');
      expect(warnings[0]!.message).toContain('Corrupted file');
    });

    it('continues parsing when onWarning is not provided', async () => {
      let callCount = 0;
      mockGlob.mockImplementation(async () => [
        '/music/good1.mp3',
        '/music/bad.mp3',
        '/music/good2.mp3',
      ]);
      mockParseFile.mockImplementation(async (path: string) => {
        callCount++;
        if (path.includes('bad')) {
          throw new Error('Corrupted file');
        }
        return {
          common: { title: `Track ${callCount}` },
          format: {},
        };
      });

      const adapter = new DirectoryAdapter({ path: '/music' });
      const tracks = await adapter.getTracks();

      // Should still continue and parse the good files
      expect(tracks).toHaveLength(2);
    });
  });

  describe('getFilteredTracks', () => {
    beforeEach(() => {
      mockGlob.mockImplementation(async () => [
        '/music/rock/song1.mp3',
        '/music/jazz/song2.mp3',
        '/music/rock/song3.mp3',
      ]);
    });

    it('filters by artist', async () => {
      mockParseFile.mockImplementation(async (path: string) => ({
        common: {
          title: path.includes('song1') ? 'Song 1' : path.includes('song2') ? 'Song 2' : 'Song 3',
          artist: path.includes('song1') ? 'Artist A' : 'Artist B',
          album: 'Album',
        },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const filtered = await adapter.getFilteredTracks({ artist: 'artist a' });

      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.artist).toBe('Artist A');
    });

    it('filters by album', async () => {
      mockParseFile.mockImplementation(async (path: string) => ({
        common: {
          title: 'Song',
          artist: 'Artist',
          album: path.includes('rock') ? 'Rock Album' : 'Jazz Album',
        },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const filtered = await adapter.getFilteredTracks({ album: 'Jazz' });

      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.album).toBe('Jazz Album');
    });

    it('filters by genre', async () => {
      mockParseFile.mockImplementation(async (path: string) => ({
        common: {
          title: 'Song',
          artist: 'Artist',
          album: 'Album',
          genre: path.includes('rock') ? ['Rock'] : ['Jazz'],
        },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const filtered = await adapter.getFilteredTracks({ genre: 'Rock' });

      expect(filtered).toHaveLength(2);
    });

    it('filters by year', async () => {
      mockParseFile.mockImplementation(async (path: string) => ({
        common: {
          title: 'Song',
          artist: 'Artist',
          album: 'Album',
          year: path.includes('song1') ? 2020 : 2023,
        },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const filtered = await adapter.getFilteredTracks({ year: 2020 });

      expect(filtered).toHaveLength(1);
    });

    it('filters by path pattern', async () => {
      mockParseFile.mockImplementation(async () => ({
        common: { title: 'Song', artist: 'Artist', album: 'Album' },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const filtered = await adapter.getFilteredTracks({ pathPattern: '**/rock/**' });

      expect(filtered).toHaveLength(2);
    });

    it('filters by albumArtist when filtering artist', async () => {
      mockParseFile.mockImplementation(async (path: string) => ({
        common: {
          title: 'Song',
          artist: 'Various Artists',
          albumartist: path.includes('song1') ? 'Album Artist' : 'Other',
          album: 'Compilation',
        },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const filtered = await adapter.getFilteredTracks({ artist: 'Album Artist' });

      expect(filtered).toHaveLength(1);
    });

    it('combines multiple filters', async () => {
      mockParseFile.mockImplementation(async (path: string) => ({
        common: {
          title: 'Song',
          artist: 'Artist',
          album: path.includes('rock') ? 'Rock Album' : 'Jazz Album',
          year: path.includes('song1') ? 2020 : 2023,
        },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const filtered = await adapter.getFilteredTracks({
        album: 'Rock',
        year: 2023,
      });

      expect(filtered).toHaveLength(1);
    });
  });

  describe('getFileAccess', () => {
    it('returns path-based file access', async () => {
      mockGlob.mockImplementation(async () => ['/music/test.mp3']);
      mockParseFile.mockImplementation(async () => ({
        common: { title: 'Test' },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const tracks = await adapter.getTracks();

      const access = adapter.getFileAccess(tracks[0]!);
      expect(access.type).toBe('path');
      expect(access).toEqual({ type: 'path', path: '/music/test.mp3' });
    });
  });

  describe('disconnect', () => {
    it('clears cache and resets connection state', async () => {
      mockGlob.mockImplementation(async () => ['/music/song.mp3']);
      mockParseFile.mockImplementation(async () => ({
        common: { title: 'Test' },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      await adapter.connect();
      expect(adapter.getTrackCount()).toBe(1);

      await adapter.disconnect();
      expect(adapter.getTrackCount()).toBe(0);
    });

    it('allows reconnecting after disconnect', async () => {
      mockGlob.mockImplementation(async () => ['/music/song.mp3']);
      mockParseFile.mockImplementation(async () => ({
        common: { title: 'Test' },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      await adapter.connect();
      await adapter.disconnect();
      await adapter.connect();

      expect(adapter.getTrackCount()).toBe(1);
      expect(mockGlob).toHaveBeenCalledTimes(2);
    });
  });

  describe('progress reporting', () => {
    it('reports progress during scan', async () => {
      mockGlob.mockImplementation(async () => ['/music/song1.mp3', '/music/song2.mp3']);
      mockParseFile.mockImplementation(async () => ({
        common: { title: 'Test' },
        format: {},
      }));

      const progressUpdates: ScanProgress[] = [];
      const adapter = new DirectoryAdapter({
        path: '/music',
        onProgress: (progress) => progressUpdates.push({ ...progress }),
      });

      await adapter.connect();

      // Should have discovery phase, then parsing updates
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[0]!.phase).toBe('discovering');

      const parsingUpdates = progressUpdates.filter((p) => p.phase === 'parsing');
      expect(parsingUpdates.length).toBeGreaterThan(0);
    });
  });

  describe('unicode and special characters', () => {
    it('handles unicode in file paths', async () => {
      mockGlob.mockImplementation(async () => ['/music/\u97F3\u697D/\u66F2.flac']);
      mockParseFile.mockImplementation(async () => ({
        common: {
          title: '\u97F3\u697D\u306E\u66F2',
          artist: '\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8',
        },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const tracks = await adapter.getTracks();

      expect(tracks).toHaveLength(1);
      expect(tracks[0]!.title).toBe('\u97F3\u697D\u306E\u66F2');
      expect(tracks[0]!.artist).toBe('\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8');
    });

    it('handles special characters in metadata', async () => {
      mockGlob.mockImplementation(async () => ['/music/song.mp3']);
      mockParseFile.mockImplementation(async () => ({
        common: {
          title: "Rock 'n' Roll & Blues",
          artist: 'AC/DC',
          album: "Let's Go! (Special Edition)",
        },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const tracks = await adapter.getTracks();

      expect(tracks[0]!.title).toBe("Rock 'n' Roll & Blues");
      expect(tracks[0]!.artist).toBe('AC/DC');
      expect(tracks[0]!.album).toBe("Let's Go! (Special Edition)");
    });

    it('handles emoji in metadata', async () => {
      mockGlob.mockImplementation(async () => ['/music/song.mp3']);
      mockParseFile.mockImplementation(async () => ({
        common: {
          title: 'Summer Vibes \u2600\uFE0F\uD83C\uDFB6',
          artist: 'Artist',
          album: 'Album',
        },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const tracks = await adapter.getTracks();

      expect(tracks[0]!.title).toBe('Summer Vibes \u2600\uFE0F\uD83C\uDFB6');
    });
  });

  describe('file type detection', () => {
    it('detects FLAC files', async () => {
      mockGlob.mockImplementation(async () => ['/music/song.flac', '/music/song.FLAC']);
      mockParseFile.mockImplementation(async () => ({
        common: { title: 'Test' },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const tracks = await adapter.getTracks();

      expect(tracks.every((t) => t.fileType === 'flac')).toBe(true);
    });

    it('detects AAC files', async () => {
      mockGlob.mockImplementation(async () => ['/music/song.aac']);
      mockParseFile.mockImplementation(async () => ({
        common: { title: 'Test' },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const tracks = await adapter.getTracks();

      expect(tracks[0]!.fileType).toBe('aac');
    });

    it('detects WAV files', async () => {
      mockGlob.mockImplementation(async () => ['/music/song.wav']);
      mockParseFile.mockImplementation(async () => ({
        common: { title: 'Test' },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const tracks = await adapter.getTracks();

      expect(tracks[0]!.fileType).toBe('wav');
    });

    it('defaults to m4a for unknown extensions', async () => {
      // Edge case: unknown extension falls back to m4a
      mockGlob.mockImplementation(async () => ['/music/song.xyz']);
      mockParseFile.mockImplementation(async () => ({
        common: { title: 'Test' },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const tracks = await adapter.getTracks();

      expect(tracks[0]!.fileType).toBe('m4a');
    });
  });

  describe('edge cases', () => {
    it('handles files with special characters in path', async () => {
      mockGlob.mockImplementation(async () => ["/music/Artist's Album (Deluxe) [2023]/song.mp3"]);
      mockParseFile.mockImplementation(async () => ({
        common: { title: 'Test' },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const tracks = await adapter.getTracks();

      expect(tracks[0]!.filePath).toBe("/music/Artist's Album (Deluxe) [2023]/song.mp3");
    });

    it('treats zero duration as undefined', async () => {
      // Edge case: zero duration is falsy, so treated as undefined
      mockGlob.mockImplementation(async () => ['/music/song.mp3']);
      mockParseFile.mockImplementation(async () => ({
        common: { title: 'Test' },
        format: { duration: 0 },
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const tracks = await adapter.getTracks();

      expect(tracks[0]!.duration).toBeUndefined();
    });

    it('handles tracks with very long duration', async () => {
      mockGlob.mockImplementation(async () => ['/music/long-mix.mp3']);
      mockParseFile.mockImplementation(async () => ({
        common: { title: 'Long Mix' },
        format: { duration: 7200.5 }, // 2 hours
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const tracks = await adapter.getTracks();

      expect(tracks[0]!.duration).toBe(7200500); // milliseconds
    });

    it('handles null track number', async () => {
      mockGlob.mockImplementation(async () => ['/music/song.mp3']);
      mockParseFile.mockImplementation(async () => ({
        common: {
          title: 'Test',
          track: { no: null },
        },
        format: {},
      }));

      const adapter = new DirectoryAdapter({ path: '/music' });
      const tracks = await adapter.getTracks();

      expect(tracks[0]!.trackNumber).toBeUndefined();
    });
  });
});
