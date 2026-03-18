/**
 * Tests for the show language video transform
 */

import { describe, it, expect } from 'bun:test';
import { applyShowLanguage, parseLanguageMarker } from './video-show-language.js';
import type { ShowLanguageConfig, VideoTransformableTrack } from './types.js';
import { DEFAULT_SHOW_LANGUAGE_CONFIG } from './types.js';

// =============================================================================
// parseLanguageMarker Tests
// =============================================================================

describe('parseLanguageMarker', () => {
  it('parses 3-letter code in parentheses', () => {
    const result = parseLanguageMarker('Digimon Adventure (JPN)');

    expect(result).not.toBeNull();
    expect(result!.baseTitle).toBe('Digimon Adventure');
    expect(result!.language).toBe('JPN');
    expect(result!.isFullName).toBe(false);
  });

  it('parses full language name in parentheses', () => {
    const result = parseLanguageMarker('Digimon Adventure (Japanese)');

    expect(result).not.toBeNull();
    expect(result!.baseTitle).toBe('Digimon Adventure');
    expect(result!.language).toBe('Japanese');
    expect(result!.isFullName).toBe(true);
  });

  it('parses 3-letter code in brackets', () => {
    const result = parseLanguageMarker('Show Name [ENG]');

    expect(result).not.toBeNull();
    expect(result!.baseTitle).toBe('Show Name');
    expect(result!.language).toBe('ENG');
    expect(result!.isFullName).toBe(false);
  });

  it('parses compound marker like "USA Dub"', () => {
    const result = parseLanguageMarker('Digimon Digital Monsters (USA Dub)');

    expect(result).not.toBeNull();
    expect(result!.baseTitle).toBe('Digimon Digital Monsters');
    expect(result!.language).toBe('USA Dub');
  });

  it('returns null for title without language marker', () => {
    const result = parseLanguageMarker('Breaking Bad');
    expect(result).toBeNull();
  });

  it('returns null for year in parentheses', () => {
    const result = parseLanguageMarker('The Matrix (1999)');
    // "1999" is not a known language code
    expect(result).toBeNull();
  });

  it('returns null for unknown code', () => {
    const result = parseLanguageMarker('Show (XYZ)');
    expect(result).toBeNull();
  });

  it('parses CHN code', () => {
    const result = parseLanguageMarker('Digimon Adventure (CHN)');

    expect(result).not.toBeNull();
    expect(result!.baseTitle).toBe('Digimon Adventure');
    expect(result!.language).toBe('CHN');
  });

  it('parses [JPN] bracket-style marker', () => {
    const result = parseLanguageMarker('Show Name [JPN]');
    expect(result).not.toBeNull();
    expect(result!.baseTitle).toBe('Show Name');
    expect(result!.language).toBe('JPN');
  });
});

// =============================================================================
// applyShowLanguage Tests
// =============================================================================

