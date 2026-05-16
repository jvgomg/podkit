/**
 * Unit tests for the SysInfo ModelNumStr vs firmware-serial consistency
 * check (TASK-317.04).
 *
 * Mirrors the test shape of `sysinfo-consistency.test.ts`: the check is
 * driven through an injected classic-SysInfo filesystem reader + injected
 * SysInfoExtended reader, so no real disk is touched and no module-level
 * mock leaks across test files. The injection seams are documented in
 * `sysinfo-modelnum-mismatch.ts` as the production callers leave them
 * unset and get the real implementations from `@podkit/ipod-firmware`.
 *
 * Cases covered:
 *
 *   - TERAPOD shape (MA147 on disk vs V9M serial in SIE) → warn,
 *     repairable, details enumerate both sides.
 *   - Match shape (MA477 on disk vs VQ5 serial → both nano_2g) → pass.
 *   - No ModelNumStr in classic SysInfo → skip (the common case for
 *     untouched devices).
 *   - Classic SysInfo absent entirely → skip.
 *   - ModelNumStr present but unknown → skip (no opinion).
 *   - No firmware truth (no SIE, no live model) → skip.
 *   - Live USB fallback: SIE missing but live USB model present → still
 *     fires warn on TERAPOD-shaped mismatch.
 *   - Repair dry-run prints what would change without touching the file.
 *   - Repair live-run writes a backup + rewrites only the ModelNumStr line.
 *   - Repair refuses when ModelNumStr line is missing.
 *   - Repair short-circuits when on-disk value already matches firmware.
 *
 * Hardware verification (per the task ACs #6 and #7) is deferred to
 * TASK-319 — this Tier-1 coverage is sufficient for the check + repair
 * glue.
 */

import { describe, it, expect } from 'bun:test';
import type { SysInfoExtendedResult } from '@podkit/ipod-firmware';
import type { IpodModel } from '@podkit/devices-ipod';
import type { DiagnosticContext, LiveDeviceIdentity } from '../types.js';
import {
  checkSysinfoModelnumMismatch,
  sysinfoModelnumMismatchCheck,
  runSysinfoModelnumRepair,
  type SysInfoFsReader,
  type SieReader,
} from './sysinfo-modelnum-mismatch.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const MOUNT = '/Volumes/IPOD';
const SYSINFO_FILE = `${MOUNT}/iPod_Control/Device/SysInfo`;

/** Classic SysInfo plain-text content with a `ModelNumStr: ...` line. */
function makeClassicSysInfo(modelNumStr: string | undefined): string {
  if (!modelNumStr) return 'BuildID: 1.3\nFirewireGuid: 000A27001605D1A0\n';
  return `ModelNumStr: ${modelNumStr}\nBuildID: 1.3\nFirewireGuid: 000A27001605D1A0\n`;
}

/**
 * Inject classic-SysInfo content via the SysInfoFsReader passed to the check.
 * Omit `sysInfo` to simulate "classic SysInfo absent".
 */
function makeFs(opts: { sysInfo?: string }): SysInfoFsReader {
  return {
    existsSync: (p: string) => p === SYSINFO_FILE && opts.sysInfo !== undefined,
    readFileSync: (p: string) => {
      if (p === SYSINFO_FILE && opts.sysInfo !== undefined) return opts.sysInfo;
      throw new Error(`unexpected read: ${p}`);
    },
  };
}

function makeCtx(liveIdentity?: LiveDeviceIdentity): DiagnosticContext {
  return { mountPoint: MOUNT, deviceType: 'ipod', liveIdentity };
}

/**
 * Build a `SysInfoExtendedResult` that the injected `sieReader` vends.
 * Carries just the identity fields the firmware-truth resolver inspects —
 * serialNumber for the suffix lookup, plus optionals that the production
 * code may surface in details.
 */
function makeSieResult(opts: {
  serialNumber?: string;
  modelNumStr?: string;
  firewireGuid?: string;
  familyId?: number;
}): SysInfoExtendedResult {
  const identity = {
    ...(opts.firewireGuid ? { firewireGuid: opts.firewireGuid } : {}),
    ...(opts.serialNumber ? { serialNumber: opts.serialNumber } : {}),
    ...(opts.modelNumStr ? { modelNumStr: opts.modelNumStr } : {}),
    ...(opts.familyId !== undefined ? { familyId: opts.familyId } : {}),
  };
  return {
    present: true,
    source: 'existing',
    identity,
    ...(opts.firewireGuid ? { firewireGuid: opts.firewireGuid } : {}),
    ...(opts.serialNumber ? { serialNumber: opts.serialNumber } : {}),
  };
}

