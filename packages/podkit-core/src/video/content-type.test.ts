/**
 * Tests for content type detection (movie vs TV show)
 */

import { describe, it, expect } from 'bun:test';
import { detectContentType, extractLanguageAndEdition } from './content-type.js';

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
    const result = detectContentType(
      '/TV Shows/Breaking Bad/Season 1/Breaking.Bad.S01E01.720p.mp4'
    );

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

  it('returns medium confidence for movie fallback when title is parseable', () => {
    const result = detectContentType('/Movies/Inception (2010).mp4');

    expect(result.type).toBe('movie');
    // Medium confidence because library can extract title from filename
    expect(result.confidence).toBe('medium');
    expect(result.parsedTitle).toBe('Inception');
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
  it('detects movie with parsed title from generic path', () => {
    const result = detectContentType('/Videos/random_video.mp4');

    expect(result.type).toBe('movie');
    // Medium confidence because library can extract title
    expect(result.confidence).toBe('medium');
    expect(result.parsedTitle).toBe('Random Video');
  });

  it('detects movie with parsed title from Movies folder', () => {
    const result = detectContentType('/Movies/Inception (2010).mp4');

    expect(result.type).toBe('movie');
    expect(result.confidence).toBe('medium');
    expect(result.parsedTitle).toBe('Inception');
  });

  it('detects movie when no TV indicators', () => {
    const result = detectContentType('/Media/Action/The Matrix.mp4');

    expect(result.type).toBe('movie');
    expect(result.confidence).toBe('medium');
    expect(result.parsedTitle).toBe('The Matrix');
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
    const result = detectContentType(
      '/TV Shows/Breaking Bad/Season 1/Breaking.Bad.S01E01.720p.BluRay.x264-DEMAND.mkv'
    );

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
    // Medium confidence due to title parsing
    expect(result.confidence).toBe('medium');
    expect(result.parsedTitle).toBe('Inception');
  });

  it('handles random video file', () => {
    const result = detectContentType('/Videos/random_video.mp4');

    expect(result.type).toBe('movie');
    // Medium confidence due to title parsing
    expect(result.confidence).toBe('medium');
  });

  it('handles Netflix-style naming', () => {
    const result = detectContentType(
      '/TV Shows/Stranger Things/Season 01/Stranger Things - S01E01 - Chapter One.mp4'
    );

    expect(result.type).toBe('tvshow');
    expect(result.confidence).toBe('high');
    expect(result.seriesTitle).toBe('Stranger Things');
    expect(result.seasonNumber).toBe(1);
    expect(result.episodeNumber).toBe(1);
  });

  it('handles Plex-style naming', () => {
    const result = detectContentType(
      '/TV/The Office (US)/Season 01/The Office (US) - s01e01 - Pilot.mp4'
    );

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
    const result = detectContentType(
      '/Series/The Mandalorian/Season 02/The.Mandalorian.S02E01.WEB-DL.1080p.mkv'
    );

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
    const longPath =
      '/Media/TV Shows/A Very Long Show Name That Goes On And On/Season 1/' +
      'A.Very.Long.Show.Name.That.Goes.On.And.On.S01E01.The.Episode.Title.720p.BluRay.x264-GROUP.mkv';

    const result = detectContentType(longPath);

    expect(result.type).toBe('tvshow');
    expect(result.seasonNumber).toBe(1);
    expect(result.episodeNumber).toBe(1);
  });
});

// =============================================================================
// Scene Release Parsing Tests (using @ctrl/video-filename-parser)
// =============================================================================

