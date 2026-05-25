/**
 * Expectation values previously embedded in DevicePersona for `echo-mini-populated`.
 *
 * Schema v3 lifted these out of the persona fixture. They now live here so
 * tests can import what they assert against without coupling persona fixture
 * data to assertion shape.
 *
 * @see adr/adr-017-device-persona-fixtures.md §"Schema v3 — May 2026"
 */

import type { DeviceCapabilities } from '@podkit/device-types';
import type { ReadinessResult } from '@podkit/core';

// Same capabilities as the empty `echo-mini` persona — content state does
// not affect device capabilities (preset resolution is identity-based).
export const expectedCapabilities: DeviceCapabilities | null = {
  artworkSources: ['embedded'],
  artworkMaxResolution: 127,
  supportedAudioCodecs: ['aac', 'alac', 'mp3', 'flac', 'vorbis', 'wav'],
  supportsVideo: false,
  audioNormalization: 'none',
  supportsAlbumArtistBrowsing: true,
};

export const expectedReadiness: ReadinessResult = {
  level: 'ready',
  stages: [],
};

export const expectedDoctorOutput = {} as const;