/** SIE reader that vends a fixed result (or `null` for "absent"). */
function sieReader(result: SysInfoExtendedResult | null): SieReader {
  return () => result;
}

// Synthetic generation-only models for the liveIdentity fallback path.
const VIDEO_5G_USB_MODEL: IpodModel = {
  displayName: 'iPod 5th generation (Video)',
  generationId: 'video_5g',
  checksumType: 'none',
  source: 'usb',
};

const VIDEO_5_5G_USB_MODEL: IpodModel = {
  displayName: 'iPod 5th generation Late 2006 (Enhanced)',
  generationId: 'video_5_5g',
  checksumType: 'none',
  source: 'usb',
};

const NANO_2G_USB_MODEL: IpodModel = {
  displayName: 'iPod nano 2nd generation',
  generationId: 'nano_2g',
  checksumType: 'none',
  source: 'usb',
};

// ── Check metadata ──────────────────────────────────────────────────────────

describe('sysinfoModelnumMismatchCheck metadata', () => {
  it('has the expected id, scope, applicableTo, and repair shape', () => {
    expect(sysinfoModelnumMismatchCheck.id).toBe('sysinfo-modelnum-mismatch');
    expect(sysinfoModelnumMismatchCheck.scope).toBe('device');
    expect(sysinfoModelnumMismatchCheck.applicableTo).toEqual(['ipod']);
    expect(sysinfoModelnumMismatchCheck.repair).toBeDefined();
  });

  it('repair does NOT declare a database requirement (must run on fresh devices)', () => {
    // Identity-axis repairs run before the iTunesDB is initialised — the
    // chicken-and-egg gate that bit sysinfo-extended. Lock the contract.
    expect(sysinfoModelnumMismatchCheck.repair!.requirements).not.toContain('database');
    expect(sysinfoModelnumMismatchCheck.repair!.requirements).toContain('writable-device');
  });
});

// ── Skip paths ──────────────────────────────────────────────────────────────

describe('checkSysinfoModelnumMismatch — skip paths', () => {
  it('skips when classic SysInfo is absent entirely', async () => {
    const result = await checkSysinfoModelnumMismatch(makeCtx(), makeFs({}), sieReader(null));
    expect(result.status).toBe('skip');
    expect(result.repairable).toBe(false);
    expect(result.summary).toContain('no ModelNumStr');
  });

  it('skips when classic SysInfo has no ModelNumStr line (the common untouched case)', async () => {
    const result = await checkSysinfoModelnumMismatch(
      makeCtx(),
      makeFs({ sysInfo: makeClassicSysInfo(undefined) }),
      sieReader(null)
    );
    expect(result.status).toBe('skip');
    expect(result.summary).toContain('no ModelNumStr');
  });

  it('skips when ModelNumStr is unknown to the lookup table (no opinion)', async () => {
    const result = await checkSysinfoModelnumMismatch(
      makeCtx(),
      makeFs({ sysInfo: makeClassicSysInfo('XX999') }),
      sieReader(null)
    );
    expect(result.status).toBe('skip');
    expect(result.summary).toContain("doesn't resolve");
    expect(result.details?.onDiskModelNumStr).toBe('XX999');
  });

  it('skips when no firmware truth is available (no SIE, no live USB model)', async () => {
    // MA147 → video_5g (a real, resolvable code) but there's nothing to
    // compare against → skip.
    const result = await checkSysinfoModelnumMismatch(
      makeCtx(),
      makeFs({ sysInfo: makeClassicSysInfo('MA147') }),
      sieReader(null)
    );
    expect(result.status).toBe('skip');
    expect(result.summary).toContain('No firmware-derived identity');
    expect(result.details?.onDiskModelNumStr).toBe('MA147');
    expect(result.details?.onDiskGenerationId).toBe('video_5g');
  });
});

// ── Match paths (pass) ──────────────────────────────────────────────────────

