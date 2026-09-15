/**
 * Expectation values previously embedded in DevicePersona for `sony-nw-a3000`.
 *
 * Schema v3 lifted these out of the persona fixture. They now live here so
 * tests can import what they assert against without coupling persona fixture
 * data to assertion shape.
 *
 * @see docs/adr/adr-017-device-persona-fixtures.md §"Schema v3 — May 2026"
 */

import type { DeviceCapabilities } from '@podkit/device-types';
import type { ReadinessResult } from '@podkit/core';

// Currently unsupported — same rationale as sony-nw-a1000. When/if a
// detect-and-reject path lands, this becomes a second rejection fixture
// (distinct PID, same family).
export const expectedCapabilities: DeviceCapabilities | null = null;

// `'unsupported'` was added to ReadinessLevel, threading the structured
// payload from the mass-storage classifier's no-preset rejection path.
// This fixture reflects the canonical `'unsupported'` shape rather than the
// legacy `'unknown'` workaround it superseded.
export const expectedReadiness: ReadinessResult = {
  level: 'unsupported',
  unsupported: {
    kind: 'unsupported-preset',
    headline:
      'Sony NW-A3000 (SonicStage-era HDD Walkman) is not supported — OpenMG/ATRAC content layer requires SonicStage (Windows, discontinued 2008). Distinct PID from NW-A1000 (0x0269 vs 0x026a) — per-model support needed.',
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
            'Sony NW-A3000 (SonicStage-era HDD Walkman) is not supported — OpenMG/ATRAC content layer requires SonicStage (Windows, discontinued 2008). Distinct PID from NW-A1000 (0x0269 vs 0x026a) — per-model support needed.',
        },
      },
    },
  ],
};

export const expectedDoctorOutput = {} as const;
