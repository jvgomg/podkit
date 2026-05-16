/**
 * Cross-cutting scope matrix for diagnostic checks.
 *
 * Pins the `scope` / `applicableTo` declaration on every registered check so
 * the doctor renderer can group them consistently:
 *
 * - `scope: 'system'` → renders under "System".
 * - `scope: 'device-readiness'` → renders under "Device Readiness".
 * - `scope: 'database-health'` → renders under "Database Health".
 *
 * `scope` is a required field on `DiagnosticCheck` — every check must declare
 * which section it renders into, with no default fallback (Approach A from
 * the TASK-317.08 follow-up).
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
  scope: 'system' | 'device-readiness' | 'database-health';
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
  // Database-health (iPod)
  { check: artworkRebuildCheck, scope: 'database-health', applicableTo: ['ipod'] },
  { check: artworkResetCheck, scope: 'database-health', applicableTo: ['ipod'] },
  { check: orphanFilesCheck, scope: 'database-health', applicableTo: ['ipod'] },
  { check: sysInfoExtendedCheck, scope: 'database-health', applicableTo: ['ipod'] },
  { check: sysinfoConsistencyCheck, scope: 'database-health', applicableTo: ['ipod'] },
  { check: sysinfoModelnumMismatchCheck, scope: 'database-health', applicableTo: ['ipod'] },
  // Database-health (mass-storage)
  {
    check: orphanFilesMassStorageCheck,
    scope: 'database-health',
    applicableTo: ['mass-storage'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Per-check metadata assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('diagnostic check scope matrix — every check declares scope + applicableTo correctly', () => {
  for (const exp of EXPECTATIONS) {
    describe(exp.check.id, () => {
      it(`has scope: '${exp.scope}'`, () => {
        // scope is required — compile-time enforced — so this is a direct
        // pin against the value the check declared in its module.
        expect(exp.check.scope).toBe(exp.scope);
      });

      if (exp.applicableTo) {
        it(`has applicableTo: [${exp.applicableTo.map((t) => `'${t}'`).join(', ')}]`, () => {
          expect(exp.check.applicableTo).toEqual([...exp.applicableTo!]);
        });
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// iPod-specific system check exclusion
// ─────────────────────────────────────────────────────────────────────────────

describe('iPod Firmware Inquiry Methods does not apply to mass-storage', () => {
  it('inquiry-methods is scoped to iPod devices only', () => {
    expect(inquiryMethodsCheck.applicableTo).toEqual(['ipod']);
  });
});
