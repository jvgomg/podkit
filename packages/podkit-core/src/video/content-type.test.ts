/**
 * Tests for content type detection (movie vs TV show)
 */

import { describe, it, expect } from 'bun:test';
import { detectContentType } from './content-type.js';

// =============================================================================
// Episode Pattern Detection Tests
// =============================================================================

describe('detectContentType - episode patterns', () => {
  describe('S01E01 format (most common)', () => {
    it('detects S01E01 pattern', () => {
      const result = detectContentType('/Videos/Breaking.Bad.S01E01.720p.mp4');

      expect(result.type).toBe('tvshow');
      expect(result.seasonNumber).toBe(1);
      expect(result.episodeNumber).toBe(1);
      expect(result.episodeId).toBe('S01E01');
    });

    it('detects s01e01 lowercase pattern', () => {
      const result = detectContentType('/Videos/show.s05e10.mkv');

      expect(result.type).toBe('tvshow');
      expect(result.seasonNumber).toBe(5);
      expect(result.episodeNumber).toBe(10);
    });

    it('detects S1E1 single-digit pattern', () => {
      const result = detectContentType('/Videos/Show.S1E1.mp4');

      expect(result.type).toBe('tvshow');
      expect(result.seasonNumber).toBe(1);
      expect(result.episodeNumber).toBe(1);
    });

    it('detects double-digit season and episode', () => {
      const result = detectContentType('/Videos/Long.Running.Show.S12E24.mp4');

      expect(result.type).toBe('tvshow');
      expect(result.seasonNumber).toBe(12);
      expect(result.episodeNumber).toBe(24);
      expect(result.episodeId).toBe('S12E24');
    });

    it('detects triple-digit episode number', () => {
      const result = detectContentType('/Videos/Anime.S01E100.mp4');

      expect(result.type).toBe('tvshow');
      expect(result.seasonNumber).toBe(1);
      expect(result.episodeNumber).toBe(100);
    });
  });

  describe('dotted format (s01.e01)', () => {
    it('detects s01.e01 dotted pattern', () => {
      const result = detectContentType('/Videos/Show.s01.e05.mp4');

      expect(result.type).toBe('tvshow');
      expect(result.seasonNumber).toBe(1);
      expect(result.episodeNumber).toBe(5);
    });

    it('detects S1.E1 dotted pattern', () => {
      const result = detectContentType('/Videos/Show.S1.E1.mp4');

      expect(result.type).toBe('tvshow');
      expect(result.seasonNumber).toBe(1);
      expect(result.episodeNumber).toBe(1);
    });
  });

  describe('1x01 format (alternative)', () => {
    it('detects 1x01 pattern', () => {
      const result = detectContentType('/Videos/Game.of.Thrones.1x01.mkv');

      expect(result.type).toBe('tvshow');
      expect(result.seriesTitle).toBe('Game of Thrones');
      expect(result.seasonNumber).toBe(1);
      expect(result.episodeNumber).toBe(1);
    });

    it('detects 01x01 pattern', () => {
      const result = detectContentType('/Videos/Show.01x05.mp4');

      expect(result.type).toBe('tvshow');
      expect(result.seasonNumber).toBe(1);
      expect(result.episodeNumber).toBe(5);
    });

    it('detects 12x24 double-digit pattern', () => {
      const result = detectContentType('/Videos/Show.12x24.mp4');

      expect(result.type).toBe('tvshow');
      expect(result.seasonNumber).toBe(12);
      expect(result.episodeNumber).toBe(24);
    });
  });

  describe('Season X Episode Y format (verbose)', () => {
    it('detects "Season 1 Episode 1" pattern', () => {
      const result = detectContentType('/Videos/Show - Season 1 Episode 1.mp4');

      expect(result.type).toBe('tvshow');
      expect(result.seasonNumber).toBe(1);
      expect(result.episodeNumber).toBe(1);
    });

    it('detects "Season 01 Episode 05" pattern', () => {
      const result = detectContentType('/Videos/Show - Season 01 Episode 05.mp4');

      expect(result.type).toBe('tvshow');
      expect(result.seasonNumber).toBe(1);
      expect(result.episodeNumber).toBe(5);
    });

    it('detects case-insensitive season episode', () => {
      const result = detectContentType('/Videos/Show SEASON 2 EPISODE 10.mp4');

      expect(result.type).toBe('tvshow');
      expect(result.seasonNumber).toBe(2);
      expect(result.episodeNumber).toBe(10);
    });
  });
});

// =============================================================================
// Folder Structure Detection Tests
// =============================================================================

