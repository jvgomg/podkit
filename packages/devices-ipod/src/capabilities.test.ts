/**
 * Parity tests for `getCapabilities` against the legacy
 * `createIpodCapabilities(libgpodInfo)` adapter from
 * `packages/podkit-core/src/device/capability-adapter.ts`.
 *
 * The legacy adapter is reimplemented inline below as
 * `referenceCreateIpodCapabilities` so this package stays free of
 * `@podkit/core` (and transitively `@podkit/libgpod-node`). The reference
 * implementation must remain a faithful, line-for-line port of the original
 * — any divergence is a bug to investigate.
 *
 * The legacy adapter accepted only libgpod's generation enum values
 * (`nano_4`, `classic_1`, …). For each of our `IpodGenerationId`s that has
 * a libgpod equivalent we feed the legacy adapter a synthetic
 * `LibgpodDeviceInfo`; for the four generations that map to libgpod's
 * `unknown` (`nano_7g`, `touch_5g`, `touch_6g`, `touch_7g`) parity is
 * deliberately not asserted — those are sourced from the table alone.
 */

import { describe, expect, test } from 'bun:test';
import type {
  DeviceCapabilities,
  AudioCodec,
  DeviceArtworkSource,
  FirmwareCapabilities,
} from '@podkit/device-types';

import { getCapabilities } from './capabilities.js';
import { GENERATIONS } from './tables/generations.js';
import { formatIpodLabel } from './format.js';
import { GENERATION_ID_TO_LIBGPOD } from './tables/libgpod-mapping.js';
import {
  IPOD_GENERATION_IDS,
  type IpodChecksumType,
  type IpodGenerationId,
  type IpodModel,
} from './types.js';

// ── Reference: legacy `createIpodCapabilities` ───────────────────────────────
// Faithful reimplementation of
// packages/podkit-core/src/device/capability-adapter.ts to enable parity
// assertions without importing the package. KEEP IN SYNC.

type LibgpodGenerationName =
  | 'first'
  | 'second'
  | 'third'
  | 'fourth'
  | 'photo'
  | 'video_1'
  | 'video_2'
  | 'classic_1'
  | 'classic_3'
  | 'mini_1'
  | 'mini_2'
  | 'nano_1'
  | 'nano_2'
  | 'nano_3'
  | 'nano_4'
  | 'nano_5'
  | 'nano_6'
  | 'shuffle_1'
  | 'shuffle_2'
  | 'shuffle_3'
  | 'shuffle_4'
  | 'touch_1'
  | 'touch_2'
  | 'touch_3'
  | 'touch_4';

interface LegacyLibgpodMetadata {
  supportsAlac?: boolean;
}

// Verbatim subset of `IPOD_GENERATIONS` from
// packages/podkit-core/src/ipod/generation.ts — only the `supportsAlac` flag
// is consumed by the legacy adapter.
const LEGACY_IPOD_GENERATIONS: Record<LibgpodGenerationName, LegacyLibgpodMetadata> = {
  first: {},
  second: {},
  third: {},
  fourth: { supportsAlac: true },
  photo: { supportsAlac: true },
  video_1: { supportsAlac: true },
  video_2: { supportsAlac: true },
  classic_1: { supportsAlac: true },
  classic_3: { supportsAlac: true },
  mini_1: {},
  mini_2: { supportsAlac: true },
  nano_1: {},
  nano_2: {},
  nano_3: { supportsAlac: true },
  nano_4: { supportsAlac: true },
  nano_5: { supportsAlac: true },
  nano_6: {},
  shuffle_1: {},
  shuffle_2: {},
  shuffle_3: {},
  shuffle_4: {},
  touch_1: { supportsAlac: true },
  touch_2: { supportsAlac: true },
  touch_3: { supportsAlac: true },
  touch_4: { supportsAlac: true },
};

// Reference artwork resolution table keyed by libgpod generation name,
// used to verify parity between the new capabilities synthesis and the
// original per-generation artwork limits.
const LEGACY_ARTWORK_MAX_RESOLUTION: Partial<Record<LibgpodGenerationName, number>> = {
  classic_1: 320,
  classic_3: 320,
  video_1: 320,
  video_2: 320,
  nano_1: 176,
  nano_2: 176,
  nano_3: 320,
  nano_4: 240,
  nano_5: 240,
  nano_6: 240,
  photo: 320,
  touch_1: 320,
  touch_2: 320,
  touch_3: 320,
  touch_4: 320,
};

