/**
 * Pins the public-ID → internal-check-ID dispatch table.
 *
 * Every test here documents one of the two public surfaces the CLI exposes:
 *
 * 1. Public IDs map 1:1 to internal IDs for the well-known checks.
 * 2. The "unified" IDs (`orphan-files`, `debris-files`) dispatch by device
 *    type to a device-specific internal check.
 */

import { describe, it, expect } from 'bun:test';
import {
  PUBLIC_REPAIR_IDS,
  resolvePublicRepairId,
  getRepairCheck,
  getRepairCheckForValidation,
  runDiagnosticRepair,
  assessRepairRefusal,
} from './repair-dispatch.js';
import type { DiagnosticCheck, RepairContext, RepairResult } from './types.js';
import type { IpodIdentityAssessment } from '../device/ipod-identity.js';
import type { ReadinessUnsupportedReason } from '@podkit/device-types';

describe('PUBLIC_REPAIR_IDS', () => {
  it('lists every public ID the CLI advertises', () => {
    // Stability test — adding/removing a public ID is a user-facing change.
    expect([...PUBLIC_REPAIR_IDS].sort()).toEqual([
      'artwork-rebuild',
      'artwork-reset',
      'debris-files',
      'debris-transcode-tmp',
      'orphan-files',
      'sysinfo-consistency',
      'sysinfo-extended',
      'sysinfo-modelnum-mismatch',
      'udev-rule',
    ]);
  });

  it('does NOT list the legacy device-suffixed IDs', () => {
    expect(PUBLIC_REPAIR_IDS).not.toContain('orphan-files-mass-storage');
    expect(PUBLIC_REPAIR_IDS).not.toContain('debris-files-mass-storage');
    expect(PUBLIC_REPAIR_IDS).not.toContain('debris-files-ipod');
  });
});

describe('resolvePublicRepairId', () => {
  describe('unified orphan-files dispatch', () => {
    it('dispatches orphan-files to the iPod check on iPod', () => {
      expect(resolvePublicRepairId('orphan-files', 'ipod')).toBe('orphan-files');
    });

    it('dispatches orphan-files to the mass-storage check on mass-storage', () => {
      expect(resolvePublicRepairId('orphan-files', 'mass-storage')).toBe(
        'orphan-files-mass-storage'
      );
    });
  });

  describe('unified debris-files dispatch', () => {
    it('dispatches debris-files to the iPod check on iPod', () => {
      expect(resolvePublicRepairId('debris-files', 'ipod')).toBe('debris-files-ipod');
    });

    it('dispatches debris-files to the mass-storage check on mass-storage', () => {
      expect(resolvePublicRepairId('debris-files', 'mass-storage')).toBe(
        'debris-files-mass-storage'
      );
    });
  });

  describe('passthrough IDs', () => {
    it.each([
      'artwork-rebuild',
      'artwork-reset',
      'debris-transcode-tmp',
      'sysinfo-consistency',
      'sysinfo-extended',
      'sysinfo-modelnum-mismatch',
      'udev-rule',
    ])('passes %s through unchanged for both device types', (id) => {
      expect(resolvePublicRepairId(id, 'ipod')).toBe(id);
      expect(resolvePublicRepairId(id, 'mass-storage')).toBe(id);
    });
  });
});

describe('getRepairCheck', () => {
  it('returns the iPod orphan check when called with (orphan-files, ipod)', () => {
    const check = getRepairCheck('orphan-files', 'ipod');
    expect(check?.id).toBe('orphan-files');
    expect(check?.applicableTo).toContain('ipod');
  });

  it('returns the mass-storage orphan check when called with (orphan-files, mass-storage)', () => {
    const check = getRepairCheck('orphan-files', 'mass-storage');
    expect(check?.id).toBe('orphan-files-mass-storage');
    expect(check?.applicableTo).toContain('mass-storage');
  });

  it('returns the iPod debris check when called with (debris-files, ipod)', () => {
    const check = getRepairCheck('debris-files', 'ipod');
    expect(check?.id).toBe('debris-files-ipod');
  });

  it('returns the mass-storage debris check when called with (debris-files, mass-storage)', () => {
    const check = getRepairCheck('debris-files', 'mass-storage');
    expect(check?.id).toBe('debris-files-mass-storage');
  });

  it('returns undefined for unknown public IDs', () => {
    expect(getRepairCheck('not-a-check', 'ipod')).toBeUndefined();
  });
});

