/**
 * Exhaustive scenario-matrix test for the M4 verification policy
 * (`decideAddOutcome`). Data-driven: each row is a (tier × claim ×
 * assessmentView × deviceStateView × forced) tuple → expected `Outcome.kind`.
 * This is the doc-045 §A matrix expressed as a unit test with no subprocess,
 * no fixtures, no I/O.
 *
 * It also pins the two structural invariants M4 must hold: it never throws,
 * and it is total over the cross product of representative inputs.
 */

import { describe, it, expect } from 'bun:test';
import {
  decideAddOutcome,
  type DeviceAssessmentView,
  type DeviceStateView,
  type Outcome,
} from './verification-policy.js';
import type { VerificationTier, DeviceClaim } from './resolve-add-request.js';

// =============================================================================
// View builders
// =============================================================================

const CLAIM_DECLARED: DeviceClaim = { mode: 'declared', deviceType: 'ipod' };
const CLAIM_UNDECLARED: DeviceClaim = { mode: 'undeclared' };

function assess(over: Partial<DeviceAssessmentView> = {}): DeviceAssessmentView {
  return {
    hasIdentity: true,
    displayName: 'iPod Video (5th Generation)',
    identityStore: 'present',
    identityStoreRequired: false,
    hasSysInfoModelNumber: false,
    ...over,
  };
}

function state(over: Partial<DeviceStateView> = {}): DeviceStateView {
  return {
    located: true,
    volumeUuid: 'AAAA-BBBB',
    filesystem: 'vfat',
    platform: 'darwin',
    crossCheck: 'pass',
    ...over,
  };
}

// =============================================================================
// Exhaustive matrix
// =============================================================================

interface Row {
  name: string;
  tier: VerificationTier;
  claim: DeviceClaim;
  assessment: DeviceAssessmentView | null;
  state: DeviceStateView;
  forced?: boolean;
  expected: Outcome;
}

