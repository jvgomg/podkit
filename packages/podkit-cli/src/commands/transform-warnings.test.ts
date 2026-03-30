import { describe, expect, it } from 'bun:test';
import type { TransformsConfig } from '@podkit/core';
import { resolveCleanArtistsTransform, computeTransformWarnings } from './transform-warnings.js';

function makeTransforms(enabled: boolean): TransformsConfig {
  return {
    cleanArtists: {
      enabled,
      drop: false,
      format: 'feat. {}',
      ignore: [],
    },
  };
}

describe('resolveCleanArtistsTransform', () => {
  describe('per-device explicit override (rule 1)', () => {
    it('returns explicitly-enabled when device enables cleanArtists', () => {
      const result = resolveCleanArtistsTransform(makeTransforms(true), true, true);
      expect(result.reason).toBe('explicitly-enabled');
      expect(result.transforms.cleanArtists.enabled).toBe(true);
    });

    it('returns explicitly-disabled when device disables cleanArtists', () => {
      const result = resolveCleanArtistsTransform(makeTransforms(false), true, true);
      expect(result.reason).toBe('explicitly-disabled');
      expect(result.transforms.cleanArtists.enabled).toBe(false);
    });

    it('per-device disable takes priority even when capability is false', () => {
      const result = resolveCleanArtistsTransform(makeTransforms(false), false, true);
      expect(result.reason).toBe('explicitly-disabled');
      expect(result.transforms.cleanArtists.enabled).toBe(false);
    });
  });

  describe('global disabled (rule 4)', () => {
    it('returns globally-disabled when global is off', () => {
      const result = resolveCleanArtistsTransform(makeTransforms(false), false, false);
      expect(result.reason).toBe('globally-disabled');
      expect(result.transforms.cleanArtists.enabled).toBe(false);
    });

    it('returns globally-disabled regardless of capability', () => {
      const result = resolveCleanArtistsTransform(makeTransforms(false), true, false);
      expect(result.reason).toBe('globally-disabled');
      expect(result.transforms.cleanArtists.enabled).toBe(false);
    });

    it('returns globally-disabled when capability is undefined', () => {
      const result = resolveCleanArtistsTransform(makeTransforms(false), undefined, false);
      expect(result.reason).toBe('globally-disabled');
      expect(result.transforms.cleanArtists.enabled).toBe(false);
    });
  });

  describe('auto-suppress (rule 3)', () => {
    it('auto-suppresses when global enabled and device supports Album Artist', () => {
      const result = resolveCleanArtistsTransform(makeTransforms(true), true, false);
      expect(result.reason).toBe('auto-suppressed');
      expect(result.transforms.cleanArtists.enabled).toBe(false);
    });

    it('preserves other cleanArtists config when suppressing', () => {
      const transforms: TransformsConfig = {
        cleanArtists: {
          enabled: true,
          drop: true,
          format: 'ft. {}',
          ignore: ['Simon & Garfunkel'],
        },
      };
      const result = resolveCleanArtistsTransform(transforms, true, false);
      expect(result.transforms.cleanArtists.enabled).toBe(false);
      expect(result.transforms.cleanArtists.drop).toBe(true);
      expect(result.transforms.cleanArtists.format).toBe('ft. {}');
      expect(result.transforms.cleanArtists.ignore).toEqual(['Simon & Garfunkel']);
    });
  });

  describe('auto-enable (rule 2)', () => {
    it('auto-enables when global enabled and device does not support Album Artist', () => {
      const result = resolveCleanArtistsTransform(makeTransforms(true), false, false);
      expect(result.reason).toBe('auto-enabled');
      expect(result.transforms.cleanArtists.enabled).toBe(true);
    });

    it('auto-enables when capability is undefined (no capability info)', () => {
      const result = resolveCleanArtistsTransform(makeTransforms(true), undefined, false);
      expect(result.reason).toBe('auto-enabled');
      expect(result.transforms.cleanArtists.enabled).toBe(true);
    });
  });
});

describe('computeTransformWarnings', () => {
  it('warns when explicitly enabled on device that supports Album Artist', () => {
    const resolution = resolveCleanArtistsTransform(makeTransforms(true), true, true);
    const warnings = computeTransformWarnings(resolution, true, false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.type).toBe('clean-artists-unnecessary');
  });

  it('no warning when user overrode supportsAlbumArtistBrowsing', () => {
    const resolution = resolveCleanArtistsTransform(makeTransforms(true), true, true);
    const warnings = computeTransformWarnings(resolution, true, true);
    expect(warnings).toHaveLength(0);
  });

  it('no warning when auto-suppressed', () => {
    const resolution = resolveCleanArtistsTransform(makeTransforms(true), true, false);
    const warnings = computeTransformWarnings(resolution, true, false);
    expect(warnings).toHaveLength(0);
  });

  it('no warning when globally disabled', () => {
    const resolution = resolveCleanArtistsTransform(makeTransforms(false), true, false);
    const warnings = computeTransformWarnings(resolution, true, false);
    expect(warnings).toHaveLength(0);
  });

  it('no warning when auto-enabled (iPod case)', () => {
    const resolution = resolveCleanArtistsTransform(makeTransforms(true), false, false);
    const warnings = computeTransformWarnings(resolution, false, false);
    expect(warnings).toHaveLength(0);
  });

  it('no warning when explicitly enabled on device without Album Artist', () => {
    const resolution = resolveCleanArtistsTransform(makeTransforms(true), false, true);
    const warnings = computeTransformWarnings(resolution, false, false);
    expect(warnings).toHaveLength(0);
  });

  it('no warning when explicitly disabled', () => {
    const resolution = resolveCleanArtistsTransform(makeTransforms(false), true, true);
    const warnings = computeTransformWarnings(resolution, true, false);
    expect(warnings).toHaveLength(0);
  });
});
