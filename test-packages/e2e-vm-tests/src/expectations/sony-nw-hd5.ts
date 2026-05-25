/**
 * Expectation values previously embedded in DevicePersona for `sony-nw-hd5`.
 *
 * Schema v3 lifted these out of the persona fixture. They now live here so
 * tests can import what they assert against without coupling persona fixture
 * data to assertion shape.
 *
 * @see adr/adr-017-device-persona-fixtures.md §"Schema v3 — May 2026"
 */

import type { DeviceCapabilities } from '@podkit/device-types';
import type { ReadinessResult } from '@podkit/core';

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
      'Sony NW-HD5 (Network Walkman, 2004–2005 pre-NW-A line) is not supported — OpenMG/ATRAC content requires SonicStage (Windows, discontinued). Additional MACLIST0 integrity records are not authorable from outside SonicStage. USB descriptor "ATRAC HDD" + PID 0x0233 distinguish from later NW-A "HDD WALKMAN" units.',
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
            'Sony NW-HD5 (Network Walkman, 2004–2005 pre-NW-A line) is not supported — OpenMG/ATRAC content requires SonicStage (Windows, discontinued). Additional MACLIST0 integrity records are not authorable from outside SonicStage. USB descriptor "ATRAC HDD" + PID 0x0233 distinguish from later NW-A "HDD WALKMAN" units.',
        },
      },
    },
  ],
};

export const expectedDoctorOutput = {} as const;
