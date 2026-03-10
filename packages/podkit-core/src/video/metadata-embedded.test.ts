/**
 * Tests for embedded video metadata adapter
 */

import { describe, it, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { SpawnFn } from './probe.js';
import {
  EmbeddedVideoMetadataAdapter,
  VideoMetadataError,
  parseFilename,
} from './metadata-embedded.js';
import { isMovieMetadata, isTVShowMetadata } from './metadata.js';

// Sample ffprobe output for a movie with metadata
const SAMPLE_MOVIE_OUTPUT = JSON.stringify({
  format: {
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    duration: '7200.123',
    tags: {
      title: 'Test Movie Title',
      artist: 'Test Director',
      album_artist: 'Test Studio',
      date: '2024',
      description: 'A test movie with embedded metadata.',
      genre: 'Test',
    },
  },
});

// Sample ffprobe output for a TV show episode
const SAMPLE_TVSHOW_OUTPUT = JSON.stringify({
  format: {
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    duration: '2700.0',
    tags: {
      title: 'Pilot Episode',
      show: 'Test Show',
      season_number: '1',
      episode_sort: '1',
      episode_id: 'S01E01',
      network: 'Test Network',
      description: 'The first episode of our test TV series.',
      date: '2024',
      genre: 'Drama',
    },
  },
});

// Minimal output - no tags
const MINIMAL_OUTPUT = JSON.stringify({
  format: {
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    duration: '120.0',
  },
});

// Output with only some tags
const PARTIAL_MOVIE_OUTPUT = JSON.stringify({
  format: {
    format_name: 'matroska,webm',
    duration: '5400.0',
    tags: {
      title: 'Partial Movie',
      date: '2023-05-15',
    },
  },
});

// TV show with only season/episode tags (no show name)
const PARTIAL_TVSHOW_OUTPUT = JSON.stringify({
  format: {
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    duration: '1800.0',
    tags: {
      title: 'Episode Title',
      season_number: '2',
      episode_sort: '5',
    },
  },
});

// Output with synopsis instead of description
const MOVIE_WITH_SYNOPSIS = JSON.stringify({
  format: {
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    duration: '120.0',
    tags: {
      title: 'Synopsis Movie',
      synopsis: 'Extended synopsis text goes here.',
    },
  },
});

// Output with comment instead of description
const MOVIE_WITH_COMMENT = JSON.stringify({
  format: {
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    duration: '120.0',
    tags: {
      title: 'Comment Movie',
      comment: 'A comment about this movie.',
    },
  },
});

/**
 * Create a mock spawn function that returns the configured output
 */
function createMockSpawn(config: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: NodeJS.ErrnoException;
}): SpawnFn {
  return ((command: string, args: readonly string[], _options?: SpawnOptions): ChildProcess => {
    const stdoutStream = new EventEmitter();
    const stderrStream = new EventEmitter();

    const proc = new EventEmitter() as ChildProcess;

    (proc as unknown as Record<string, unknown>).stdout = stdoutStream;
    (proc as unknown as Record<string, unknown>).stderr = stderrStream;
    (proc as unknown as Record<string, unknown>).stdin = null;
    (proc as unknown as Record<string, unknown>).stdio = [
      null,
      stdoutStream,
      stderrStream,
      null,
      null,
    ];
    (proc as unknown as Record<string, unknown>).pid = 12345;
    (proc as unknown as Record<string, unknown>).killed = false;
    (proc as unknown as Record<string, unknown>).connected = false;
    (proc as unknown as Record<string, unknown>).exitCode = null;
    (proc as unknown as Record<string, unknown>).signalCode = null;
    (proc as unknown as Record<string, unknown>).spawnargs = [command, ...args];
    (proc as unknown as Record<string, unknown>).spawnfile = command;

    process.nextTick(() => {
      if (config.error) {
        proc.emit('error', config.error);
        return;
      }

      if (config.stdout) {
        stdoutStream.emit('data', Buffer.from(config.stdout));
      }

      if (config.stderr) {
        stderrStream.emit('data', Buffer.from(config.stderr));
      }

      proc.emit('close', config.exitCode ?? 0);
    });

    return proc;
  }) as SpawnFn;
}

