/**
 * Snapshot parity tests: identifyCapabilities + resolveCapabilities
 * vs BUILT_IN_PRESETS (mass-storage) and GENERATIONS table (iPod).
 *
 * ## Goal
 *
 * Verify that the unified `resolveCapabilities` path produces consistent
 * output relative to the source-of-truth data: `BUILT_IN_PRESETS` from
 * `@podkit/devices-mass-storage` and the GENERATIONS table from
 * `@podkit/devices-ipod`.
 *
 * ## iPod path
 *
 * Iterates over every `IpodGenerationId` that has a non-`unknown` libgpod
 * generation name. For each, verifies that `identifyCapabilities`
 * returns output consistent with the generation table (class-authoritative —
 * not runtime-flag-dependent).
 *
 * ## Mass-storage path
 *
 * Compares `resolveCapabilities({ kind: 'mass-storage', presetId })` against
 * the raw `BUILT_IN_PRESETS` data for each built-in preset, with and without
 * overrides.
 *
 * @module
 */

import { describe, test, expect } from 'bun:test';

import { identifyCapabilities, resolveCapabilities } from './resolve-capabilities.js';
import {
  resolveIpodModel,
  GENERATION_ID_TO_LIBGPOD,
  GENERATIONS,
  type IpodGenerationId,
} from '@podkit/devices-ipod';
import { IPOD_GENERATION_IDS } from '@podkit/device-types';
import { BUILT_IN_PRESETS } from '@podkit/devices-mass-storage';

// =============================================================================
// Helpers
// =============================================================================

/**
 * IpodGenerationId values that have a real libgpod generation name (not 'unknown').
 * These are the only IDs for which table-driven parity can be asserted via
 * the libgpod generation axis of resolveIpodModel.
 */
const PARITY_GENERATION_IDS: IpodGenerationId[] = (
  IPOD_GENERATION_IDS as readonly IpodGenerationId[]
).filter((id) => GENERATION_ID_TO_LIBGPOD[id] !== 'unknown');

// =============================================================================
// iPod parity — identifyCapabilities vs GENERATIONS table
// =============================================================================

describe('identifyCapabilities — table-authoritative flags', () => {
  /**
   * For each libgpod-known generation, verify that the unified resolver produces
   * output consistent with the generation table. The new resolver is
   * class-authoritative — it reads from the generation table directly, not from
   * libgpod runtime flags.
   */
  for (const generationId of PARITY_GENERATION_IDS) {
    test(`${generationId} — resolves via libgpodGeneration axis`, () => {
      const gen = GENERATIONS[generationId];
      const libgpodGenName = GENERATION_ID_TO_LIBGPOD[generationId];

      const model = resolveIpodModel({ libgpodGeneration: libgpodGenName });
      // PARITY_GENERATION_IDS only includes known libgpod generation names,
      // so resolveIpodModel must always return a non-null model here.
      if (!model)
        throw new Error(
          `resolveIpodModel returned null for known generation ${generationId} (libgpod name: ${libgpodGenName})`
        );
      const caps = identifyCapabilities(model);

      // Verify key fields are class-authoritative (from table, not runtime flags).
      expect(caps.supportsVideo).toBe(gen.supportsVideo);
      if (gen.artworkMaxResolution !== null && gen.artworkMaxResolution > 0) {
        expect(caps.artworkMaxResolution).toBe(gen.artworkMaxResolution);
        expect(caps.artworkSources).toContain('database');
      }
      expect(caps.audioNormalization).toBe('soundcheck');
      expect(caps.supportsAlbumArtistBrowsing).toBe(false);
      expect(caps.supportedAudioCodecs).toContain('aac');
      expect(caps.supportedAudioCodecs).toContain('mp3');
    });
  }
});

// =============================================================================
// Mass-storage parity — resolveCapabilities vs BUILT_IN_PRESETS
// =============================================================================

const PRESET_IDS = ['echo-mini', 'rockbox', 'generic'] as const;

/**
 * Strip `contentPaths` from a preset so it can be compared against
 * `DeviceCapabilities`. `BUILT_IN_PRESETS` includes `contentPaths`, while
 * `resolveCapabilities` returns only `DeviceCapabilities` (no contentPaths).
 */
function stripContentPaths(
  preset: (typeof BUILT_IN_PRESETS)[keyof typeof BUILT_IN_PRESETS]
): import('@podkit/device-types').DeviceCapabilities {
  // Strip every preset-only field that isn't part of `DeviceCapabilities`:
  // file-layout (`contentPaths`) and the display fields (`manufacturer`,
  // `productName`) used by `formatPresetDisplay`.
  const {
    contentPaths: _omitPaths,
    manufacturer: _omitMfr,
    productName: _omitProduct,
    ...caps
  } = preset;
  return caps;
}

describe('resolveCapabilities parity vs BUILT_IN_PRESETS (mass-storage path)', () => {
  for (const presetId of PRESET_IDS) {
    test(`${presetId} — no overrides`, () => {
      const next = resolveCapabilities({ kind: 'mass-storage', presetId });
      const expected = stripContentPaths(BUILT_IN_PRESETS[presetId]);
      expect(next).toEqual(expected);
    });

    test(`${presetId} — with artworkMaxResolution override`, () => {
      const overrides = { artworkMaxResolution: 99 } as const;
      const next = resolveCapabilities({ kind: 'mass-storage', presetId }, { overrides });
      expect(next.artworkMaxResolution).toBe(99);
      // Other fields unchanged
      expect(next.supportsAlbumArtistBrowsing).toBe(
        BUILT_IN_PRESETS[presetId].supportsAlbumArtistBrowsing
      );
    });

    test(`${presetId} — with supportedAudioCodecs override`, () => {
      const overrides = {
        supportedAudioCodecs: ['aac', 'mp3'] as import('@podkit/device-types').AudioCodec[],
      };
      const next = resolveCapabilities({ kind: 'mass-storage', presetId }, { overrides });
      expect(next.supportedAudioCodecs).toEqual(['aac', 'mp3']);
    });
  }
});

// =============================================================================
// Coverage assertion
// =============================================================================

describe('parity coverage', () => {
  test('PARITY_GENERATION_IDS covers all libgpod-known IpodGenerationIds', () => {
    const knownInLibgpod = (IPOD_GENERATION_IDS as readonly IpodGenerationId[]).filter(
      (id) => GENERATION_ID_TO_LIBGPOD[id] !== 'unknown'
    );
    expect(PARITY_GENERATION_IDS).toEqual(knownInLibgpod);
  });

  test('table-only generations (unknown libgpod mapping) are exactly 4', () => {
    const tableOnly = (IPOD_GENERATION_IDS as readonly IpodGenerationId[]).filter(
      (id) => GENERATION_ID_TO_LIBGPOD[id] === 'unknown'
    );
    // nano_7g, touch_5g, touch_6g, touch_7g — documented in capabilities.test.ts
    expect(tableOnly).toHaveLength(4);
    expect(tableOnly).toContain('nano_7g');
    expect(tableOnly).toContain('touch_5g');
    expect(tableOnly).toContain('touch_6g');
    expect(tableOnly).toContain('touch_7g');
  });
});