describe('detectContentType - folder patterns', () => {
  describe('TV folder patterns', () => {
    it('detects /TV Shows/ folder', () => {
      const result = detectContentType('/TV Shows/Breaking Bad/Season 1/Breaking.Bad.S01E01.mp4');

      expect(result.type).toBe('tvshow');
      expect(result.confidence).toBe('high');
    });

    it('detects /TV Show/ folder (singular)', () => {
      const result = detectContentType('/TV Show/Series/episode.S01E01.mp4');

      expect(result.type).toBe('tvshow');
      expect(result.confidence).toBe('high');
    });

    it('detects /Series/ folder', () => {
      const result = detectContentType('/Media/Series/Show/S01E01.mp4');

      expect(result.type).toBe('tvshow');
      expect(result.confidence).toBe('high');
    });

    it('detects /Television/ folder', () => {
      const result = detectContentType('/Television/Show/S01E01.mp4');

      expect(result.type).toBe('tvshow');
      expect(result.confidence).toBe('high');
    });

    it('detects /TV/ folder', () => {
      const result = detectContentType('/Media/TV/Show/S01E01.mp4');

      expect(result.type).toBe('tvshow');
      expect(result.confidence).toBe('high');
    });

    it('handles case-insensitive TV folders', () => {
      const result = detectContentType('/tv shows/show/S01E01.mp4');

      expect(result.type).toBe('tvshow');
      expect(result.confidence).toBe('high');
    });
  });

  describe('Season folder patterns', () => {
    it('detects Season 1 folder without episode pattern', () => {
      const result = detectContentType('/Videos/Breaking Bad/Season 1/episode.mp4');

      expect(result.type).toBe('tvshow');
      expect(result.confidence).toBe('medium');
      expect(result.seasonNumber).toBe(1);
    });

    it('detects Season 01 folder', () => {
      const result = detectContentType('/Videos/Show/Season 01/episode.mp4');

      expect(result.type).toBe('tvshow');
      expect(result.seasonNumber).toBe(1);
    });

    it('detects S01 folder', () => {
      const result = detectContentType('/Videos/Show/S01/episode.mp4');

      expect(result.type).toBe('tvshow');
      expect(result.seasonNumber).toBe(1);
    });

    it('extracts series title from Season folder parent', () => {
      const result = detectContentType('/Videos/Breaking Bad/Season 1/episode.mp4');

      expect(result.seriesTitle).toBe('Breaking Bad');
    });
  });
});

// =============================================================================
// Series Title Extraction Tests
// =============================================================================

describe('detectContentType - series title extraction', () => {
  it('extracts series title from parent of Season folder', () => {
    const result = detectContentType('/TV Shows/Breaking Bad/Season 1/Breaking.Bad.S01E01.720p.mp4');

    expect(result.seriesTitle).toBe('Breaking Bad');
  });

  it('extracts series title from filename before episode pattern', () => {
    const result = detectContentType('/Videos/Game.of.Thrones.S01E01.720p.mp4');

    expect(result.seriesTitle).toBe('Game of Thrones');
  });

  it('cleans quality indicators from series title', () => {
    const result = detectContentType('/Videos/Show.720p.S01E01.mp4');

    expect(result.seriesTitle).toBe('Show');
  });

  it('cleans release group from series title', () => {
    const result = detectContentType('/Videos/Show.Name.S01E01.HDTV.x264-LOL.mp4');

    expect(result.seriesTitle).toBe('Show Name');
  });

  it('handles underscores in filename', () => {
    const result = detectContentType('/Videos/Show_Name_S01E01.mp4');

    expect(result.seriesTitle).toBe('Show Name');
  });

  it('handles dots as separators', () => {
    const result = detectContentType('/Videos/The.Walking.Dead.S01E01.mp4');

    expect(result.seriesTitle).toBe('The Walking Dead');
  });

  it('cleans bracket content from series title', () => {
    const result = detectContentType('/Videos/Show.Name.[720p].S01E01.mp4');

    expect(result.seriesTitle).toBe('Show Name');
  });
});

// =============================================================================
// Confidence Level Tests
// =============================================================================