describe('getRepairCheckForValidation', () => {
  it('returns a check (iPod variant) for unified IDs — early validation', () => {
    // Used before device resolution; both variants of a unified ID share
    // scope + CLI-visible requirements so the iPod variant is a safe proxy.
    const check = getRepairCheckForValidation('debris-files');
    expect(check?.applicableTo).toContain('ipod');
    expect(check?.scope).toBe('database-health');
  });

  it('returns the only variant for non-unified IDs', () => {
    expect(getRepairCheckForValidation('artwork-rebuild')?.id).toBe('artwork-rebuild');
    expect(getRepairCheckForValidation('debris-transcode-tmp')?.id).toBe('debris-transcode-tmp');
  });

  // Catches the drift mode where someone removes/renames an internal check
  // but the dispatch table still points at the old ID — the CLI would then
  // accept the public ID at the `--repair <id>` choices() gate but fail
  // late inside `runDoctorAction` with a confusing "Unknown check" message.
  it('every PUBLIC_REPAIR_IDS entry resolves to a registered check', () => {
    const unresolved: string[] = [];
    for (const id of PUBLIC_REPAIR_IDS) {
      if (!getRepairCheckForValidation(id)) unresolved.push(id);
    }
    expect(unresolved).toEqual([]);
  });

  it('every PUBLIC_REPAIR_IDS entry has a repair (otherwise --repair X would fail late)', () => {
    const nonRepairable: string[] = [];
    for (const id of PUBLIC_REPAIR_IDS) {
      const check = getRepairCheckForValidation(id);
      if (!check?.repair) nonRepairable.push(id);
    }
    expect(nonRepairable).toEqual([]);
  });

  it('pins that orphan-files variants have divergent requirements (intentional)', () => {
    // The iPod orphan check declares a 'database' requirement because it
    // walks the iTunesDB; the mass-storage variant does not (manifest is
    // a flat JSON file, not a libgpod handle). This divergence is
    // intentional and must NOT be relied on for CLI early validation —
    // the CLI only consults 'source-collection' and empty-set
    // (system-repair fast path) from the requirements array.
    const ipod = getRepairCheck('orphan-files', 'ipod');
    const ms = getRepairCheck('orphan-files', 'mass-storage');
    expect(ipod?.repair?.requirements).toContain('writable-device');
    expect(ipod?.repair?.requirements).toContain('database');
    expect(ms?.repair?.requirements).toContain('writable-device');
    expect(ms?.repair?.requirements).not.toContain('database');
    // Both share the CLI-visible signals: neither needs source-collection.
    expect(ipod?.repair?.requirements).not.toContain('source-collection');
    expect(ms?.repair?.requirements).not.toContain('source-collection');
  });
});

// ── runDiagnosticRepair ───────────────────────────────────────────────────

/**
 * Build a fake check whose repair.run is observable, so refusal-skip and
 * ok/failed branches can be asserted on whether (and with what) repair.run
 * was invoked.
 */
function makeFakeCheck(opts: {
  id?: string;
  result?: RepairResult;
  throwInsteadOfReturning?: Error;
  recordCallsInto?: Array<{ ctx: RepairContext }>;
}): DiagnosticCheck {
  const id = opts.id ?? 'fake-check';
  return {
    id,
    name: 'Fake Check',
    scope: 'database-health',
    applicableTo: ['ipod'],
    check: async () => ({ status: 'pass', summary: 'fake pass', repairable: true }),
    repair: {
      description: 'fake repair',
      requirements: [],
      run: async (ctx) => {
        opts.recordCallsInto?.push({ ctx });
        if (opts.throwInsteadOfReturning) throw opts.throwInsteadOfReturning;
        return opts.result ?? { success: true, summary: 'fake done' };
      },
    },
  };
}

const UNSUPPORTED_REASON: ReadinessUnsupportedReason = {
  kind: 'ios-device',
  headline: 'iOS device not supported by podkit.',
  details: ['Use Apple Music / Finder to sync this device.'],
  docsUrl: 'https://example.test/docs/supported-devices',
};

function ipodCtx(mountPoint = '/Volumes/iPod'): RepairContext {
  return { mountPoint, deviceType: 'ipod', adapters: [] };
}