describe('applyShowLanguage', () => {
  const makeTrack = (seriesTitle?: string): VideoTransformableTrack => ({
    title: 'Episode 1',
    seriesTitle,
  });

  describe('bracket-style markers', () => {
    it('applies transform to bracket-style marker', () => {
      const track = makeTrack('Show Name [JPN]');
      const result = applyShowLanguage(track, { enabled: true, format: '({})', expand: false });
      expect(result.seriesTitle).toBe('Show Name (JPN)');
    });
  });

  describe('year not confused with language', () => {
    it('does not parse year as language marker', () => {
      const track = makeTrack('The Matrix (1999)');
      const result = applyShowLanguage(track, { enabled: true, format: '({})', expand: true });
      // Should return same object (no language marker found)
      expect(result).toBe(track);
    });
  });

  describe('enabled with default config', () => {
    it('preserves JPN marker with default format', () => {
      const track = makeTrack('Digimon Adventure (JPN)');
      const result = applyShowLanguage(track, DEFAULT_SHOW_LANGUAGE_CONFIG);

      // Default format is "({})", so (JPN) → (JPN) — no change
      expect(result).toBe(track); // Same object (no change)
    });

    it('returns same object when no language marker found', () => {
      const track = makeTrack('Breaking Bad');
      const result = applyShowLanguage(track, DEFAULT_SHOW_LANGUAGE_CONFIG);

      expect(result).toBe(track);
    });

    it('returns same object when no seriesTitle', () => {
      const track = makeTrack(undefined);
      const result = applyShowLanguage(track, DEFAULT_SHOW_LANGUAGE_CONFIG);

      expect(result).toBe(track);
    });
  });

  describe('enabled with expand', () => {
    const expandConfig: ShowLanguageConfig = {
      enabled: true,
      format: '({})',
      expand: true,
    };

    it('expands JPN to Japanese', () => {
      const track = makeTrack('Digimon Adventure (JPN)');
      const result = applyShowLanguage(track, expandConfig);

      expect(result.seriesTitle).toBe('Digimon Adventure (Japanese)');
    });

    it('expands CHN to Chinese', () => {
      const track = makeTrack('Digimon Adventure (CHN)');
      const result = applyShowLanguage(track, expandConfig);

      expect(result.seriesTitle).toBe('Digimon Adventure (Chinese)');
    });

    it('expands compound marker code part', () => {
      const track = makeTrack('Show (USA Dub)');
      const result = applyShowLanguage(track, expandConfig);

      expect(result.seriesTitle).toBe('Show (American Dub)');
    });
  });

  describe('enabled with custom format', () => {
    it('applies custom format string', () => {
      const config: ShowLanguageConfig = {
        enabled: true,
        format: '[{}]',
        expand: false,
      };
      const track = makeTrack('Digimon Adventure (JPN)');
      const result = applyShowLanguage(track, config);

      expect(result.seriesTitle).toBe('Digimon Adventure [JPN]');
    });

    it('applies format with text', () => {
      const config: ShowLanguageConfig = {
        enabled: true,
        format: '- {} Dub',
        expand: false,
      };
      const track = makeTrack('Digimon Adventure (JPN)');
      const result = applyShowLanguage(track, config);

      expect(result.seriesTitle).toBe('Digimon Adventure - JPN Dub');
    });
  });

  describe('disabled', () => {
    const disabledConfig: ShowLanguageConfig = {
      enabled: false,
      format: '({})',
      expand: false,
    };

    it('strips language marker when disabled', () => {
      const track = makeTrack('Digimon Adventure (JPN)');
      const result = applyShowLanguage(track, disabledConfig);

      expect(result.seriesTitle).toBe('Digimon Adventure');
    });

    it('strips full name marker when disabled', () => {
      const track = makeTrack('Show (Japanese)');
      const result = applyShowLanguage(track, disabledConfig);

      expect(result.seriesTitle).toBe('Show');
    });

    it('returns same object when no marker to strip', () => {
      const track = makeTrack('Breaking Bad');
      const result = applyShowLanguage(track, disabledConfig);

      expect(result).toBe(track);
    });
  });

  describe('contraction (expand=false with full name input)', () => {
    it('contracts Japanese to JPN when expand is false', () => {
      const config: ShowLanguageConfig = {
        enabled: true,
        format: '({})',
        expand: false,
      };
      const track = makeTrack('Digimon Adventure (Japanese)');
      const result = applyShowLanguage(track, config);

      expect(result.seriesTitle).toBe('Digimon Adventure (JPN)');
    });
  });

  describe('idempotency', () => {
    it('applying twice gives same result as once', () => {
      const config: ShowLanguageConfig = {
        enabled: true,
        format: '({})',
        expand: true,
      };
      const track = makeTrack('Digimon Adventure (JPN)');
      const once = applyShowLanguage(track, config);
      const twice = applyShowLanguage(once, config);

      expect(twice.seriesTitle).toBe(once.seriesTitle);
    });
  });
});
