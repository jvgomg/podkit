/**
 * Expectation values previously embedded in DevicePersona for `malformed-sysinfo`.
 *
 * Schema v3 lifted these out of the persona fixture. They now live here so
 * tests can import what they assert against without coupling persona fixture
 * data to assertion shape.
 *
 * @see adr/adr-017-device-persona-fixtures.md §"Schema v3 — May 2026"
 */

import type { DeviceCapabilities } from '@podkit/device-types';
import type { ReadinessResult } from '@podkit/core';

// Nominal iPod 5G Video capability set — copied from the
// `ipod-video-5g-iflash-1tb` expectation. The test can use this to assert
// "if the parser had succeeded, this is what the capabilities would have
// been" — distinct from a misclassification scenario.
export const expectedCapabilities: DeviceCapabilities | null = {
  artworkSources: ['embedded', 'database'],
  artworkMaxResolution: 200,
  supportedAudioCodecs: ['aac', 'alac', 'mp3', 'aiff', 'wav'],
  supportsVideo: true,
  audioNormalization: 'soundcheck',
  supportsAlbumArtistBrowsing: false,
};

// `determineLevel`'s "SysInfo check failed" rule resolves a fail `sysinfo`
// stage to `needs-repair` — the same level a non-malformed-but-absent
// SIE produces, which is the right behaviour: the repair path
// (`podkit device repair sysinfo-extended`) is the user-facing escape
// hatch for both cases. See
// `packages/podkit-core/src/device/readiness/determine-level.ts:88`.
export const expectedReadiness: ReadinessResult = {
  level: 'needs-repair',
  stages: [
    {
      stage: 'sysinfo',
      status: 'fail',
      summary: 'SysInfoExtended XML is malformed (parser error)',
      details: {
        error: 'parsePlist: unexpected end of input',
        xmlBytes: 500,
        truncated: true,
      },
    },
  ],
};

export const expectedDoctorOutput = {} as const;