describe('EmbeddedVideoMetadataAdapter', () => {
  describe('canHandle', () => {
    it('returns true for .mp4 files', async () => {
      const adapter = new EmbeddedVideoMetadataAdapter();
      expect(await adapter.canHandle('/path/to/video.mp4')).toBe(true);
    });

    it('returns true for .m4v files', async () => {
      const adapter = new EmbeddedVideoMetadataAdapter();
      expect(await adapter.canHandle('/path/to/video.m4v')).toBe(true);
    });

    it('returns true for .mkv files', async () => {
      const adapter = new EmbeddedVideoMetadataAdapter();
      expect(await adapter.canHandle('/path/to/video.mkv')).toBe(true);
    });

    it('returns true for .avi files', async () => {
      const adapter = new EmbeddedVideoMetadataAdapter();
      expect(await adapter.canHandle('/path/to/video.avi')).toBe(true);
    });

    it('returns true for .mov files', async () => {
      const adapter = new EmbeddedVideoMetadataAdapter();
      expect(await adapter.canHandle('/path/to/video.mov')).toBe(true);
    });

    it('returns true for .webm files', async () => {
      const adapter = new EmbeddedVideoMetadataAdapter();
      expect(await adapter.canHandle('/path/to/video.webm')).toBe(true);
    });

    it('returns false for .mp3 files', async () => {
      const adapter = new EmbeddedVideoMetadataAdapter();
      expect(await adapter.canHandle('/path/to/audio.mp3')).toBe(false);
    });

    it('returns false for .flac files', async () => {
      const adapter = new EmbeddedVideoMetadataAdapter();
      expect(await adapter.canHandle('/path/to/audio.flac')).toBe(false);
    });

    it('returns false for .txt files', async () => {
      const adapter = new EmbeddedVideoMetadataAdapter();
      expect(await adapter.canHandle('/path/to/readme.txt')).toBe(false);
    });

    it('handles uppercase extensions', async () => {
      const adapter = new EmbeddedVideoMetadataAdapter();
      expect(await adapter.canHandle('/path/to/video.MP4')).toBe(true);
    });
  });

  describe('getMetadata - movie content', () => {
    it('extracts full movie metadata', async () => {
      const mockSpawn = createMockSpawn({ stdout: SAMPLE_MOVIE_OUTPUT, exitCode: 0 });
      const adapter = new EmbeddedVideoMetadataAdapter({ _spawnFn: mockSpawn });

      const result = await adapter.getMetadata('/path/to/movie.mp4');

      expect(result).not.toBeNull();
      expect(isMovieMetadata(result!)).toBe(true);
      if (isMovieMetadata(result!)) {
        expect(result.title).toBe('Test Movie Title');
        expect(result.year).toBe(2024);
        expect(result.description).toBe('A test movie with embedded metadata.');
        expect(result.genre).toBe('Test');
        expect(result.director).toBe('Test Director');
        expect(result.studio).toBe('Test Studio');
      }
    });

    it('parses date with full format', async () => {
      const mockSpawn = createMockSpawn({ stdout: PARTIAL_MOVIE_OUTPUT, exitCode: 0 });
      const adapter = new EmbeddedVideoMetadataAdapter({ _spawnFn: mockSpawn });

      const result = await adapter.getMetadata('/path/to/movie.mkv');

      expect(result).not.toBeNull();
      expect(isMovieMetadata(result!)).toBe(true);
      if (isMovieMetadata(result!)) {
        expect(result.title).toBe('Partial Movie');
        expect(result.year).toBe(2023);
      }
    });

    it('uses synopsis when description is missing', async () => {
      const mockSpawn = createMockSpawn({ stdout: MOVIE_WITH_SYNOPSIS, exitCode: 0 });
      const adapter = new EmbeddedVideoMetadataAdapter({ _spawnFn: mockSpawn });

      const result = await adapter.getMetadata('/path/to/movie.mp4');

      expect(result).not.toBeNull();
      if (isMovieMetadata(result!)) {
        expect(result.description).toBe('Extended synopsis text goes here.');
      }
    });

    it('uses comment when description is missing', async () => {
      const mockSpawn = createMockSpawn({ stdout: MOVIE_WITH_COMMENT, exitCode: 0 });
      const adapter = new EmbeddedVideoMetadataAdapter({ _spawnFn: mockSpawn });

      const result = await adapter.getMetadata('/path/to/movie.mp4');

      expect(result).not.toBeNull();
      if (isMovieMetadata(result!)) {
        expect(result.description).toBe('A comment about this movie.');
      }
    });
  });

  describe('getMetadata - TV show content', () => {
    it('extracts full TV show metadata', async () => {
      const mockSpawn = createMockSpawn({ stdout: SAMPLE_TVSHOW_OUTPUT, exitCode: 0 });
      const adapter = new EmbeddedVideoMetadataAdapter({ _spawnFn: mockSpawn });

      const result = await adapter.getMetadata('/path/to/show.mp4');

      expect(result).not.toBeNull();
      expect(isTVShowMetadata(result!)).toBe(true);
      if (isTVShowMetadata(result!)) {
        expect(result.title).toBe('Pilot Episode');
        expect(result.seriesTitle).toBe('Test Show');
        expect(result.seasonNumber).toBe(1);
        expect(result.episodeNumber).toBe(1);
        expect(result.episodeId).toBe('S01E01');
        expect(result.network).toBe('Test Network');
        expect(result.description).toBe('The first episode of our test TV series.');
        expect(result.year).toBe(2024);
        expect(result.genre).toBe('Drama');
      }
    });

    it('generates episode ID when missing', async () => {
      const mockSpawn = createMockSpawn({ stdout: PARTIAL_TVSHOW_OUTPUT, exitCode: 0 });
      const adapter = new EmbeddedVideoMetadataAdapter({ _spawnFn: mockSpawn });

      const result = await adapter.getMetadata('/path/to/show.mp4');

      expect(result).not.toBeNull();
      expect(isTVShowMetadata(result!)).toBe(true);
      if (isTVShowMetadata(result!)) {
        expect(result.title).toBe('Episode Title');
        expect(result.seasonNumber).toBe(2);
        expect(result.episodeNumber).toBe(5);
        expect(result.episodeId).toBe('S02E05');
      }
    });
  });

  describe('getMetadata - filename fallback', () => {
    it('uses filename as title when no tags present', async () => {
      const mockSpawn = createMockSpawn({ stdout: MINIMAL_OUTPUT, exitCode: 0 });
      const adapter = new EmbeddedVideoMetadataAdapter({ _spawnFn: mockSpawn });

      const result = await adapter.getMetadata('/path/to/My Great Movie.mp4');

      expect(result).not.toBeNull();
      expect(isMovieMetadata(result!)).toBe(true);
      if (isMovieMetadata(result!)) {
        expect(result.title).toBe('My Great Movie');
      }
    });

    it('extracts year from filename (parentheses)', async () => {
      const mockSpawn = createMockSpawn({ stdout: MINIMAL_OUTPUT, exitCode: 0 });
      const adapter = new EmbeddedVideoMetadataAdapter({ _spawnFn: mockSpawn });

      const result = await adapter.getMetadata('/path/to/Awesome Film (2023).mp4');

      expect(result).not.toBeNull();
      expect(isMovieMetadata(result!)).toBe(true);
      if (isMovieMetadata(result!)) {
        expect(result.title).toBe('Awesome Film');
        expect(result.year).toBe(2023);
      }
    });

    it('extracts year from filename (brackets)', async () => {
      const mockSpawn = createMockSpawn({ stdout: MINIMAL_OUTPUT, exitCode: 0 });
      const adapter = new EmbeddedVideoMetadataAdapter({ _spawnFn: mockSpawn });

      const result = await adapter.getMetadata('/path/to/Cool Movie [2022].mp4');

      expect(result).not.toBeNull();
      expect(isMovieMetadata(result!)).toBe(true);
      if (isMovieMetadata(result!)) {
        expect(result.title).toBe('Cool Movie');
        expect(result.year).toBe(2022);
      }
    });

    it('detects TV show from S01E01 filename pattern', async () => {
      const mockSpawn = createMockSpawn({ stdout: MINIMAL_OUTPUT, exitCode: 0 });
      const adapter = new EmbeddedVideoMetadataAdapter({ _spawnFn: mockSpawn });

      const result = await adapter.getMetadata('/path/to/Show.Name.S02E15.Episode.Title.mp4');

      expect(result).not.toBeNull();
      expect(isTVShowMetadata(result!)).toBe(true);
      if (isTVShowMetadata(result!)) {
        expect(result.seasonNumber).toBe(2);
        expect(result.episodeNumber).toBe(15);
        expect(result.episodeId).toBe('S02E15');
      }
    });

    it('detects TV show from 1x01 filename pattern', async () => {
      const mockSpawn = createMockSpawn({ stdout: MINIMAL_OUTPUT, exitCode: 0 });
      const adapter = new EmbeddedVideoMetadataAdapter({ _spawnFn: mockSpawn });

      const result = await adapter.getMetadata('/path/to/Show Name - 3x08 - Episode Title.mp4');

      expect(result).not.toBeNull();
      expect(isTVShowMetadata(result!)).toBe(true);
      if (isTVShowMetadata(result!)) {
        expect(result.seasonNumber).toBe(3);
        expect(result.episodeNumber).toBe(8);
        expect(result.episodeId).toBe('S03E08');
      }
    });

    it('cleans dot-separated filenames', async () => {
      const mockSpawn = createMockSpawn({ stdout: MINIMAL_OUTPUT, exitCode: 0 });
      const adapter = new EmbeddedVideoMetadataAdapter({ _spawnFn: mockSpawn });

      const result = await adapter.getMetadata('/path/to/Movie.Name.2024.mp4');

      expect(result).not.toBeNull();
      expect(isMovieMetadata(result!)).toBe(true);
      if (isMovieMetadata(result!)) {
        expect(result.title).toBe('Movie Name');
        expect(result.year).toBe(2024);
      }
    });

    it('prefers embedded tags over filename', async () => {
      const mockSpawn = createMockSpawn({ stdout: SAMPLE_MOVIE_OUTPUT, exitCode: 0 });
      const adapter = new EmbeddedVideoMetadataAdapter({ _spawnFn: mockSpawn });

      const result = await adapter.getMetadata('/path/to/wrong_filename.mp4');

      expect(result).not.toBeNull();
      if (isMovieMetadata(result!)) {
        expect(result.title).toBe('Test Movie Title');
        expect(result.year).toBe(2024);
      }
    });
  });

  describe('error handling', () => {
    it('throws VideoMetadataError for file not found', async () => {
      const mockSpawn = createMockSpawn({
        stderr: 'No such file or directory',
        exitCode: 1,
      });
      const adapter = new EmbeddedVideoMetadataAdapter({ _spawnFn: mockSpawn });

      try {
        await adapter.getMetadata('/nonexistent/file.mp4');
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(err).toBeInstanceOf(VideoMetadataError);
        expect((err as VideoMetadataError).message).toContain('File not found');
      }
    });

    it('throws VideoMetadataError for invalid JSON output', async () => {
      const mockSpawn = createMockSpawn({
        stdout: 'not valid json',
        exitCode: 0,
      });
      const adapter = new EmbeddedVideoMetadataAdapter({ _spawnFn: mockSpawn });

      try {
        await adapter.getMetadata('/path/to/video.mp4');
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(err).toBeInstanceOf(VideoMetadataError);
        expect((err as VideoMetadataError).message).toContain('Failed to parse ffprobe JSON');
      }
    });

    it('throws VideoMetadataError when ffprobe fails', async () => {
      const mockSpawn = createMockSpawn({
        stderr: 'Some error',
        exitCode: 2,
      });
      const adapter = new EmbeddedVideoMetadataAdapter({ _spawnFn: mockSpawn });

      try {
        await adapter.getMetadata('/path/to/video.mp4');
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(err).toBeInstanceOf(VideoMetadataError);
        expect((err as VideoMetadataError).message).toContain('exit code 2');
        expect((err as VideoMetadataError).exitCode).toBe(2);
      }
    });

    it('throws VideoMetadataError when ffprobe is not found', async () => {
      const error = new Error('spawn ffprobe ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      const mockSpawn = createMockSpawn({ error });
      const adapter = new EmbeddedVideoMetadataAdapter({ _spawnFn: mockSpawn });

      try {
        await adapter.getMetadata('/path/to/video.mp4');
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(err).toBeInstanceOf(VideoMetadataError);
        expect((err as VideoMetadataError).message).toContain('ffprobe not found');
      }
    });
  });

  describe('custom ffprobe path', () => {
    it('uses custom ffprobe path when provided', async () => {
      let calledCommand: string | undefined;
      const mockSpawn: SpawnFn = ((
        command: string,
        args: readonly string[],
        options: SpawnOptions
      ): ChildProcess => {
        calledCommand = command;
        return createMockSpawn({ stdout: MINIMAL_OUTPUT, exitCode: 0 })(command, args, options);
      }) as SpawnFn;

      const adapter = new EmbeddedVideoMetadataAdapter({
        ffprobePath: '/custom/path/ffprobe',
        _spawnFn: mockSpawn,
      });

      await adapter.getMetadata('/path/to/video.mp4');

      expect(calledCommand).toBe('/custom/path/ffprobe');
    });
  });

  describe('adapter name', () => {
    it('has name "embedded"', () => {
      const adapter = new EmbeddedVideoMetadataAdapter();
      expect(adapter.name).toBe('embedded');
    });
  });
});

describe('parseFilename', () => {
  describe('movie patterns', () => {
    it('parses simple filename', () => {
      const result = parseFilename('/path/to/My Movie.mp4');
      expect(result.title).toBe('My Movie');
      expect(result.year).toBeUndefined();
    });

    it('parses year in parentheses', () => {
      const result = parseFilename('/path/to/The Matrix (1999).mp4');
      expect(result.title).toBe('The Matrix');
      expect(result.year).toBe(1999);
    });

    it('parses year in brackets', () => {
      const result = parseFilename('/path/to/Inception [2010].mkv');
      expect(result.title).toBe('Inception');
      expect(result.year).toBe(2010);
    });

    it('parses dot-separated with year', () => {
      const result = parseFilename('/path/to/Movie.Name.2020.mp4');
      expect(result.title).toBe('Movie Name');
      expect(result.year).toBe(2020);
    });

    it('cleans dot-separated filename', () => {
      const result = parseFilename('/path/to/Some.Movie.Name.mp4');
      expect(result.title).toBe('Some Movie Name');
    });
  });

  describe('TV show patterns', () => {
    it('parses S01E01 pattern', () => {
      const result = parseFilename('/path/to/Show.S01E01.Pilot.mp4');
      expect(result.title).toBe('Pilot');
      expect(result.seasonNumber).toBe(1);
      expect(result.episodeNumber).toBe(1);
    });

    it('parses S01E01 pattern (lowercase)', () => {
      const result = parseFilename('/path/to/Show.s02e15.mp4');
      expect(result.seasonNumber).toBe(2);
      expect(result.episodeNumber).toBe(15);
    });

    it('parses S01E01 pattern with dashes', () => {
      const result = parseFilename('/path/to/Show Name - S03E22 - Episode Title.mp4');
      expect(result.title).toBe('Episode Title');
      expect(result.seasonNumber).toBe(3);
      expect(result.episodeNumber).toBe(22);
    });

    it('parses 1x01 pattern', () => {
      const result = parseFilename('/path/to/Show.1x05.Episode.mp4');
      expect(result.title).toBe('Episode');
      expect(result.seasonNumber).toBe(1);
      expect(result.episodeNumber).toBe(5);
    });

    it('parses 1x01 pattern with dashes', () => {
      const result = parseFilename('/path/to/Show - 2x10 - Title.mp4');
      expect(result.title).toBe('Title');
      expect(result.seasonNumber).toBe(2);
      expect(result.episodeNumber).toBe(10);
    });

    it('uses show name as title when episode title is missing', () => {
      const result = parseFilename('/path/to/Breaking Bad.S01E01.mp4');
      expect(result.title).toBe('Breaking Bad');
      expect(result.seasonNumber).toBe(1);
      expect(result.episodeNumber).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('handles filename with multiple dots', () => {
      const result = parseFilename('/path/to/Dr.Who.S01E01.mp4');
      expect(result.seasonNumber).toBe(1);
      expect(result.episodeNumber).toBe(1);
    });

    it('handles complex paths', () => {
      const result = parseFilename('/long/path/to/movies/Drama/Movie (2024).mp4');
      expect(result.title).toBe('Movie');
      expect(result.year).toBe(2024);
    });

    it('handles years in 1900s', () => {
      const result = parseFilename('/path/to/Classic Film (1952).mp4');
      expect(result.title).toBe('Classic Film');
      expect(result.year).toBe(1952);
    });
  });
});

describe('VideoMetadataError', () => {
  it('has correct name property', () => {
    const error = new VideoMetadataError('test error');
    expect(error.name).toBe('VideoMetadataError');
  });

  it('stores exitCode and stderr', () => {
    const error = new VideoMetadataError('test error', 1, 'stderr output');
    expect(error.exitCode).toBe(1);
    expect(error.stderr).toBe('stderr output');
  });

  it('is an instance of Error', () => {
    const error = new VideoMetadataError('test error');
    expect(error).toBeInstanceOf(Error);
  });
});