function massStorageCtx(mountPoint = '/Volumes/EchoMini'): RepairContext {
  return { mountPoint, deviceType: 'mass-storage', adapters: [] };
}

describe('runDiagnosticRepair — refusal pre-flight', () => {
  it('returns { status: refused, reason } when assessment carries unsupportedReason', async () => {
    const check = makeFakeCheck({});
    const result = await runDiagnosticRepair(check, ipodCtx(), undefined, {
      assessIpodIdentity: async () =>
        ({
          model: { unsupportedReason: UNSUPPORTED_REASON },
        }) as unknown as IpodIdentityAssessment,
    });

    expect(result.status).toBe('refused');
    if (result.status === 'refused') {
      expect(result.checkId).toBe('fake-check');
      expect(result.reason).toEqual(UNSUPPORTED_REASON);
    }
  });

  it('does NOT call check.repair.run on refusal', async () => {
    // Critical contract: pinned because a stray re-order or future refactor
    // could re-enable the call. doctor.ts:1308 today gates IpodDatabase.open
    // on the same refusal — leak-by-drift here would silently re-open the
    // database against a refused device.
    const calls: Array<{ ctx: RepairContext }> = [];
    const check = makeFakeCheck({ recordCallsInto: calls });
    await runDiagnosticRepair(check, ipodCtx(), undefined, {
      assessIpodIdentity: async () =>
        ({
          model: { unsupportedReason: UNSUPPORTED_REASON },
        }) as unknown as IpodIdentityAssessment,
    });

    expect(calls).toHaveLength(0);
  });

  it('skips the pre-flight for mass-storage devices (no cascade applies)', async () => {
    let assessCalls = 0;
    const check = makeFakeCheck({});
    const result = await runDiagnosticRepair(check, massStorageCtx(), undefined, {
      assessIpodIdentity: async () => {
        assessCalls++;
        return {} as IpodIdentityAssessment;
      },
    });

    expect(assessCalls).toBe(0);
    expect(result.status).toBe('ok');
  });

  it('skips the pre-flight when mountPoint is empty (system-scope repairs)', async () => {
    let assessCalls = 0;
    const check = makeFakeCheck({});
    const result = await runDiagnosticRepair(
      check,
      { mountPoint: '', deviceType: 'ipod', adapters: [] },
      undefined,
      {
        assessIpodIdentity: async () => {
          assessCalls++;
          return {} as IpodIdentityAssessment;
        },
      }
    );

    expect(assessCalls).toBe(0);
    expect(result.status).toBe('ok');
  });

  it('falls through to repair.run when assessment throws (best-effort pre-flight)', async () => {
    const calls: Array<{ ctx: RepairContext }> = [];
    const check = makeFakeCheck({ recordCallsInto: calls });
    const result = await runDiagnosticRepair(check, ipodCtx(), undefined, {
      assessIpodIdentity: async () => {
        throw new Error('USB resolution unavailable');
      },
    });

    expect(calls).toHaveLength(1);
    expect(result.status).toBe('ok');
  });

  it('falls through to repair.run when assessment returns no unsupportedReason', async () => {
    const calls: Array<{ ctx: RepairContext }> = [];
    const check = makeFakeCheck({ recordCallsInto: calls });
    const result = await runDiagnosticRepair(check, ipodCtx(), undefined, {
      assessIpodIdentity: async () =>
        ({
          model: { unsupportedReason: undefined },
        }) as unknown as IpodIdentityAssessment,
    });

    expect(calls).toHaveLength(1);
    expect(result.status).toBe('ok');
  });

  it('falls through when assessment returns model: null (unidentified device)', async () => {
    // assessIpodIdentity resolves to `model: null` when neither USB nor disk
    // identifiers yield a match. The optional-chain on `assessment.model`
    // must short-circuit cleanly to `reason === undefined` rather than
    // crash — pinned so a future edit that drops the `?.` (e.g.
    // `assessment.model.unsupportedReason`) would fail loudly here instead
    // of being swallowed by the best-effort catch.
    const calls: Array<{ ctx: RepairContext }> = [];
    const check = makeFakeCheck({ recordCallsInto: calls });
    const result = await runDiagnosticRepair(check, ipodCtx(), undefined, {
      assessIpodIdentity: async () => ({ model: null }) as unknown as IpodIdentityAssessment,
    });

    expect(calls).toHaveLength(1);
    expect(result.status).toBe('ok');
  });
});

