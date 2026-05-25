/**
 * Expectation values previously embedded in DevicePersona for `ipod-shuffle-not-supported`.
 *
 * Schema v3 lifted these out of the persona fixture. They now live here so
 * tests can import what they assert against without coupling persona fixture
 * data to assertion shape.
 *
 * @see adr/adr-017-device-persona-fixtures.md §"Schema v3 — May 2026"
 */

import type { DeviceCapabilities } from '@podkit/device-types';
import type { ReadinessResult } from '@podkit/core';

const unsupportedHeadline =
  'iPod shuffle 3rd/4th gen requires iTunes authentication; not supported by libgpod.';
const unsupported = {
  kind: 'unsupported-device',
  headline: unsupportedHeadline,
} as const;

export const expectedCapabilities: DeviceCapabilities | null = null;

// TASK-331: `level: 'unsupported'` carries the structured rejection payload on
// both the top-level `unsupported` field and the `usb` stage's
// `details.unsupported`. Keep the headline identical to
// `SHUFFLE_REASON` in `tables/unsupported.ts`.
export const expectedReadiness: ReadinessResult = {
  level: 'unsupported',
  unsupported,
  stages: [
    {
      stage: 'usb',
      status: 'fail',
      summary: 'Device not supported',
      details: { unsupported },
    },
  ],
};

export const expectedDoctorOutput = {} as const;