describe('detectContentType - scene release parsing', () => {
  describe('movie scene releases', () => {
    it('parses standard scene release format with title and year', () => {
      const result = detectContentType('/Movies/Movie.Name.2024.1080p.BluRay.x264-GROUP.mkv');

      expect(result.type).toBe('movie');
      expect(result.confidence).toBe('medium');
      expect(result.parsedTitle).toBe('Movie Name');
      expect(result.parsedYear).toBe(2024);
    });

    it('parses The Matrix remastered release', () => {
      const result = detectContentType('/Movies/The.Matrix.1999.REMASTERED.1080p.BluRay.mkv');

      expect(result.type).toBe('movie');
      expect(result.confidence).toBe('medium');
      expect(result.parsedTitle).toBe('The Matrix');
      expect(result.parsedYear).toBe(1999);
    });

    it('parses minimal filename', () => {
      const result = detectContentType('/Movies/inception.mkv');

      expect(result.type).toBe('movie');
      expect(result.parsedTitle).toBe('Inception');
    });

    it('parses movie with special characters', () => {
      const result = detectContentType('/Movies/Spider-Man.No.Way.Home.2021.1080p.WEB-DL.mkv');

      expect(result.type).toBe('movie');
      expect(result.parsedTitle).toBe('Spider-Man No Way Home');
      expect(result.parsedYear).toBe(2021);
    });

    it('parses movie with dots as separators', () => {
      const result = detectContentType('/Videos/Blade.Runner.2049.2017.mkv');

      expect(result.type).toBe('movie');
      expect(result.parsedTitle).toBe('Blade Runner 2049');
      expect(result.parsedYear).toBe(2017);
    });
  });

  describe('confidence levels with scene releases', () => {
    it('returns medium confidence when library extracts valid data', () => {
      const result = detectContentType('/Videos/Some.Movie.2020.1080p.mkv');

      expect(result.type).toBe('movie');
      expect(result.confidence).toBe('medium');
    });

    it('returns medium confidence when library extracts title', () => {
      // Even simple filenames get medium confidence when title can be extracted
      const result = detectContentType('/Videos/random_video.mp4');

      expect(result.type).toBe('movie');
      expect(result.confidence).toBe('medium');
      expect(result.parsedTitle).toBe('Random Video');
    });
  });
});

// =============================================================================
// Anime Fansub Pattern Tests
// =============================================================================

describe('detectContentType - anime fansub filenames', () => {
  it('detects [RyRo] fansub naming with codec and CRC', () => {
    const result = detectContentType('/Anime/[RyRo]_Digimon_Adventure_15_(h264)_[8FBCA82D].mkv');

    expect(result.type).toBe('tvshow');
    expect(result.seriesTitle).toBe('Digimon Adventure');
    expect(result.seasonNumber).toBe(1);
    expect(result.episodeNumber).toBe(15);
    expect(result.episodeId).toBe('S01E15');
  });

  it('detects fansub naming with spaces and dash separator', () => {
    const result = detectContentType('/Anime/[SubGroup] Show Name - 03 [ABCD1234].mkv');

    expect(result.type).toBe('tvshow');
    expect(result.seriesTitle).toBe('Show Name');
    expect(result.episodeNumber).toBe(3);
  });

  it('detects fansub naming with version suffix', () => {
    const result = detectContentType('/Anime/[Group] Show Name - 01v2.mkv');

    expect(result.type).toBe('tvshow');
    expect(result.seriesTitle).toBe('Show Name');
    expect(result.episodeNumber).toBe(1);
  });

  it('detects fansub naming with triple-digit episode', () => {
    const result = detectContentType('/Anime/[Group]_Long_Show_Name_-_100_(1080p)_[DEADBEEF].mkv');

    expect(result.type).toBe('tvshow');
    expect(result.seriesTitle).toBe('Long Show Name');
    expect(result.episodeNumber).toBe(100);
  });

  it('detects fansub naming with underscore dash separator', () => {
    const result = detectContentType('/Anime/[Fansub]_Show_Name_-_07_(720p)_[AABBCCDD].mkv');

    expect(result.type).toBe('tvshow');
    expect(result.seriesTitle).toBe('Show Name');
    expect(result.episodeNumber).toBe(7);
  });

  it('defaults season to 1 for fansub files', () => {
    const result = detectContentType('/Anime/[RyRo]_Digimon_Adventure_26_(h264)_[9ADB780A].mkv');

    expect(result.seasonNumber).toBe(1);
  });
});

