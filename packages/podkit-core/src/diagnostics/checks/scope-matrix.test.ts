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
import { debrisFilesIpodCheck } from './debris-files-ipod.js';
import { debrisFilesMassStorageCheck } from './debris-files-mass-storage.js';
import { debrisTranscodeTmpCheck } from './debris-transcode-tmp.js';
import { inquiryMethodsCheck } from './inquiry-methods.js';
import { orphanFilesCheck } from './orphans.js';
import { orphanFilesMassStorageCheck } from './orphans-mass-storage.js';
import { sysInfoExtendedCheck } from './sysinfo-extended.js';
import { sysinfoConsistencyCheck } from './sysinfo-consistency.js';
import { sysinfoModelnumMismatchCheck } from './sysinfo-modelnum-mismatch.js';
import { udevRuleCheck } from './udev-rule.js';
import { videoEncoderCheck } from './video-encoder.js';
import { getDiagnosticCheck, getDiagnosticCheckIds } from '../index.js';
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
  {
    // Host-global: reaps abandoned `<tmpdir>/podkit-transcode-<uuid>/`
    // directories left behind by SIGKILLed syncs. Applies to both device
    // types because the residue is independent of which device is plugged
    // in (added by TASK-397 + ADR-018 follow-up work).
    check: debrisTranscodeTmpCheck,
    scope: 'system',
    applicableTo: ['ipod', 'mass-storage'],
  },
  // Database-health (iPod)
  { check: artworkRebuildCheck, scope: 'database-health', applicableTo: ['ipod'] },
  { check: artworkResetCheck, scope: 'database-health', applicableTo: ['ipod'] },
  { check: orphanFilesCheck, scope: 'database-health', applicableTo: ['ipod'] },
  {
    // TASK-376: surfaces `.podkit-tmp` residue under `iPod_Control/`.
    // Split from `orphan-files` so debris (always podkit-owned) gets safe
    // non-interactive repair while orphans (user-owned) stay confirmation-gated.
    check: debrisFilesIpodCheck,
    scope: 'database-health',
    applicableTo: ['ipod'],
  },
  { check: sysInfoExtendedCheck, scope: 'database-health', applicableTo: ['ipod'] },
  { check: sysinfoConsistencyCheck, scope: 'database-health', applicableTo: ['ipod'] },
  { check: sysinfoModelnumMismatchCheck, scope: 'database-health', applicableTo: ['ipod'] },
  // Database-health (mass-storage)
  {
    check: orphanFilesMassStorageCheck,
    scope: 'database-health',
    applicableTo: ['mass-storage'],
  },
  {
    // TASK-397: split from `orphan-files-mass-storage` so the orphan vs
    // debris repair-confirmation gating could diverge — debris is always
    // podkit-owned (`.podkit-tmp`, `.Audio file`) so its repair runs
    // non-interactively, unlike orphans (potentially pre-podkit content).
    check: debrisFilesMassStorageCheck,
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

// ─────────────────────────────────────────────────────────────────────────────
// Registry completeness — every registered check has an EXPECTATIONS entry
//
// Pinning this here closes the drift mode where a new check lands in the
// registry but its scope/applicableTo never gets a contract assertion. If
// you see this fail after adding a check, add it to EXPECTATIONS above.
// ─────────────────────────────────────────────────────────────────────────────

describe('every registered diagnostic check has a scope-matrix EXPECTATIONS entry', () => {
  it('EXPECTATIONS covers every check returned by getDiagnosticCheckIds()', () => {
    const registeredIds = new Set(getDiagnosticCheckIds());
    const pinnedIds = new Set(EXPECTATIONS.map((e) => e.check.id));

    const missing: string[] = [];
    for (const id of registeredIds) {
      if (!pinnedIds.has(id)) missing.push(id);
    }
    expect(missing).toEqual([]);
  });

  it('every EXPECTATIONS entry resolves through getDiagnosticCheck (no orphan pins)', () => {
    const unresolved: string[] = [];
    for (const exp of EXPECTATIONS) {
      if (!getDiagnosticCheck(exp.check.id)) unresolved.push(exp.check.id);
    }
    expect(unresolved).toEqual([]);
  });
});
