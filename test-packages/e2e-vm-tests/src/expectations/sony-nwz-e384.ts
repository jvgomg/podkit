/**
 * Expectation values previously embedded in DevicePersona for `sony-nwz-e384`.
 *
 * Schema v3 lifted these out of the persona fixture. They now live here so
 * tests can import what they assert against without coupling persona fixture
 * data to assertion shape.
 *
 * @see adr/adr-017-device-persona-fixtures.md §"Schema v3 — May 2026"
 */

import type { DeviceCapabilities } from '@podkit/device-types';
import type { ReadinessResult } from '@podkit/core';

// Currently unsupported — no Sony preset in built-in presets. When a
// preset lands, populate this with the real capabilities (audio: mp3, aac,
// wav; video: false unless WMV transcoding is added; artwork: 160x128 max,
// embedded only).
export const expectedCapabilities: DeviceCapabilities | null = null;

// TASK-331 added `'unsupported'` to ReadinessLevel + threaded a structured
// payload from the mass-storage classifier's vendor-recognised-but-no-preset
// table (`packages/devices-mass-storage/src/unsupported.ts`). The headline
// comes from the Sony entry's `reason(vendorId, productId)` template — keep
// it in sync with that table.
export const expectedReadiness: ReadinessResult = {
  level: 'unsupported',
  unsupported: {
    kind: 'unsupported-preset',
    headline:
      'Sony Walkman is not yet supported by podkit — no preset registered for USB 0x054c:0x0882.',
  },
  stages: [
    {
      stage: 'usb',
      status: 'fail',
      summary: 'Device not supported',
      details: {
        unsupported: {
          kind: 'unsupported-preset',
          headline:
            'Sony Walkman is not yet supported by podkit — no preset registered for USB 0x054c:0x0882.',
        },
      },
    },
  ],
};

export const expectedDoctorOutput = {} as const;