describe('detectContentType - confidence levels', () => {
  it('returns high confidence when episode pattern AND TV folder', () => {
    const result = detectContentType('/TV Shows/Breaking Bad/Season 1/Breaking.Bad.S01E01.mp4');

    expect(result.confidence).toBe('high');
  });

  it('returns high confidence when episode pattern AND Season folder', () => {
    const result = detectContentType('/Videos/Show/Season 1/Show.S01E01.mp4');

    expect(result.confidence).toBe('high');
  });

  it('returns medium confidence when only episode pattern', () => {
    const result = detectContentType('/Videos/Show.S01E01.mp4');

    expect(result.confidence).toBe('medium');
  });

  it('returns medium confidence when only TV folder (no episode pattern)', () => {
    const result = detectContentType('/TV Shows/Show/random_episode.mp4');

    expect(result.confidence).toBe('medium');
  });

  it('returns medium confidence when only Season folder (no episode pattern)', () => {
    const result = detectContentType('/Videos/Show/Season 1/episode.mp4');

    expect(result.confidence).toBe('medium');
  });

  it('returns low confidence for movie fallback', () => {
    const result = detectContentType('/Movies/Inception (2010).mp4');

    expect(result.type).toBe('movie');
    expect(result.confidence).toBe('low');
  });
});

// =============================================================================
// Metadata Override Tests
// =============================================================================

describe('detectContentType - metadata override', () => {
  it('uses explicit contentType from metadata with high confidence', () => {
    const result = detectContentType('/Videos/random_video.mp4', {
      contentType: 'tvshow',
      title: 'Episode',
    });

    expect(result.type).toBe('tvshow');
    expect(result.confidence).toBe('high');
  });

  it('returns movie with high confidence when metadata says movie', () => {
    const result = detectContentType('/Videos/random_video.mp4', {
      contentType: 'movie',
      title: 'Some Movie',
    });

    expect(result.type).toBe('movie');
    expect(result.confidence).toBe('high');
  });

  it('extracts TV details from metadata when contentType is tvshow', () => {
    const result = detectContentType('/Videos/video.mp4', {
      contentType: 'tvshow',
      title: 'Pilot',
      seriesTitle: 'Breaking Bad',
      seasonNumber: 1,
      episodeNumber: 1,
    } as any);

    expect(result.type).toBe('tvshow');
    expect(result.seriesTitle).toBe('Breaking Bad');
    expect(result.seasonNumber).toBe(1);
    expect(result.episodeNumber).toBe(1);
    expect(result.episodeId).toBe('S01E01');
  });

  it('generates episodeId from season/episode when not provided', () => {
    const result = detectContentType('/Videos/video.mp4', {
      contentType: 'tvshow',
      seriesTitle: 'Show',
      seasonNumber: 5,
      episodeNumber: 14,
    } as any);

    expect(result.episodeId).toBe('S05E14');
  });

  it('uses provided episodeId when present', () => {
    const result = detectContentType('/Videos/video.mp4', {
      contentType: 'tvshow',
      seriesTitle: 'Show',
      seasonNumber: 1,
      episodeNumber: 1,
      episodeId: 'S01E01-02',
    } as any);

    expect(result.episodeId).toBe('S01E01-02');
  });

  it('detects TV show from metadata without explicit contentType', () => {
    const result = detectContentType('/Videos/video.mp4', {
      title: 'Episode',
      seriesTitle: 'Some Show',
      seasonNumber: 2,
      episodeNumber: 5,
    } as any);

    expect(result.type).toBe('tvshow');
    expect(result.confidence).toBe('high');
    expect(result.seriesTitle).toBe('Some Show');
    expect(result.seasonNumber).toBe(2);
    expect(result.episodeNumber).toBe(5);
  });

  it('detects TV show when only seriesTitle in metadata', () => {
    const result = detectContentType('/Videos/video.mp4', {
      title: 'Episode',
      seriesTitle: 'Some Show',
    } as any);

    expect(result.type).toBe('tvshow');
    expect(result.confidence).toBe('high');
    expect(result.seriesTitle).toBe('Some Show');
  });
});

// =============================================================================
// Fallback to Movie Tests
// =============================================================================

describe('detectContentType - movie fallback', () => {
  it('falls back to movie for generic path', () => {
    const result = detectContentType('/Videos/random_video.mp4');

    expect(result.type).toBe('movie');
    expect(result.confidence).toBe('low');
  });

  it('falls back to movie for Movies folder', () => {
    const result = detectContentType('/Movies/Inception (2010).mp4');

    expect(result.type).toBe('movie');
    expect(result.confidence).toBe('low');
  });

  it('falls back to movie when no TV indicators', () => {
    const result = detectContentType('/Media/Action/The Matrix.mp4');

    expect(result.type).toBe('movie');
    expect(result.confidence).toBe('low');
  });

  it('does not have TV show properties for movies', () => {
    const result = detectContentType('/Movies/Inception.mp4');

    expect(result.type).toBe('movie');
    expect(result.seriesTitle).toBeUndefined();
    expect(result.seasonNumber).toBeUndefined();
    expect(result.episodeNumber).toBeUndefined();
    expect(result.episodeId).toBeUndefined();
  });
});