describe('checkSysinfoModelnumMismatch — match paths', () => {
  it('passes when on-disk ModelNumStr and SIE serial both resolve to the same generation', async () => {
    // MA477 → nano_2g; serial suffix VQ5 → A477 → nano_2g (real libgpod entry).
    const result = await checkSysinfoModelnumMismatch(
      makeCtx(),
      makeFs({ sysInfo: makeClassicSysInfo('MA477') }),
      sieReader(makeSieResult({ serialNumber: 'XY012345VQ5' }))
    );
    expect(result.status).toBe('pass');
    expect(result.repairable).toBe(false);
    expect(result.details?.onDiskGenerationId).toBe('nano_2g');
    expect(result.details?.firmwareGenerationId).toBe('nano_2g');
    expect(result.details?.firmwareSource).toBe('sysinfo-extended');
    expect(result.details?.firmwareSerialSuffix).toBe('VQ5');
  });

  it('passes when SIE is absent but liveIdentity model agrees with on-disk ModelNumStr', async () => {
    const result = await checkSysinfoModelnumMismatch(
      makeCtx({ model: VIDEO_5G_USB_MODEL }),
      makeFs({ sysInfo: makeClassicSysInfo('MA147') }),
      sieReader(null)
    );
    expect(result.status).toBe('pass');
    expect(result.details?.firmwareSource).toBe('live-usb');
    expect(result.details?.firmwareGenerationId).toBe('video_5g');
  });
});

// ── Mismatch paths (warn) ───────────────────────────────────────────────────

describe('checkSysinfoModelnumMismatch — TERAPOD-shaped mismatch', () => {
  it('warns when on-disk MA147 (video_5g) disagrees with SIE serial V9M (video_5_5g)', async () => {
    // The canonical TERAPOD case: SysInfo manually edited to claim video_5g
    // while the firmware-stamped serial points to video_5_5g.
    const result = await checkSysinfoModelnumMismatch(
      makeCtx(),
      makeFs({ sysInfo: makeClassicSysInfo('MA147') }),
      sieReader(makeSieResult({ serialNumber: '9C642MEFV9M' }))
    );
    expect(result.status).toBe('warn');
    expect(result.repairable).toBe(true);
    // Summary names both sides so the user can see the disagreement at a glance.
    expect(result.summary).toContain('MA147');
    expect(result.summary).toContain('manually edited');
    expect(result.details?.onDiskModelNumStr).toBe('MA147');
    expect(result.details?.onDiskGenerationId).toBe('video_5g');
    expect(result.details?.firmwareGenerationId).toBe('video_5_5g');
    expect(result.details?.firmwareSource).toBe('sysinfo-extended');
    expect(result.details?.firmwareSerialSuffix).toBe('V9M');
    expect(result.details?.firmwareSerialNumber).toBe('9C642MEFV9M');
    expect(result.details?.firmwareModelNumber).toBe('A446');
  });

  it('warns via the live-USB fallback when SIE is missing but liveIdentity disagrees', async () => {
    // SIE absent → fall back to liveIdentity.model. MA147 (video_5g) on
    // disk; live USB-derived video_5_5g → warn.
    const result = await checkSysinfoModelnumMismatch(
      makeCtx({ model: VIDEO_5_5G_USB_MODEL }),
      makeFs({ sysInfo: makeClassicSysInfo('MA147') }),
      sieReader(null)
    );
    expect(result.status).toBe('warn');
    expect(result.repairable).toBe(true);
    expect(result.details?.firmwareSource).toBe('live-usb');
    expect(result.details?.firmwareGenerationId).toBe('video_5_5g');
    // No serial info when falling back to live USB.
    expect(result.details?.firmwareSerialNumber).toBeUndefined();
    expect(result.details?.firmwareSerialSuffix).toBeUndefined();
  });

  it('SIE takes precedence over liveIdentity when both are available and they disagree', async () => {
    // Subtle: the firmware-truth cascade should prefer SIE serial over USB
    // (SIE is firmware-stamped and gives variant detail). If SIE says
    // nano_2g but USB says nano_3g, the firmware truth is SIE (nano_2g).
    // Then if on-disk says video_5g, the warn must report SIE as the
    // firmware source, NOT USB.
    const result = await checkSysinfoModelnumMismatch(
      makeCtx({ model: NANO_2G_USB_MODEL }), // would also be nano_2g
      makeFs({ sysInfo: makeClassicSysInfo('MA147') }), // video_5g
      sieReader(makeSieResult({ serialNumber: 'XY012345VQ5' })) // nano_2g
    );
    expect(result.status).toBe('warn');
    expect(result.details?.firmwareSource).toBe('sysinfo-extended');
    expect(result.details?.firmwareGenerationId).toBe('nano_2g');
  });
});

