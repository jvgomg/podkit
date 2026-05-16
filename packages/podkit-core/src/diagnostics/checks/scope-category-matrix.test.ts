/**
 * Cross-cutting metadata matrix for diagnostic checks (TASK-317.08).
 *
 * Pins the `scope` / `category` / `applicableTo` declaration on every
 * registered check so the doctor renderer can group them consistently:
 *
 * - System-scope checks render under "System".
 * - Device-scope + `category: 'readiness'` checks render under "Device
 *   Readiness".
 * - Device-scope + `category: 'database'` (or unset for legacy checks)
 *   render under "Database Health".
 *
 * Also enforces the iPod-only gating for `iPod Firmware Inquiry Methods`
 * so it doesn't surface on Echo Mini / other mass-storage devices where
 * the iPodDriver.kext probe is meaningless.
 */

import { describe, it, expect } from 'bun:test';

import { artworkRebuildCheck } from './artwork.js';
import { artworkResetCheck } from './artwork-reset.js';
import { codecEncodersCheck } from './codec-encoders.js';
import { inquiryMethodsCheck } from './inquiry-methods.js';
import { orphanFilesCheck } from './orphans.js';
import { orphanFilesMassStorageCheck } from './orphans-mass-storage.js';
import { sysInfoExtendedCheck } from './sysinfo-extended.js';
import { sysinfoConsistencyCheck } from './sysinfo-consistency.js';
import { sysinfoModelnumMismatchCheck } from './sysinfo-modelnum-mismatch.js';
import { udevRuleCheck } from './udev-rule.js';
import { videoEncoderCheck } from './video-encoder.js';
import type { DiagnosticCheck } from '../types.js';

// ── Expected metadata table ─────────────────────────────────────────────────

interface Expectation {
  check: DiagnosticCheck;
  scope: 'system' | 'device';
  category?: 'readiness' | 'database';
  applicableTo?: ReadonlyArray<'ipod' | 'mass-storage'>;
}

// Single source of truth for which section each check renders in. When a
// new check lands, add it here AND it'll get the metadata assertions below.
const EXPECTATIONS: ReadonlyArray<Expectation> = [
  // System-scope
  {
    check: codecEncodersCheck,
    scope: 'system',
    applicableTo: ['ipod', 'mass-storage'],
  },
  {
    check: videoEncoderCheck,
    scope: 'system',
    applicableTo: ['ipod', 'mass-storage'],
  },
  {
    check: udevRuleCheck,
    scope: 'system',
    applicableTo: ['ipod', 'mass-storage'],
  },
  {
    // iPod-only: probes iPodDriver.kext / SCSI sg_io paths used exclusively
    // by iPod firmware inquiry. Mass-storage devices must not see it.
    check: inquiryMethodsCheck,
    scope: 'system',
    applicableTo: ['ipod'],
  },
  // Device-scope, category: database (iPod)
  { check: artworkRebuildCheck, scope: 'device', category: 'database', applicableTo: ['ipod'] },
  { check: artworkResetCheck, scope: 'device', category: 'database', applicableTo: ['ipod'] },
  { check: orphanFilesCheck, scope: 'device', category: 'database', applicableTo: ['ipod'] },
  { check: sysInfoExtendedCheck, scope: 'device', category: 'database', applicableTo: ['ipod'] },
  {
    check: sysinfoConsistencyCheck,
    scope: 'device',
    category: 'database',
    applicableTo: ['ipod'],
  },
  {
    check: sysinfoModelnumMismatchCheck,
    scope: 'device',
    category: 'database',
    applicableTo: ['ipod'],
  },
  // Device-scope, category: database (mass-storage)
  {
    check: orphanFilesMassStorageCheck,
    scope: 'device',
    category: 'database',
    applicableTo: ['mass-storage'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Per-check metadata assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('TASK-317.08 — every check declares scope + category + applicableTo correctly', () => {
  for (const exp of EXPECTATIONS) {
    describe(exp.check.id, () => {
      it(`has scope: '${exp.scope}'`, () => {
        // System checks set `scope: 'system'` explicitly; device-scope
        // checks may set 'device' explicitly or omit it (default = 'device').
        const scope = exp.check.scope ?? 'device';
        expect(scope).toBe(exp.scope);
      });

      if (exp.scope === 'device') {
        it(`has category: '${exp.category}'`, () => {
          expect(exp.check.category).toBe(exp.category);
        });
      } else {
        // System-scope checks should NOT declare a category — it's
        // ignored for them and would only confuse JSON consumers.
        it('does not declare a category (system-scope)', () => {
          expect(exp.check.category).toBeUndefined();
        });
      }

      if (exp.applicableTo) {
        it(`has applicableTo: [${exp.applicableTo.map((t) => `'${t}'`).join(', ')}]`, () => {
          expect(exp.check.applicableTo).toEqual([...exp.applicableTo!]);
        });
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// iPod-specific system check exclusion (TASK-317.08 AC #4)
// ─────────────────────────────────────────────────────────────────────────────

describe('TASK-317.08 — iPod Firmware Inquiry Methods does not apply to mass-storage', () => {
  it('inquiry-methods is scoped to iPod devices only', () => {
    expect(inquiryMethodsCheck.applicableTo).toEqual(['ipod']);
  });
});