describe('runDiagnosticRepair — result wrapping', () => {
  it('wraps RepairResult.success=true into { status: ok, summary, details }', async () => {
    const check = makeFakeCheck({
      result: { success: true, summary: 'repaired 12 entries', details: { fixed: 12 } },
    });
    const result = await runDiagnosticRepair(check, massStorageCtx());

    expect(result).toEqual({
      status: 'ok',
      checkId: 'fake-check',
      summary: 'repaired 12 entries',
      details: { fixed: 12 },
    });
  });

  it('wraps RepairResult.success=false into { status: failed, summary, details }', async () => {
    const check = makeFakeCheck({
      result: { success: false, summary: 'could not open database', details: { reason: 'locked' } },
    });
    const result = await runDiagnosticRepair(check, massStorageCtx());

    expect(result).toEqual({
      status: 'failed',
      checkId: 'fake-check',
      summary: 'could not open database',
      details: { reason: 'locked' },
    });
  });

  it('omits details from the wrapped result when RepairResult.details is undefined', async () => {
    const check = makeFakeCheck({ result: { success: true, summary: 'done' } });
    const result = await runDiagnosticRepair(check, massStorageCtx());

    expect(result).toEqual({
      status: 'ok',
      checkId: 'fake-check',
      summary: 'done',
    });
  });

  it('propagates exceptions thrown by repair.run (unexpected execution failure)', async () => {
    const check = makeFakeCheck({ throwInsteadOfReturning: new Error('boom') });
    await expect(runDiagnosticRepair(check, massStorageCtx())).rejects.toThrow('boom');
  });
});

describe('assessRepairRefusal', () => {
  it('returns the reason when assessment carries unsupportedReason', async () => {
    const reason = await assessRepairRefusal(ipodCtx(), {
      assessIpodIdentity: async () =>
        ({
          model: { unsupportedReason: UNSUPPORTED_REASON },
        }) as unknown as IpodIdentityAssessment,
    });
    expect(reason).toEqual(UNSUPPORTED_REASON);
  });

  it('returns null for supported devices', async () => {
    const reason = await assessRepairRefusal(ipodCtx(), {
      assessIpodIdentity: async () =>
        ({ model: { unsupportedReason: undefined } }) as unknown as IpodIdentityAssessment,
    });
    expect(reason).toBeNull();
  });

  it('returns null for model: null (unidentified)', async () => {
    const reason = await assessRepairRefusal(ipodCtx(), {
      assessIpodIdentity: async () => ({ model: null }) as unknown as IpodIdentityAssessment,
    });
    expect(reason).toBeNull();
  });

  it('returns null for mass-storage ctx without consulting the assessor', async () => {
    let calls = 0;
    const reason = await assessRepairRefusal(massStorageCtx(), {
      assessIpodIdentity: async () => {
        calls++;
        return {} as IpodIdentityAssessment;
      },
    });
    expect(reason).toBeNull();
    expect(calls).toBe(0);
  });

  it('returns null for empty mountPoint without consulting the assessor', async () => {
    let calls = 0;
    const reason = await assessRepairRefusal(
      { deviceType: 'ipod', mountPoint: '' },
      {
        assessIpodIdentity: async () => {
          calls++;
          return {} as IpodIdentityAssessment;
        },
      }
    );
    expect(reason).toBeNull();
    expect(calls).toBe(0);
  });

  it('returns null on assessor throw (best-effort)', async () => {
    const reason = await assessRepairRefusal(ipodCtx(), {
      assessIpodIdentity: async () => {
        throw new Error('USB unavailable');
      },
    });
    expect(reason).toBeNull();
  });
});

describe('runDiagnosticRepair — guard', () => {
  it('throws if the check has no repair defined', async () => {
    const checkWithoutRepair: DiagnosticCheck = {
      id: 'no-repair',
      name: 'No Repair Check',
      scope: 'system',
      check: async () => ({ status: 'pass', summary: '', repairable: false }),
    };
    await expect(runDiagnosticRepair(checkWithoutRepair, ipodCtx())).rejects.toThrow(
      'Check "no-repair" has no repair defined'
    );
  });
});
