/**
 * Expectation values previously embedded in DevicePersona for `ipod-video-5g-corrupt-db`.
 *
 * Schema v3 lifted these out of the persona fixture. They now live here so
 * tests can import what they assert against without coupling persona fixture
 * data to assertion shape.
 *
 * @see adr/adr-017-device-persona-fixtures.md §"Schema v3 — May 2026"
 */

import type { DeviceCapabilities } from '@podkit/device-types';
import type { ReadinessResult } from '@podkit/core';

// Nominal iPod 5G Video capabilities — USB PID unambiguously identifies the
// generation regardless of DB state, so capabilities remain determinable.
export const expectedCapabilities: DeviceCapabilities | null = {
  artworkSources: ['embedded', 'database'],
  artworkMaxResolution: 200,
  supportedAudioCodecs: ['aac', 'alac', 'mp3', 'aiff', 'wav'],
  supportsVideo: true,
  audioNormalization: 'soundcheck',
  supportsAlbumArtistBrowsing: false,
};

// The corrupt-db failure surfaces at the `database` readiness stage.
// `determineLevel` maps a failed `database` stage to `needs-repair` —
// same as malformed-sysinfo's `needs-repair` from a failed `sysinfo`
// stage. The repair path is `podkit device repair itunes-db`.
export const expectedReadiness: ReadinessResult = {
  level: 'needs-repair',
  stages: [
    {
      stage: 'database',
      status: 'fail',
      summary: 'iTunesDB is corrupt or unreadable (parser error)',
      details: {
        error: 'parseMhbd: mhbd header too small',
        dbBytes: 512,
        truncated: true,
      },
    },
  ],
};

export const expectedDoctorOutput = {} as const;
