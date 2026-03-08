/**
 * Tests for video metadata types and adapters
 */

import { describe, it, expect } from 'bun:test';
import type { VideoMetadata, MovieMetadata, TVShowMetadata, VideoMetadataAdapter } from './metadata.js';
import {
  isMovieMetadata,
  isTVShowMetadata,
  formatEpisodeId,
  parseEpisodeId,
} from './metadata.js';

// =============================================================================
// Type Guard Tests
// =============================================================================

describe('isMovieMetadata', () => {
  it('returns true for movie metadata', () => {
    const movie: MovieMetadata = {
      contentType: 'movie',
      title: 'The Matrix',
      year: 1999,
      director: 'The Wachowskis',
    };

    expect(isMovieMetadata(movie)).toBe(true);
  });

  it('returns false for TV show metadata', () => {
    const tvShow: TVShowMetadata = {
      contentType: 'tvshow',
      title: 'Pilot',
      seriesTitle: 'Breaking Bad',
      seasonNumber: 1,
      episodeNumber: 1,
    };

    expect(isMovieMetadata(tvShow)).toBe(false);
  });
});

describe('isTVShowMetadata', () => {
  it('returns true for TV show metadata', () => {
    const tvShow: TVShowMetadata = {
      contentType: 'tvshow',
      title: 'Ozymandias',
      seriesTitle: 'Breaking Bad',
      seasonNumber: 5,
      episodeNumber: 14,
      episodeId: 'S05E14',
    };

    expect(isTVShowMetadata(tvShow)).toBe(true);
  });

  it('returns false for movie metadata', () => {
    const movie: MovieMetadata = {
      contentType: 'movie',
      title: 'Inception',
    };

    expect(isTVShowMetadata(movie)).toBe(false);
  });
});

// =============================================================================
// Type Narrowing Tests
// =============================================================================

describe('VideoMetadata type narrowing', () => {
  it('narrows to MovieMetadata when contentType is movie', () => {
    const metadata: VideoMetadata = {
      contentType: 'movie',
      title: 'Interstellar',
      year: 2014,
      genre: 'Sci-Fi',
      director: 'Christopher Nolan',
      studio: 'Paramount Pictures',
    };

    if (isMovieMetadata(metadata)) {
      // TypeScript should allow accessing movie-specific fields
      expect(metadata.director).toBe('Christopher Nolan');
      expect(metadata.studio).toBe('Paramount Pictures');
    } else {
      throw new Error('Should have been movie metadata');
    }
  });

  it('narrows to TVShowMetadata when contentType is tvshow', () => {
    const metadata: VideoMetadata = {
      contentType: 'tvshow',
      title: 'The Rains of Castamere',
      year: 2013,
      seriesTitle: 'Game of Thrones',
      seasonNumber: 3,
      episodeNumber: 9,
      episodeId: 'S03E09',
      network: 'HBO',
    };

    if (isTVShowMetadata(metadata)) {
      // TypeScript should allow accessing TV-specific fields
      expect(metadata.seriesTitle).toBe('Game of Thrones');
      expect(metadata.seasonNumber).toBe(3);
      expect(metadata.episodeNumber).toBe(9);
      expect(metadata.episodeId).toBe('S03E09');
      expect(metadata.network).toBe('HBO');
    } else {
      throw new Error('Should have been TV show metadata');
    }
  });

  it('handles minimal movie metadata', () => {
    const metadata: VideoMetadata = {
      contentType: 'movie',
      title: 'Untitled Film',
    };

    expect(isMovieMetadata(metadata)).toBe(true);
    if (isMovieMetadata(metadata)) {
      expect(metadata.director).toBeUndefined();
      expect(metadata.studio).toBeUndefined();
      expect(metadata.year).toBeUndefined();
    }
  });

  it('handles minimal TV show metadata', () => {
    const metadata: VideoMetadata = {
      contentType: 'tvshow',
      title: 'Episode 1',
      seriesTitle: 'New Show',
      seasonNumber: 1,
      episodeNumber: 1,
    };

    expect(isTVShowMetadata(metadata)).toBe(true);
    if (isTVShowMetadata(metadata)) {
      expect(metadata.episodeId).toBeUndefined();
      expect(metadata.network).toBeUndefined();
    }
  });
});

// =============================================================================
// Episode ID Formatting Tests
// =============================================================================