// =============================================================================
// Folder-Based Series Title Priority Tests
// =============================================================================

describe('detectContentType - folder-based series title', () => {
  it('extracts series title from scene release folder name', () => {
    const result = detectContentType(
      '/Media/Digimon.Digital.Monsters.S01E01-54.DUBBED.DVDRip.XviD-DEiMOS/Digimon.S01E01.DVDRip.XviD-DEiMOS.avi'
    );

    expect(result.type).toBe('tvshow');
    expect(result.seriesTitle).toBe('Digimon Digital Monsters');
  });

  it('still extracts from filename when parent is a generic folder', () => {
    // /Videos/ is a generic folder, so fall through to library parser
    const result = detectContentType('/Videos/Game.of.Thrones.S01E01.720p.mp4');

    expect(result.seriesTitle).toBe('Game of Thrones');
  });

  it('preserves language marker in folder-derived series title', () => {
    const result = detectContentType(
      '/Media/Digimon Adventure (JPN)/Season 01/Digimon Adventure - S01E01.mkv'
    );

    expect(result.type).toBe('tvshow');
    expect(result.seriesTitle).toBe('Digimon Adventure (JPN)');
  });

  it('preserves CHN marker in folder-derived series title', () => {
    const result = detectContentType(
      '/Media/Digimon Adventure (CHN)/Season 01/Digimon Adventure - S01E01.mp4'
    );

    expect(result.type).toBe('tvshow');
    expect(result.seriesTitle).toBe('Digimon Adventure (CHN)');
  });

  it('prefers Season folder parent over parent folder', () => {
    const result = detectContentType('/Media/Breaking Bad/Season 1/Breaking.Bad.S01E01.720p.mp4');

    expect(result.seriesTitle).toBe('Breaking Bad');
  });
});

// =============================================================================
// Language & Edition Detection Tests
// =============================================================================

describe('detectContentType - language and edition detection', () => {
  it('detects language from folder name', () => {
    const result = detectContentType(
      '/Media/Digimon Adventure Chinese/Season 01/Digimon Adventure - S01E01.mp4'
    );

    expect(result.language).toBe('Chinese');
  });

  it('detects DUBBED edition from filename', () => {
    const result = detectContentType('/Media/Show.S01E01.DUBBED.DVDRip.mp4');

    expect(result.edition).toBe('Dubbed');
  });

  it('detects JPN language from filename', () => {
    const result = detectContentType('/Media/Show.JPN.S01E01.mkv');

    expect(result.language).toBe('Japanese');
  });

  it('detects language from folder path', () => {
    const result = detectContentType('/Media/Show (JPN)/Season 01/Show - S01E01.mkv');

    expect(result.language).toBe('Japanese');
  });

  it('detects both language and edition', () => {
    const result = detectContentType('/Media/Show.S01E01.DUBBED.JPN.mkv');

    expect(result.language).toBe('Japanese');
    expect(result.edition).toBe('Dubbed');
  });
});

describe('extractLanguageAndEdition', () => {
  it('detects Chinese from folder name', () => {
    const result = extractLanguageAndEdition(
      '/Media/Digimon Adventure Chinese/Season 01/Episode.mp4'
    );

    expect(result.language).toBe('Chinese');
  });

  it('detects DUBBED edition', () => {
    const result = extractLanguageAndEdition('/Media/Show.DUBBED.S01E01.avi');

    expect(result.edition).toBe('Dubbed');
  });

  it('detects REMASTERED edition', () => {
    const result = extractLanguageAndEdition('/Media/Movie.REMASTERED.2020.mp4');

    expect(result.edition).toBe('Remastered');
  });

  it('returns empty when no tags found', () => {
    const result = extractLanguageAndEdition('/Media/Regular Movie.mp4');

    expect(result.language).toBeUndefined();
    expect(result.edition).toBeUndefined();
  });
});
