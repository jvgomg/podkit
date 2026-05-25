/**
 * Expectation values previously embedded in DevicePersona for `ipod-touch-5g-unsupported`.
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
  "iPod touch (5th generation) uses Apple's proprietary sync protocol; podkit only supports iPod disk mode.";
const unsupported = { kind: 'ios-device', headline: unsupportedHeadline } as const;

export const expectedCapabilities: DeviceCapabilities | null = null;

// TASK-331 added `'unsupported'` to ReadinessLevel + exposed the structured
// payload as a top-level `unsupported` field on the result. The fail `usb`
// stage mirrors what `checkReadiness({ unsupported })` emits for an
// unsupported-PID device, so this fixture is the byte-for-byte expected
// result the determineLevel cascade produces today.
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
