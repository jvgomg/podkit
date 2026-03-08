/**
 * Unit tests for video track utilities.
 */

import { describe, expect, it } from 'bun:test';
import {
  createMovieTrackInput,
  createTVShowTrackInput,
  createVideoTrackInput,
  isVideoMediaType,
  getVideoTypeName,
} from './video.js';
import { MediaType } from './constants.js';
import type { CollectionVideo } from '../video/directory-adapter.js';
import type { VideoSourceAnalysis } from '../video/types.js';

// Helper to create a mock CollectionVideo
function createMockVideo(overrides: Partial<CollectionVideo> = {}): CollectionVideo {
  return {
    id: '/path/to/video.mkv',
    filePath: '/path/to/video.mkv',
    contentType: 'movie',
    title: 'Test Movie',
    container: 'mkv',
    videoCodec: 'h264',
    audioCodec: 'aac',
    width: 1920,
    height: 1080,
    duration: 7200,
    ...overrides,
  };
}

// Helper to create a mock VideoSourceAnalysis
function createMockAnalysis(overrides: Partial<VideoSourceAnalysis> = {}): VideoSourceAnalysis {
  return {
    filePath: '/path/to/video.mkv',
    container: 'mkv',
    videoCodec: 'h264',
    videoProfile: 'high',
    videoLevel: '4.1',
    width: 1920,
    height: 1080,
    videoBitrate: 5000,
    frameRate: 24,
    audioCodec: 'aac',
    audioBitrate: 192,
    audioChannels: 2,
    audioSampleRate: 48000,
    duration: 7200,
    hasVideoStream: true,
    hasAudioStream: true,
    ...overrides,
  };
}

describe('createMovieTrackInput', () => {
  it('creates movie track input with correct media type', () => {
    const video = createMockVideo({ title: 'Action Movie' });
    const analysis = createMockAnalysis();

    const input = createMovieTrackInput(video, analysis);

    expect(input.title).toBe('Action Movie');
    expect(input.mediaType).toBe(MediaType.Movie);
    expect(input.movieFlag).toBe(true);
  });

  it('sets duration from analysis (in milliseconds)', () => {
    const video = createMockVideo();
    const analysis = createMockAnalysis({ duration: 3600 }); // 1 hour

    const input = createMovieTrackInput(video, analysis);

    expect(input.duration).toBe(3600000); // Converted to ms
  });

  it('calculates bitrate from analysis', () => {
    const video = createMockVideo();
    const analysis = createMockAnalysis({
      videoBitrate: 5000,
      audioBitrate: 192,
    });

    const input = createMovieTrackInput(video, analysis);

    expect(input.bitrate).toBe(5192);
  });

  it('uses director or studio as artist', () => {
    const video = createMockVideo({
      director: 'Christopher Nolan',
      studio: 'Warner Bros',
    });
    const analysis = createMockAnalysis();

    const input = createMovieTrackInput(video, analysis);

    expect(input.artist).toBe('Christopher Nolan');

    // Without director, falls back to studio
    const video2 = createMockVideo({ studio: 'Paramount' });
    const input2 = createMovieTrackInput(video2, analysis);
    expect(input2.artist).toBe('Paramount');
  });

  it('respects options overrides', () => {
    const video = createMockVideo();
    const analysis = createMockAnalysis();

    const input = createMovieTrackInput(video, analysis, {
      filetype: 'Custom video file',
      size: 1234567890,
      bitrate: 999,
      sampleRate: 44100,
    });

    expect(input.filetype).toBe('Custom video file');
    expect(input.size).toBe(1234567890);
    expect(input.bitrate).toBe(999);
    expect(input.sampleRate).toBe(44100);
  });

  it('includes metadata fields', () => {
    const video = createMockVideo({
      genre: 'Science Fiction',
      year: 2024,
      description: 'An epic adventure',
    });
    const analysis = createMockAnalysis();

    const input = createMovieTrackInput(video, analysis);

    expect(input.genre).toBe('Science Fiction');
    expect(input.year).toBe(2024);
    expect(input.comment).toBe('An epic adventure');
  });
});