interface LibgpodDeviceInfo {
  readonly supportsArtwork: boolean;
  readonly supportsVideo: boolean;
  readonly generation: LibgpodGenerationName;
}

function referenceCreateIpodCapabilities(device: LibgpodDeviceInfo): DeviceCapabilities {
  const metadata = LEGACY_IPOD_GENERATIONS[device.generation];

  const supportedAudioCodecs: AudioCodec[] = ['aac', 'mp3'];
  if (metadata?.supportsAlac) {
    supportedAudioCodecs.push('alac', 'wav', 'aiff');
  }

  const artworkMaxResolution = device.supportsArtwork
    ? (LEGACY_ARTWORK_MAX_RESOLUTION[device.generation] ?? null)
    : null;
  const artworkSources: DeviceArtworkSource[] = device.supportsArtwork ? ['database'] : [];

  return {
    artworkSources,
    artworkMaxResolution,
    supportedAudioCodecs,
    supportsVideo: device.supportsVideo,
    audioNormalization: 'soundcheck',
    supportsAlbumArtistBrowsing: false,
  };
}

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeIdentity(generationId: IpodGenerationId): IpodModel {
  const gen = GENERATIONS[generationId];
  return {
    displayName: formatIpodLabel({ family: gen.family, ordinal: gen.ordinal }),
    generationId,
    family: gen.family,
    ordinal: gen.ordinal,
    checksumType: gen.checksumType as IpodChecksumType,
    source: 'usb',
  };
}

/**
 * Generations whose libgpod mapping is known — the new table-driven
 * `getCapabilities` must be byte-identical to the legacy adapter for these.
 */
const PARITY_GENERATION_IDS = IPOD_GENERATION_IDS.filter(
  (id) => GENERATION_ID_TO_LIBGPOD[id] !== 'unknown'
);

/**
 * Generations not represented in libgpod's enum. The legacy adapter would
 * have produced incorrect output for these (artwork=0, video=undefined);
 * here they are sourced exclusively from the generation table.
 */
const TABLE_ONLY_GENERATION_IDS: IpodGenerationId[] = [
  'nano_7g',
  'touch_5g',
  'touch_6g',
  'touch_7g',
];

// ── Snapshot parity: every libgpod-known generation ──────────────────────────

describe('getCapabilities — snapshot parity with legacy createIpodCapabilities', () => {
  for (const generationId of PARITY_GENERATION_IDS) {
    test(`${generationId} matches legacy adapter byte-for-byte`, () => {
      const identity = makeIdentity(generationId);
      const gen = GENERATIONS[generationId];

      // Build a synthetic libgpod info using the table values. This is the
      // condition under which the legacy adapter's runtime flags align with
      // class capability — i.e. a freshly-detected device with neither
      // user-disabled artwork nor an upstream libgpod misreport.
      const libgpodGen = GENERATION_ID_TO_LIBGPOD[generationId] as LibgpodGenerationName;
      const expected = referenceCreateIpodCapabilities({
        supportsArtwork: gen.artworkMaxResolution !== null && gen.artworkMaxResolution > 0,
        supportsVideo: gen.supportsVideo,
        generation: libgpodGen,
      });

      const actual = getCapabilities(identity);
      expect(actual).toEqual(expected);
    });
  }
});

// ── Table-only generations (no libgpod equivalent) ───────────────────────────

describe('getCapabilities — table-only generations (no libgpod equivalent)', () => {
  test('nano_7g emits modern Apple capability set', () => {
    expect(getCapabilities(makeIdentity('nano_7g'))).toEqual({
      artworkSources: ['database'],
      artworkMaxResolution: 240,
      supportedAudioCodecs: ['aac', 'mp3', 'alac', 'wav', 'aiff'],
      supportsVideo: true,
      audioNormalization: 'soundcheck',
      supportsAlbumArtistBrowsing: false,
    });
  });

  test.each(TABLE_ONLY_GENERATION_IDS.filter((id) => id !== 'nano_7g'))(
    '%s emits modern touch capability set',
    (generationId) => {
      expect(getCapabilities(makeIdentity(generationId))).toEqual({
        artworkSources: ['database'],
        artworkMaxResolution: 320,
        supportedAudioCodecs: ['aac', 'mp3', 'alac', 'wav', 'aiff'],
        supportsVideo: true,
        audioNormalization: 'soundcheck',
        supportsAlbumArtistBrowsing: false,
      });
    }
  );
});