// =============================================================================
// Real-World Example Tests
// =============================================================================

describe('detectContentType - real-world examples', () => {
  it('handles typical scene release naming', () => {
    const result = detectContentType('/TV Shows/Breaking Bad/Season 1/Breaking.Bad.S01E01.720p.BluRay.x264-DEMAND.mkv');

    expect(result.type).toBe('tvshow');
    expect(result.confidence).toBe('high');
    expect(result.seriesTitle).toBe('Breaking Bad');
    expect(result.seasonNumber).toBe(1);
    expect(result.episodeNumber).toBe(1);
    expect(result.episodeId).toBe('S01E01');
  });

  it('handles Game of Thrones 1x01 format', () => {
    const result = detectContentType('/Videos/Game.of.Thrones.1x01.mkv');

    expect(result.type).toBe('tvshow');
    expect(result.confidence).toBe('medium');
    expect(result.seriesTitle).toBe('Game of Thrones');
    expect(result.seasonNumber).toBe(1);
    expect(result.episodeNumber).toBe(1);
  });

  it('handles movie in Movies folder', () => {
    const result = detectContentType('/Movies/Inception (2010).mp4');

    expect(result.type).toBe('movie');
    expect(result.confidence).toBe('low');
  });

  it('handles random video file', () => {
    const result = detectContentType('/Videos/random_video.mp4');

    expect(result.type).toBe('movie');
    expect(result.confidence).toBe('low');
  });

  it('handles Netflix-style naming', () => {
    const result = detectContentType('/TV Shows/Stranger Things/Season 01/Stranger Things - S01E01 - Chapter One.mp4');

    expect(result.type).toBe('tvshow');
    expect(result.confidence).toBe('high');
    expect(result.seriesTitle).toBe('Stranger Things');
    expect(result.seasonNumber).toBe(1);
    expect(result.episodeNumber).toBe(1);
  });

  it('handles Plex-style naming', () => {
    const result = detectContentType('/TV/The Office (US)/Season 01/The Office (US) - s01e01 - Pilot.mp4');

    expect(result.type).toBe('tvshow');
    expect(result.confidence).toBe('high');
    expect(result.seriesTitle).toBe('The Office (US)');
    expect(result.seasonNumber).toBe(1);
    expect(result.episodeNumber).toBe(1);
  });

  it('handles anime with triple-digit episodes', () => {
    const result = detectContentType('/TV Shows/Naruto/Season 01/Naruto.S01E156.720p.mkv');

    expect(result.type).toBe('tvshow');
    expect(result.seasonNumber).toBe(1);
    expect(result.episodeNumber).toBe(156);
  });

  it('handles web-dl format', () => {
    const result = detectContentType('/Series/The Mandalorian/Season 02/The.Mandalorian.S02E01.WEB-DL.1080p.mkv');

    expect(result.type).toBe('tvshow');
    expect(result.confidence).toBe('high');
    expect(result.seriesTitle).toBe('The Mandalorian');
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('detectContentType - edge cases', () => {
  it('handles Windows-style paths', () => {
    const result = detectContentType('C:\\TV Shows\\Breaking Bad\\Season 1\\S01E01.mp4');

    expect(result.type).toBe('tvshow');
    // Note: path handling may vary by platform
  });

  it('handles empty filename before pattern', () => {
    const result = detectContentType('/TV Shows/Show/Season 1/S01E01.mp4');

    expect(result.type).toBe('tvshow');
    expect(result.seriesTitle).toBe('Show');
  });

  it('handles multiple episode patterns (uses first match)', () => {
    const result = detectContentType('/Videos/Show.S01E01.S02E02.mp4');

    expect(result.seasonNumber).toBe(1);
    expect(result.episodeNumber).toBe(1);
  });

  it('handles year that looks like episode number', () => {
    // 2024 should not be parsed as season 20 episode 24
    const result = detectContentType('/Movies/Movie.2024.mp4');

    expect(result.type).toBe('movie');
  });

  it('handles very long paths', () => {
    const longPath = '/Media/TV Shows/A Very Long Show Name That Goes On And On/Season 1/' +
      'A.Very.Long.Show.Name.That.Goes.On.And.On.S01E01.The.Episode.Title.720p.BluRay.x264-GROUP.mkv';

    const result = detectContentType(longPath);

    expect(result.type).toBe('tvshow');
    expect(result.seasonNumber).toBe(1);
    expect(result.episodeNumber).toBe(1);
  });
});