describe('createTVShowTrackInput', () => {
  it('creates TV show track input with correct media type', () => {
    const video = createMockVideo({
      contentType: 'tvshow',
      title: 'Pilot',
      seriesTitle: 'Breaking Bad',
      seasonNumber: 1,
      episodeNumber: 1,
    });
    const analysis = createMockAnalysis();

    const input = createTVShowTrackInput(video, analysis);

    expect(input.title).toBe('Pilot');
    expect(input.mediaType).toBe(MediaType.TVShow);
    expect(input.movieFlag).toBe(false);
    expect(input.tvShow).toBe('Breaking Bad');
    expect(input.tvEpisode).toBe('Pilot');
    expect(input.seasonNumber).toBe(1);
    expect(input.episodeNumber).toBe(1);
  });

  it('sets artist to series title', () => {
    const video = createMockVideo({
      contentType: 'tvshow',
      seriesTitle: 'Game of Thrones',
    });
    const analysis = createMockAnalysis();

    const input = createTVShowTrackInput(video, analysis);

    expect(input.artist).toBe('Game of Thrones');
  });

  it('formats album as "Series, Season N"', () => {
    const video = createMockVideo({
      contentType: 'tvshow',
      seriesTitle: 'The Office',
      seasonNumber: 3,
    });
    const analysis = createMockAnalysis();

    const input = createTVShowTrackInput(video, analysis);

    expect(input.album).toBe('The Office, Season 3');
  });

  it('maps episode to track number, season to disc number', () => {
    const video = createMockVideo({
      contentType: 'tvshow',
      seriesTitle: 'Friends',
      seasonNumber: 2,
      episodeNumber: 14,
    });
    const analysis = createMockAnalysis();

    const input = createTVShowTrackInput(video, analysis);

    expect(input.trackNumber).toBe(14);
    expect(input.discNumber).toBe(2);
  });

  it('defaults to season 1 and episode 1 when not provided', () => {
    const video = createMockVideo({
      contentType: 'tvshow',
      seriesTitle: 'Some Show',
      // No seasonNumber or episodeNumber
    });
    const analysis = createMockAnalysis();

    const input = createTVShowTrackInput(video, analysis);

    expect(input.seasonNumber).toBe(1);
    expect(input.episodeNumber).toBe(1);
  });
});

describe('createVideoTrackInput', () => {
  it('delegates to createMovieTrackInput for movies', () => {
    const video = createMockVideo({ contentType: 'movie' });
    const analysis = createMockAnalysis();

    const input = createVideoTrackInput(video, analysis);

    expect(input.mediaType).toBe(MediaType.Movie);
    expect(input.movieFlag).toBe(true);
  });

  it('delegates to createTVShowTrackInput for TV shows', () => {
    const video = createMockVideo({
      contentType: 'tvshow',
      seriesTitle: 'Test Series',
      seasonNumber: 1,
      episodeNumber: 1,
    });
    const analysis = createMockAnalysis();

    const input = createVideoTrackInput(video, analysis);

    expect(input.mediaType).toBe(MediaType.TVShow);
    expect(input.tvShow).toBe('Test Series');
    expect(input.movieFlag).toBe(false);
  });
});

describe('isVideoMediaType', () => {
  it('returns true for Movie', () => {
    expect(isVideoMediaType(MediaType.Movie)).toBe(true);
  });

  it('returns true for TVShow', () => {
    expect(isVideoMediaType(MediaType.TVShow)).toBe(true);
  });

  it('returns true for MusicVideo', () => {
    expect(isVideoMediaType(MediaType.MusicVideo)).toBe(true);
  });

  it('returns false for Audio', () => {
    expect(isVideoMediaType(MediaType.Audio)).toBe(false);
  });

  it('returns false for Podcast', () => {
    expect(isVideoMediaType(MediaType.Podcast)).toBe(false);
  });

  it('returns false for Audiobook', () => {
    expect(isVideoMediaType(MediaType.Audiobook)).toBe(false);
  });

  it('returns false for 0', () => {
    expect(isVideoMediaType(0)).toBe(false);
  });
});

describe('getVideoTypeName', () => {
  it('returns "Movie" for Movie media type', () => {
    expect(getVideoTypeName(MediaType.Movie)).toBe('Movie');
  });

  it('returns "TV Show" for TVShow media type', () => {
    expect(getVideoTypeName(MediaType.TVShow)).toBe('TV Show');
  });

  it('returns "Music Video" for MusicVideo media type', () => {
    expect(getVideoTypeName(MediaType.MusicVideo)).toBe('Music Video');
  });

  it('returns "Video" for unknown video types', () => {
    expect(getVideoTypeName(MediaType.Audio)).toBe('Video');
    expect(getVideoTypeName(0)).toBe('Video');
  });
});