// ── Coverage assertion: parity + table-only fully covers IPOD_GENERATION_IDS ─

describe('getCapabilities — coverage', () => {
  test('every IpodGenerationId is in either parity or table-only set', () => {
    const covered = new Set([...PARITY_GENERATION_IDS, ...TABLE_ONLY_GENERATION_IDS]);
    for (const id of IPOD_GENERATION_IDS) {
      expect(covered.has(id)).toBe(true);
    }
    expect(covered.size).toBe(IPOD_GENERATION_IDS.length);
  });

  test('output shape matches DeviceCapabilities for every generation', () => {
    for (const id of IPOD_GENERATION_IDS) {
      const caps = getCapabilities(makeIdentity(id));
      expect(
        caps.artworkMaxResolution === null || typeof caps.artworkMaxResolution === 'number'
      ).toBe(true);
      expect(Array.isArray(caps.artworkSources)).toBe(true);
      expect(Array.isArray(caps.supportedAudioCodecs)).toBe(true);
      expect(typeof caps.supportsVideo).toBe('boolean');
      expect(caps.audioNormalization).toBe('soundcheck');
      expect(caps.supportsAlbumArtistBrowsing).toBe(false);
    }
  });
});

// ── Firmware overlay ──────────────────────────────────────────────────────────

describe('getCapabilities — firmware overlay merges with table defaults', () => {
  test('nano_4g: firmware-advertised AAC/MP3 leaves table-derived codecs unchanged', () => {
    const firmware: FirmwareCapabilities = {
      familyId: 15,
      audioCodecs: [
        { codec: 'AAC' },
        { codec: 'MP3' },
        { codec: 'Apple_Lossless' },
        { codec: 'AIFF' },
      ],
    };
    const caps = getCapabilities(makeIdentity('nano_4g'), { firmware });
    expect(caps.supportedAudioCodecs).toEqual(['aac', 'mp3', 'alac', 'wav', 'aiff']);
  });

  test('video_5g: firmware adds nothing beyond the standard ALAC-class set', () => {
    const firmware: FirmwareCapabilities = {
      familyId: 6,
      audioCodecs: [{ codec: 'AAC' }, { codec: 'MP3' }, { codec: 'Apple_Lossless' }],
    };
    const caps = getCapabilities(makeIdentity('video_5g'), { firmware });
    expect(caps.supportedAudioCodecs).toEqual(['aac', 'mp3', 'alac', 'wav', 'aiff']);
  });

  test('classic_6g: unknown firmware codec strings are ignored, no duplicates emitted', () => {
    const firmware: FirmwareCapabilities = {
      familyId: 14,
      audioCodecs: [
        { codec: 'AAC' }, // already present
        { codec: 'WeirdProprietary' }, // unrecognised → dropped
        { codec: 'mp3' }, // case insensitive duplicate
      ],
    };
    const caps = getCapabilities(makeIdentity('classic_6g'), { firmware });
    expect(caps.supportedAudioCodecs).toEqual(['aac', 'mp3', 'alac', 'wav', 'aiff']);
  });

  test('nano_2g (no ALAC class support) gains FLAC if firmware reports it (Rockbox-style)', () => {
    // Hypothetical Rockbox-flashed nano 2G advertising FLAC.
    const firmware: FirmwareCapabilities = {
      familyId: 9,
      audioCodecs: [{ codec: 'AAC' }, { codec: 'MP3' }, { codec: 'FLAC' }],
    };
    const caps = getCapabilities(makeIdentity('nano_2g'), { firmware });
    expect(caps.supportedAudioCodecs).toEqual(['aac', 'mp3', 'flac']);
  });

  test('absent firmware overlay leaves output identical to bare call', () => {
    const a = getCapabilities(makeIdentity('classic_7g'));
    const b = getCapabilities(makeIdentity('classic_7g'), {});
    expect(a).toEqual(b);
  });
});