describe('formatEpisodeId', () => {
  it('formats single-digit season and episode', () => {
    expect(formatEpisodeId(1, 1)).toBe('S01E01');
  });

  it('formats double-digit season and episode', () => {
    expect(formatEpisodeId(12, 24)).toBe('S12E24');
  });

  it('pads season and episode to two digits', () => {
    expect(formatEpisodeId(3, 5)).toBe('S03E05');
  });

  it('handles large season numbers', () => {
    expect(formatEpisodeId(100, 1)).toBe('S100E01');
  });
});

describe('parseEpisodeId', () => {
  it('parses S01E01 format', () => {
    const result = parseEpisodeId('S01E01');
    expect(result).toEqual({ seasonNumber: 1, episodeNumber: 1 });
  });

  it('parses lowercase s01e01 format', () => {
    const result = parseEpisodeId('s03e14');
    expect(result).toEqual({ seasonNumber: 3, episodeNumber: 14 });
  });

  it('parses mixed case S01e01 format', () => {
    const result = parseEpisodeId('S02e08');
    expect(result).toEqual({ seasonNumber: 2, episodeNumber: 8 });
  });

  it('parses 1x01 format', () => {
    const result = parseEpisodeId('1x05');
    expect(result).toEqual({ seasonNumber: 1, episodeNumber: 5 });
  });

  it('parses double-digit 12x24 format', () => {
    const result = parseEpisodeId('12x24');
    expect(result).toEqual({ seasonNumber: 12, episodeNumber: 24 });
  });

  it('returns null for invalid format', () => {
    expect(parseEpisodeId('Episode 1')).toBeNull();
    expect(parseEpisodeId('01-01')).toBeNull();
    expect(parseEpisodeId('')).toBeNull();
    expect(parseEpisodeId('S1E')).toBeNull();
    expect(parseEpisodeId('SE01')).toBeNull();
  });

  it('roundtrips with formatEpisodeId', () => {
    const original = { seasonNumber: 5, episodeNumber: 14 };
    const formatted = formatEpisodeId(original.seasonNumber, original.episodeNumber);
    const parsed = parseEpisodeId(formatted);
    expect(parsed).toEqual(original);
  });
});

// =============================================================================
// Adapter Interface Tests
// =============================================================================

describe('VideoMetadataAdapter interface', () => {
  it('can be implemented by a mock adapter', async () => {
    const mockAdapter: VideoMetadataAdapter = {
      name: 'mock',

      async canHandle(filePath: string): Promise<boolean> {
        return filePath.endsWith('.mp4');
      },

      async getMetadata(filePath: string): Promise<VideoMetadata | null> {
        if (filePath.includes('movie')) {
          return {
            contentType: 'movie',
            title: 'Test Movie',
            year: 2024,
          };
        }
        if (filePath.includes('tvshow')) {
          return {
            contentType: 'tvshow',
            title: 'Test Episode',
            seriesTitle: 'Test Series',
            seasonNumber: 1,
            episodeNumber: 1,
          };
        }
        return null;
      },
    };

    // Test canHandle
    expect(await mockAdapter.canHandle('/path/to/movie.mp4')).toBe(true);
    expect(await mockAdapter.canHandle('/path/to/movie.mkv')).toBe(false);

    // Test getMetadata for movie
    const movieMetadata = await mockAdapter.getMetadata('/path/to/movie.mp4');
    expect(movieMetadata).not.toBeNull();
    expect(isMovieMetadata(movieMetadata!)).toBe(true);
    expect(movieMetadata!.title).toBe('Test Movie');

    // Test getMetadata for TV show
    const tvMetadata = await mockAdapter.getMetadata('/path/to/tvshow.mp4');
    expect(tvMetadata).not.toBeNull();
    expect(isTVShowMetadata(tvMetadata!)).toBe(true);
    if (isTVShowMetadata(tvMetadata!)) {
      expect(tvMetadata.seriesTitle).toBe('Test Series');
    }

    // Test getMetadata returns null for unknown
    const unknownMetadata = await mockAdapter.getMetadata('/path/to/unknown.mp4');
    expect(unknownMetadata).toBeNull();
  });

  it('adapter name is readonly', () => {
    const adapter: VideoMetadataAdapter = {
      name: 'test-adapter',
      async canHandle() {
        return false;
      },
      async getMetadata() {
        return null;
      },
    };

    expect(adapter.name).toBe('test-adapter');
    // TypeScript will prevent: adapter.name = 'modified';
  });
});
