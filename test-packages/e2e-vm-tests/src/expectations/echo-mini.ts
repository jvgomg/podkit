/**
 * Expectation values previously embedded in DevicePersona for `echo-mini`.
 *
 * Schema v3 lifted these out of the persona fixture. They now live here so
 * tests can import what they assert against without coupling persona fixture
 * data to assertion shape.
 *
 * @see adr/adr-017-device-persona-fixtures.md §"Schema v3 — May 2026"
 */

import type { DeviceCapabilities } from '@podkit/device-types';
import type { ReadinessResult } from '@podkit/core';

// Provisional — mirrors the built-in `echo-mini` preset capability shape.
// Validate against production resolver / preset lookup in the compute-
// expected pass.
export const expectedCapabilities: DeviceCapabilities | null = {
  artworkSources: ['embedded'],
  artworkMaxResolution: 127,
  supportedAudioCodecs: ['aac', 'alac', 'mp3', 'flac', 'vorbis', 'wav'],
  supportsVideo: false,
  audioNormalization: 'none',
  supportsAlbumArtistBrowsing: true,
};

// Provisional — validate against production resolver in the compute-expected pass.
export const expectedReadiness: ReadinessResult = {
  level: 'ready',
  stages: [],
};

export const expectedDoctorOutput = {} as const;