// ── Repair: dry-run ─────────────────────────────────────────────────────────

describe('runSysinfoModelnumRepair — dry-run', () => {
  it('reports the planned old → new replacement without writing to disk', async () => {
    const writes: Array<{ path: string; data: string }> = [];
    const copies: Array<{ src: string; dest: string }> = [];
    const result = await runSysinfoModelnumRepair(
      { mountPoint: MOUNT, deviceType: 'ipod', adapters: [] },
      { dryRun: true },
      {
        existsSync: (p: string) => p === SYSINFO_FILE,
        readFileSync: (_p, _enc) => makeClassicSysInfo('MA147'),
        writeFileSync: (p: string, d: string) => {
          writes.push({ path: p, data: d });
        },
        copyFileSync: (src: string, dest: string) => {
          copies.push({ src, dest });
        },
      },
      sieReader(makeSieResult({ serialNumber: '9C642MEFV9M' }))
    );

    expect(result.success).toBe(true);
    expect(result.summary).toContain('Dry run');
    expect(result.summary).toContain('MA147');
    expect(result.summary).toContain('MA446');
    expect(result.details?.oldValue).toBe('MA147');
    expect(result.details?.newValue).toBe('MA446');
    expect(result.details?.firmwareSource).toBe('sysinfo-extended');
    // Critical: no side effects in dry-run.
    expect(writes).toEqual([]);
    expect(copies).toEqual([]);
  });

  it('still fails the dry-run cleanly when no firmware truth is available', async () => {
    const result = await runSysinfoModelnumRepair(
      { mountPoint: MOUNT, deviceType: 'ipod', adapters: [] },
      { dryRun: true },
      {
        existsSync: (p: string) => p === SYSINFO_FILE,
        readFileSync: () => makeClassicSysInfo('MA147'),
        writeFileSync: () => {
          throw new Error('should not write in dry-run failure path');
        },
        copyFileSync: () => {
          throw new Error('should not copy in dry-run failure path');
        },
      },
      sieReader(null)
    );

    expect(result.success).toBe(false);
    expect(result.summary).toContain('No firmware-derived identity');
  });
});

// ── Repair: live write ──────────────────────────────────────────────────────

