/**
 * Expectation values previously embedded in DevicePersona for `sony-nw-a1200`.
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
      'Sony NW-A1200 (SonicStage/Media Go-era HDD Walkman) is not supported — OpenMG/ATRAC content layer requires SonicStage or Media Go (Windows, discontinued). Same hardware as NW-A1000 (shared USB PID, differs only by HDD capacity); distinct platform from NW-A3000.',
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
            'Sony NW-A1200 (SonicStage/Media Go-era HDD Walkman) is not supported — OpenMG/ATRAC content layer requires SonicStage or Media Go (Windows, discontinued). Same hardware as NW-A1000 (shared USB PID, differs only by HDD capacity); distinct platform from NW-A3000.',
        },
      },
    },
  ],
};

export const expectedDoctorOutput = {} as const;
