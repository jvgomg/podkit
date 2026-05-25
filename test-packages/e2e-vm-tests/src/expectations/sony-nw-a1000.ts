/**
 * Expectation values previously embedded in DevicePersona for `sony-nw-a1000`.
 *
 * Schema v3 lifted these out of the persona fixture. They now live here so
 * tests can import what they assert against without coupling persona fixture
 * data to assertion shape.
 *
 * @see adr/adr-017-device-persona-fixtures.md §"Schema v3 — May 2026"
 */

import type { DeviceCapabilities } from '@podkit/device-types';
import type { ReadinessResult } from '@podkit/core';

// Currently unsupported — no preset, no implementation. When/if a
// detect-and-reject path lands (option 1 in the device profile), this
// becomes the canonical rejection fixture. When/if a MSM-mode preset is
// added (option 2), `expectedCapabilities` shifts to the MP3/folder-only
// shape.
export const expectedCapabilities: DeviceCapabilities | null = null;

// TASK-331 added `'unsupported'` to ReadinessLevel + threaded the structured
// payload from the mass-storage classifier's no-preset rejection path.
// TASK-324 Phase 5 AC #5 sweeps this from the legacy `'unknown'` workaround
// to the canonical `'unsupported'` shape.
export const expectedReadiness: ReadinessResult = {
  level: 'unsupported',
  unsupported: {
    kind: 'unsupported-preset',
    headline:
      'Sony NW-A1000 (SonicStage-era HDD Walkman) is not supported — content layer requires OpenMG/ATRAC encoding authored by SonicStage. Switch device to USB Mass Storage Mode (firmware v2.0+) for folder-browser sync.',
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
            'Sony NW-A1000 (SonicStage-era HDD Walkman) is not supported — content layer requires OpenMG/ATRAC encoding authored by SonicStage. Switch device to USB Mass Storage Mode (firmware v2.0+) for folder-browser sync.',
        },
      },
    },
  ],
};

export const expectedDoctorOutput = {} as const;