describe('runSysinfoModelnumRepair — live overwrite', () => {
  it('backs up the original then rewrites only the ModelNumStr line', async () => {
    const originalSysInfo = makeClassicSysInfo('MA147');
    const writes: Array<{ path: string; data: string }> = [];
    const copies: Array<{ src: string; dest: string }> = [];
    const result = await runSysinfoModelnumRepair(
      { mountPoint: MOUNT, deviceType: 'ipod', adapters: [] },
      undefined,
      {
        existsSync: (p: string) => p === SYSINFO_FILE,
        readFileSync: () => originalSysInfo,
        writeFileSync: (p: string, d: string) => {
          writes.push({ path: p, data: d });
        },
        copyFileSync: (src: string, dest: string) => {
          copies.push({ src, dest });
        },
      },
      sieReader(makeSieResult({ serialNumber: '9C642MEFV9M' }))
    );

    expect(result.success).toBe(true);
    expect(result.summary).toContain('MA147');
    expect(result.summary).toContain('MA446');
    expect(result.summary).toContain('backed up');
    // Exactly one backup → one write to the same path.
    expect(copies).toEqual([{ src: SYSINFO_FILE, dest: `${SYSINFO_FILE}.podkit-backup` }]);
    expect(writes.length).toBe(1);
    expect(writes[0]!.path).toBe(SYSINFO_FILE);
    // Only the ModelNumStr line should change; everything else preserved.
    expect(writes[0]!.data).toContain('ModelNumStr: MA446');
    expect(writes[0]!.data).not.toContain('ModelNumStr: MA147');
    expect(writes[0]!.data).toContain('BuildID: 1.3');
    expect(writes[0]!.data).toContain('FirewireGuid: 000A27001605D1A0');
    // Details surface enough for downstream consumers.
    expect(result.details?.backupPath).toBe(`${SYSINFO_FILE}.podkit-backup`);
    expect(result.details?.oldValue).toBe('MA147');
    expect(result.details?.newValue).toBe('MA446');
    expect(result.details?.firmwareSource).toBe('sysinfo-extended');
    expect(result.details?.firmwareGenerationId).toBe('video_5_5g');
  });

  it('short-circuits to success without writing when on-disk already matches firmware', async () => {
    const writes: Array<{ path: string; data: string }> = [];
    const copies: Array<{ src: string; dest: string }> = [];
    const result = await runSysinfoModelnumRepair(
      { mountPoint: MOUNT, deviceType: 'ipod', adapters: [] },
      undefined,
      {
        existsSync: () => true,
        readFileSync: () => makeClassicSysInfo('MA446'),
        writeFileSync: (p, d) => writes.push({ path: p, data: d }),
        copyFileSync: (src, dest) => copies.push({ src, dest }),
      },
      sieReader(makeSieResult({ serialNumber: '9C642MEFV9M' }))
    );

    expect(result.success).toBe(true);
    expect(result.summary).toContain('already matches');
    // No backup, no write — the file is already correct.
    expect(writes).toEqual([]);
    expect(copies).toEqual([]);
  });

  it('fails when classic SysInfo is absent', async () => {
    const result = await runSysinfoModelnumRepair(
      { mountPoint: MOUNT, deviceType: 'ipod', adapters: [] },
      undefined,
      {
        existsSync: () => false,
        readFileSync: () => {
          throw new Error('should not read');
        },
        writeFileSync: () => {
          throw new Error('should not write');
        },
        copyFileSync: () => {
          throw new Error('should not copy');
        },
      },
      sieReader(null)
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain('not present');
  });

  it('fails when ModelNumStr line is missing from classic SysInfo', async () => {
    const result = await runSysinfoModelnumRepair(
      { mountPoint: MOUNT, deviceType: 'ipod', adapters: [] },
      undefined,
      {
        existsSync: () => true,
        readFileSync: () => makeClassicSysInfo(undefined),
        writeFileSync: () => {
          throw new Error('should not write');
        },
        copyFileSync: () => {
          throw new Error('should not copy');
        },
      },
      sieReader(null)
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain('no ModelNumStr');
  });

  it('fails when firmware truth is USB-only (no model number to write back)', async () => {
    // The live USB model carries `generationId` but no `modelNumber` (the
    // USB descriptor doesn't reveal variant). We can detect the mismatch
    // via this path, but we can't write a precise replacement — the repair
    // must refuse rather than guess. Surfacing the refusal here teaches
    // the user that they need to provide SIE first.
    const result = await runSysinfoModelnumRepair(
      {
        mountPoint: MOUNT,
        deviceType: 'ipod',
        adapters: [],
        liveIdentity: { model: VIDEO_5_5G_USB_MODEL },
      },
      undefined,
      {
        existsSync: () => true,
        readFileSync: () => makeClassicSysInfo('MA147'),
        writeFileSync: () => {
          throw new Error('should not write');
        },
        copyFileSync: () => {
          throw new Error('should not copy');
        },
      },
      sieReader(null)
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain("doesn't carry a model number");
    expect(result.summary).toContain('SysInfoExtended');
  });
});

// ── Real-persona smoke test (captured TERAPOD identity) ────────────────────
//
// The captured TERAPOD SysInfoExtended XML carries SerialNumber
// `9C642MEFV9M` and a single ModelNumStr `A446`. We synthesise the
// SysInfoExtendedResult that the production `readSysInfoExtended` would
// produce against that file and feed it through the injected reader. This
// locks the contract that the production serial-suffix lookup pipeline
// produces the expected `video_5_5g` resolution for the canonical positive
// case — without re-running the XML parser inside the test.

describe('checkSysinfoModelnumMismatch — real TERAPOD identity', () => {
  it('captured SIE identity + synthetic SysInfo(MA147) → warn (video_5g vs video_5_5g)', async () => {
    const result = await checkSysinfoModelnumMismatch(
      makeCtx(),
      makeFs({ sysInfo: makeClassicSysInfo('MA147') }),
      sieReader(
        makeSieResult({
          serialNumber: '9C642MEFV9M',
          firewireGuid: '000A27001605D1A0',
          familyId: 6,
        })
      )
    );

    expect(result.status).toBe('warn');
    expect(result.repairable).toBe(true);
    expect(result.details?.onDiskGenerationId).toBe('video_5g');
    expect(result.details?.firmwareGenerationId).toBe('video_5_5g');
    expect(result.details?.firmwareSerialNumber).toBe('9C642MEFV9M');
    expect(result.details?.firmwareSerialSuffix).toBe('V9M');
  });
});
