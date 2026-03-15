/**
 * Unit tests for transform pipeline
 */

import { describe, expect, it } from 'bun:test';
import { applyTransforms, hasEnabledTransforms, getEnabledTransformsSummary } from './pipeline.js';
import type { TransformableTrack, TransformsConfig } from './types.js';
import { DEFAULT_TRANSFORMS_CONFIG } from './types.js';

// =============================================================================
// Test Fixtures
// =============================================================================

function createTrack(artist: string, title: string): TransformableTrack {
  return { artist, title, album: 'Test Album' };
}

// =============================================================================
// applyTransforms tests
// =============================================================================

describe('applyTransforms', () => {
  describe('with no transforms enabled', () => {
    it('returns original track unchanged', () => {
      const track = createTrack('Artist A feat. Artist B', 'Song Name');
      const config: TransformsConfig = {
        cleanArtists: { enabled: false, drop: false, format: 'feat. {}', ignore: [] },
      };

      const result = applyTransforms(track, config);

      expect(result.original).toBe(track);
      expect(result.transformed).toBe(track);
      expect(result.applied).toBe(false);
    });

    it('uses default config when not provided', () => {
      const track = createTrack('Artist A feat. Artist B', 'Song Name');

      const result = applyTransforms(track);

      // Default config has cleanArtists disabled
      expect(result.applied).toBe(false);
      expect(result.transformed).toBe(track);
    });
  });

  describe('with cleanArtists enabled', () => {
    const enabledConfig: TransformsConfig = {
      cleanArtists: { enabled: true, drop: false, format: 'feat. {}', ignore: [] },
    };

    it('transforms track with featuring info', () => {
      const track = createTrack('Artist A feat. Artist B', 'Song Name');

      const result = applyTransforms(track, enabledConfig);

      expect(result.original).toBe(track);
      expect(result.transformed.artist).toBe('Artist A');
      expect(result.transformed.title).toBe('Song Name (feat. Artist B)');
      expect(result.applied).toBe(true);
    });

    it('preserves album field', () => {
      const track = createTrack('Artist A feat. Artist B', 'Song Name');

      const result = applyTransforms(track, enabledConfig);

      expect(result.transformed.album).toBe('Test Album');
    });

    it('reports not applied when no changes needed', () => {
      const track = createTrack('Artist A', 'Song Name');

      const result = applyTransforms(track, enabledConfig);

      expect(result.applied).toBe(false);
      expect(result.transformed).toBe(track);
    });
  });

  describe('with drop mode', () => {
    const dropConfig: TransformsConfig = {
      cleanArtists: { enabled: true, drop: true, format: 'feat. {}', ignore: [] },
    };

    it('drops featuring info without adding to title', () => {
      const track = createTrack('Artist A feat. Artist B', 'Song Name');

      const result = applyTransforms(track, dropConfig);

      expect(result.transformed.artist).toBe('Artist A');
      expect(result.transformed.title).toBe('Song Name');
      expect(result.applied).toBe(true);
    });
  });

  describe('type preservation', () => {
    it('preserves extended track properties', () => {
      interface ExtendedTrack extends TransformableTrack {
        customField: string;
        duration: number;
      }

      const track: ExtendedTrack = {
        artist: 'Artist A feat. Artist B',
        title: 'Song Name',
        album: 'Test Album',
        customField: 'custom value',
        duration: 180000,
      };

      const config: TransformsConfig = {
        cleanArtists: { enabled: true, drop: false, format: 'feat. {}', ignore: [] },
      };

      const result = applyTransforms(track, config);

      // Extended properties should be preserved
      expect((result.transformed as ExtendedTrack).customField).toBe('custom value');
      expect((result.transformed as ExtendedTrack).duration).toBe(180000);
    });
  });
});

// =============================================================================
// hasEnabledTransforms tests
// =============================================================================

describe('hasEnabledTransforms', () => {
  it('returns false when no transforms enabled', () => {
    const config: TransformsConfig = {
      cleanArtists: { enabled: false, drop: false, format: 'feat. {}', ignore: [] },
    };

    expect(hasEnabledTransforms(config)).toBe(false);
  });

  it('returns true when cleanArtists enabled', () => {
    const config: TransformsConfig = {
      cleanArtists: { enabled: true, drop: false, format: 'feat. {}', ignore: [] },
    };

    expect(hasEnabledTransforms(config)).toBe(true);
  });

  it('returns false for default config', () => {
    expect(hasEnabledTransforms(DEFAULT_TRANSFORMS_CONFIG)).toBe(false);
  });
});

// =============================================================================
// getEnabledTransformsSummary tests
// =============================================================================

describe('getEnabledTransformsSummary', () => {
  it('returns empty array when no transforms enabled', () => {
    const config: TransformsConfig = {
      cleanArtists: { enabled: false, drop: false, format: 'feat. {}', ignore: [] },
    };

    const summary = getEnabledTransformsSummary(config);

    expect(summary).toEqual([]);
  });

  it('returns cleanArtists summary when enabled', () => {
    const config: TransformsConfig = {
      cleanArtists: { enabled: true, drop: false, format: 'feat. {}', ignore: [] },
    };

    const summary = getEnabledTransformsSummary(config);

    expect(summary).toHaveLength(1);
    const first = summary[0]!;
    expect(first.name).toBe('cleanArtists');
    expect(first.description).toContain('feat. {}');
  });

  it('describes drop mode', () => {
    const config: TransformsConfig = {
      cleanArtists: { enabled: true, drop: true, format: 'feat. {}', ignore: [] },
    };

    const summary = getEnabledTransformsSummary(config);

    expect(summary).toHaveLength(1);
    expect(summary[0]!.description).toContain('drop');
  });

  it('shows custom format in description', () => {
    const config: TransformsConfig = {
      cleanArtists: { enabled: true, drop: false, format: 'with {}', ignore: [] },
    };

    const summary = getEnabledTransformsSummary(config);

    expect(summary).toHaveLength(1);
    expect(summary[0]!.description).toContain('with {}');
  });
});