const ROWS: Row[] = [
  // --- config-inject: always proceeds (M3 validated completeness) ----------
  {
    name: 'config-inject + declared + good state → proceed',
    tier: 'config-inject',
    claim: CLAIM_DECLARED,
    assessment: null,
    state: state(),
    expected: { kind: 'proceed' },
  },
  {
    name: 'config-inject ignores hfsplus-on-linux (user took responsibility)',
    tier: 'config-inject',
    claim: CLAIM_DECLARED,
    assessment: null,
    state: state({ platform: 'linux', filesystem: 'hfsplus' }),
    expected: { kind: 'proceed' },
  },
  {
    name: 'config-inject ignores missing uuid',
    tier: 'config-inject',
    claim: CLAIM_DECLARED,
    assessment: null,
    state: state({ volumeUuid: '' }),
    expected: { kind: 'proceed' },
  },

  // --- hfsplus on Linux refusal (verify + trust-disk) ----------------------
  {
    name: 'verify + hfsplus on linux → refuse-hfsplus-on-linux',
    tier: 'verify',
    claim: CLAIM_DECLARED,
    assessment: assess(),
    state: state({ platform: 'linux', filesystem: 'hfsplus', path: '/media/x/disk' }),
    expected: { kind: 'refuse-hfsplus-on-linux', filesystem: 'hfsplus', path: '/media/x/disk' },
  },
  {
    name: 'trust-disk + hfsplus on linux → refuse-hfsplus-on-linux',
    tier: 'trust-disk',
    claim: CLAIM_UNDECLARED,
    assessment: assess(),
    state: state({ platform: 'linux', filesystem: 'hfsplus' }),
    expected: { kind: 'refuse-hfsplus-on-linux', filesystem: 'hfsplus' },
  },
  {
    name: 'verify + hfsplus on macOS → NOT refused (Linux-only policy)',
    tier: 'verify',
    claim: CLAIM_DECLARED,
    assessment: assess(),
    state: state({ platform: 'darwin', filesystem: 'hfsplus' }),
    expected: { kind: 'proceed' },
  },

  // --- no-uuid refusal (and force downgrade) -------------------------------
  {
    name: 'verify + no uuid → refuse-no-uuid',
    tier: 'verify',
    claim: CLAIM_DECLARED,
    assessment: assess(),
    state: state({ volumeUuid: '', path: '/mnt/x', filesystem: 'exfat' }),
    expected: { kind: 'refuse-no-uuid', path: '/mnt/x', filesystem: 'exfat' },
  },
  {
    name: 'verify + manual- uuid → refuse-no-uuid (legacy synthetic)',
    tier: 'verify',
    claim: CLAIM_DECLARED,
    assessment: assess(),
    state: state({ volumeUuid: 'manual-abc' }),
    expected: { kind: 'refuse-no-uuid' },
  },
  {
    name: 'verify + no uuid + force → warn path-only',
    tier: 'verify',
    claim: CLAIM_DECLARED,
    assessment: assess(),
    state: state({ volumeUuid: '' }),
    forced: true,
    expected: { kind: 'proceed-with-warning', warning: 'path-only-no-uuid' },
  },
  {
    name: 'trust-disk + no uuid → refuse-no-uuid',
    tier: 'trust-disk',
    claim: CLAIM_UNDECLARED,
    assessment: assess(),
    state: state({ volumeUuid: undefined }),
    expected: { kind: 'refuse-no-uuid' },
  },

  // --- empty-identity refusal (and force / declared downgrade) -------------
  {
    name: 'verify + undeclared + fully empty (unwritable, no model) → refuse-empty-identity',
    tier: 'verify',
    claim: CLAIM_UNDECLARED,
    assessment: assess({ hasIdentity: false, identityStore: 'unwritable' }),
    state: state(),
    expected: { kind: 'refuse-empty-identity' },
  },
  {
    // isIdentityFullyEmptyView short-circuits on `declared` (returns false), so
    // step 4 never fires. No model anchor → step 9 → partial-identity.
    name: 'verify + declared + fully empty → warn partial-identity (declared bypasses empty-identity step)',
    tier: 'verify',
    claim: CLAIM_DECLARED,
    assessment: assess({ hasIdentity: false, identityStore: 'unwritable' }),
    state: state(),
    expected: { kind: 'proceed-with-warning', warning: 'partial-identity' },
  },
  {
    name: 'verify + undeclared + fully empty + force → warn empty-identity-forced',
    tier: 'verify',
    claim: CLAIM_UNDECLARED,
    assessment: assess({ hasIdentity: false, identityStore: 'unwritable' }),
    state: state(),
    forced: true,
    expected: { kind: 'proceed-with-warning', warning: 'empty-identity-forced' },
  },
  {
    name: 'verify + undeclared + null assessment → refuse-empty-identity',
    tier: 'verify',
    claim: CLAIM_UNDECLARED,
    assessment: null,
    state: state(),
    expected: { kind: 'refuse-empty-identity' },
  },
  {
    name: 'trust-disk + undeclared + fully empty → refuse-empty-identity',
    tier: 'trust-disk',
    claim: CLAIM_UNDECLARED,
    assessment: assess({ hasIdentity: false, identityStore: 'unwritable' }),
    state: state(),
    expected: { kind: 'refuse-empty-identity' },
  },

  // --- trust-disk: identity store required but missing/unwritable ----------
  {
    name: 'trust-disk + checksum gen + SysInfo missing → error-missing-sysinfo',
    tier: 'trust-disk',
    claim: CLAIM_DECLARED,
    assessment: assess({ identityStore: 'missing', identityStoreRequired: true }),
    state: state(),
    expected: { kind: 'error-missing-sysinfo', hint: 'run-doctor' },
  },
  {
    name: 'trust-disk + checksum gen + SysInfo unwritable → error-missing-sysinfo',
    tier: 'trust-disk',
    claim: CLAIM_DECLARED,
    assessment: assess({ identityStore: 'unwritable', identityStoreRequired: true }),
    state: state(),
    expected: { kind: 'error-missing-sysinfo', hint: 'run-doctor' },
  },
  {
    name: 'trust-disk + checksum gen + SysInfo present → proceed',
    tier: 'trust-disk',
    claim: CLAIM_DECLARED,
    assessment: assess({ identityStore: 'present', identityStoreRequired: true }),
    state: state(),
    expected: { kind: 'proceed' },
  },
  {
    name: 'trust-disk + non-checksum gen + SysInfo missing → proceed (not required)',
    tier: 'trust-disk',
    claim: CLAIM_DECLARED,
    assessment: assess({ identityStore: 'missing', identityStoreRequired: false }),
    state: state(),
    expected: { kind: 'proceed' },
  },
  {
    name: 'trust-disk + mass-storage (not-applicable store) → proceed',
    tier: 'trust-disk',
    claim: CLAIM_DECLARED,
    assessment: assess({ identityStore: 'not-applicable', identityStoreRequired: false }),
    state: state(),
    expected: { kind: 'proceed' },
  },

  // --- verify: prompt to write SysInfoExtended -----------------------------
  {
    name: 'verify + SysInfo missing → prompt-write-sie',
    tier: 'verify',
    claim: CLAIM_DECLARED,
    assessment: assess({ identityStore: 'missing' }),
    state: state({ path: '/Volumes/IPOD' }),
    expected: { kind: 'prompt-write-sie', mountPoint: '/Volumes/IPOD' },
  },
  {
    name: 'verify + SysInfo present → no prompt, proceed',
    tier: 'verify',
    claim: CLAIM_DECLARED,
    assessment: assess({ identityStore: 'present' }),
    state: state(),
    expected: { kind: 'proceed' },
  },

  // --- verify: cross-check mismatch ----------------------------------------
  {
    name: 'verify + present store + cross-check mismatch → error-mismatch',
    tier: 'verify',
    claim: CLAIM_DECLARED,
    assessment: assess({ identityStore: 'present' }),
    state: state({ crossCheck: 'mismatch', crossCheckDetail: 'model num differs' }),
    expected: { kind: 'error-mismatch', detail: 'model num differs' },
  },
  {
    name: 'trust-disk + cross-check mismatch → ignored (no live cross-check) → proceed',
    tier: 'trust-disk',
    claim: CLAIM_DECLARED,
    assessment: assess({ identityStore: 'present' }),
    state: state({ crossCheck: 'mismatch' }),
    expected: { kind: 'proceed' },
  },

  // --- unsupported generation prompt ---------------------------------------
  {
    name: 'verify + unsupported reason + present store → prompt-unsupported',
    tier: 'verify',
    claim: CLAIM_DECLARED,
    assessment: assess({
      identityStore: 'present',
      unsupportedReason: { kind: 'ios-device', headline: 'iOS device' },
    }),
    state: state(),
    expected: {
      kind: 'prompt-unsupported',
      reason: { kind: 'ios-device', headline: 'iOS device' },
    },
  },
  {
    name: 'trust-disk + unsupported reason → prompt-unsupported',
    tier: 'trust-disk',
    claim: CLAIM_DECLARED,
    assessment: assess({
      identityStore: 'not-applicable',
      identityStoreRequired: false,
      unsupportedReason: { kind: 'unsupported-device', headline: 'Refused vendor' },
    }),
    state: state(),
    expected: {
      kind: 'prompt-unsupported',
      reason: { kind: 'unsupported-device', headline: 'Refused vendor' },
    },
  },

  // --- partial identity warning --------------------------------------------
  {
    name: 'verify + declared + no model anchor but a store → warn partial-identity',
    tier: 'verify',
    claim: CLAIM_DECLARED,
    assessment: assess({ hasIdentity: false, identityStore: 'present' }),
    state: state(),
    expected: { kind: 'proceed-with-warning', warning: 'partial-identity' },
  },
  {
    name: 'verify + undeclared + no model + missing store (USB signal) → prompt-write-sie (not empty)',
    tier: 'verify',
    claim: CLAIM_UNDECLARED,
    assessment: assess({ hasIdentity: false, identityStore: 'missing' }),
    state: state(),
    expected: { kind: 'prompt-write-sie', mountPoint: '' },
  },

  // --- happy path ----------------------------------------------------------
  {
    name: 'verify + full identity + clean state → proceed',
    tier: 'verify',
    claim: CLAIM_DECLARED,
    assessment: assess(),
    state: state(),
    expected: { kind: 'proceed' },
  },

  // --- FIX 3: previously-untested reachable paths --------------------------
  // trust-disk + undeclared + hasIdentity:false + identityStore:'missing' +
  // identityStoreRequired:false → step 5 not triggered (not required), step 9
  // (no model anchor) → warn partial-identity.
  {
    name: 'trust-disk + undeclared + no model + store missing + not required → warn partial-identity',
    tier: 'trust-disk',
    claim: CLAIM_UNDECLARED,
    assessment: assess({
      hasIdentity: false,
      identityStore: 'missing',
      identityStoreRequired: false,
    }),
    state: state(),
    expected: { kind: 'proceed-with-warning', warning: 'partial-identity' },
  },
  // verify + declared + identityStore:'unwritable' + no model → step 4 skipped
  // (declared), step 6 skipped (not missing), step 7 skipped (no mismatch),
  // step 8 skipped (no unsupportedReason), step 9 (no model) → partial-identity.
  {
    name: 'verify + declared + unwritable store + no model → warn partial-identity',
    tier: 'verify',
    claim: CLAIM_DECLARED,
    assessment: assess({ hasIdentity: false, identityStore: 'unwritable' }),
    state: state(),
    expected: { kind: 'proceed-with-warning', warning: 'partial-identity' },
  },
];

