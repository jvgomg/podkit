/**
 * Expectation values previously embedded in DevicePersona for `non-ipod-usb-disk`.
 *
 * Schema v3 lifted these out of the persona fixture. They now live here so
 * tests can import what they assert against without coupling persona fixture
 * data to assertion shape.
 *
 * @see adr/adr-017-device-persona-fixtures.md §"Schema v3 — May 2026"
 */

import type { DeviceCapabilities } from '@podkit/device-types';
import type { ReadinessResult } from '@podkit/core';

// Canonical reason string — must match the SanDisk entry in
// `packages/devices-mass-storage/src/unsupported.ts`'s `UNSUPPORTED_VENDORS`
// table applied to vendor `0781`, product `5567`.
const unsupportedHeadline =
  'Non-Apple USB storage device (SanDisk); podkit has no preset for this vendor (USB 0x0781:0x5567).';
const unsupported = {
  kind: 'unsupported-preset',
  headline: unsupportedHeadline,
} as const;

export const expectedCapabilities: DeviceCapabilities | null = null;

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