describe('decideAddOutcome: doc-045 §A scenario matrix', () => {
  for (const row of ROWS) {
    it(row.name, () => {
      const outcome = decideAddOutcome(
        row.tier,
        row.claim,
        row.assessment,
        row.state,
        row.forced ?? false
      );
      expect(outcome).toMatchObject(row.expected);
    });
  }

  it(`covers ${ROWS.length} matrix rows`, () => {
    expect(ROWS.length).toBeGreaterThanOrEqual(27);
  });
});

// =============================================================================
// Structural invariants
// =============================================================================

describe('decideAddOutcome: structural invariants', () => {
  const tiers: VerificationTier[] = ['verify', 'trust-disk', 'config-inject'];
  const claims: DeviceClaim[] = [CLAIM_DECLARED, CLAIM_UNDECLARED];
  const assessments: (DeviceAssessmentView | null)[] = [
    null,
    assess(),
    assess({ hasIdentity: false, identityStore: 'unwritable' }),
    assess({ identityStore: 'missing', identityStoreRequired: true }),
    assess({ identityStore: 'not-applicable', identityStoreRequired: false }),
    assess({ unsupportedReason: { kind: 'ios-device', headline: 'iOS device' } }),
  ];
  const states: DeviceStateView[] = [
    state(),
    state({ volumeUuid: '' }),
    state({ platform: 'linux', filesystem: 'hfsplus' }),
    state({ crossCheck: 'mismatch' }),
  ];

  it('never throws and is total over the cross product', () => {
    const seenKinds = new Set<string>();
    for (const tier of tiers) {
      for (const claim of claims) {
        for (const a of assessments) {
          for (const s of states) {
            for (const forced of [false, true]) {
              const outcome = decideAddOutcome(tier, claim, a, s, forced);
              expect(outcome).toBeDefined();
              expect(typeof outcome.kind).toBe('string');
              seenKinds.add(outcome.kind);
            }
          }
        }
      }
    }
    // The cross product exercises a broad slice of the union.
    expect(seenKinds.size).toBeGreaterThanOrEqual(6);
  });
});
