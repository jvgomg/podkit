/**
 * Unit tests for the database-layer identity check.
 *
 * The canonical positive is an iPod shuffle 2G whose serial suffix libgpod
 * does not know (`6V925GZ9436`) and which carries no classic SysInfo: the
 * database layer reports `generation: 'unknown'` while podkit's own tables
 * resolve the device to `A947` — 1GB Pink shuffle 2G. Left uncorrected, the
 * database layer skips the shuffle playback-database write entirely, so the
 * device receives tracks it can never play while the write reports success.
 *
 * Everything is driven through injected seams (a synthetic database view, an
 * in-memory SysInfoExtended reader, an in-memory filesystem), so no disk is
 * touched and no module-level mock leaks into sibling test files.
 *
 * Cases covered:
 *
 *   - Shuffle 2G shape: database layer blind, cascade resolves → warn, repairable.
 *   - Database layer already resolved the model → pass, not repairable.
 *   - No database open → skip.
 *   - No firmware truth at all → warn but NOT repairable (nothing to write).
 *   - Firmware truth without a model number (USB-only) → warn, NOT repairable.
 *   - Repair dry-run reports the value without calling setSysInfo/save.
 *   - Repair live run sets the M-prefixed ModelNumStr and saves.
 *   - Repair refuses when the cascade has nothing hardware-attested — the
 *     never-fabricate rule.
 *   - Repair backs up an existing classic SysInfo before the layer rewrites it.
 */

import { describe, it, expect } from 'bun:test';
import type { SysInfoExtendedResult } from '@podkit/ipod-firmware';
import type { IpodModel } from '@podkit/devices-ipod';
import type { DiagnosticContext, LiveDeviceIdentity, RepairContext } from '../types.js';
import {
  checkSysinfoModelnumMissing,
  runSysinfoModelnumMissingRepair,
  sysinfoModelnumMissingCheck,
} from './sysinfo-modelnum-missing.js';
import type { SieReader } from './firmware-truth.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const MOUNT = '/Volumes/IPOD';

/** Real hardware: pink 1GB shuffle 2G whose suffix libgpod's table lacks. */
const SHUFFLE_2G_SERIAL = '6V925GZ9436';

interface FakeDb {
  device: { generation: string; modelName: string };
  setSysInfo: (field: string, value: string | null) => void;
  save: () => Promise<void>;
  written: Array<{ field: string; value: string | null }>;
  saveCount: number;
}

function makeDb(generation: string, modelName = 'Unknown'): FakeDb {
  const db: FakeDb = {
    device: { generation, modelName },
    written: [],
    saveCount: 0,
    setSysInfo(field, value) {
      db.written.push({ field, value });
      // The real layer re-resolves identity from the value it was given.
      if (field === 'ModelNumStr' && value) db.device.generation = 'shuffle_2';
    },
    async save() {
      db.saveCount += 1;
    },
  };
  return db;
}

function makeSieResult(serialNumber: string): SysInfoExtendedResult {
  return {
    present: true,
    source: 'existing',
    identity: { serialNumber },
    serialNumber,
  };
}

const sieReader =
  (result: SysInfoExtendedResult | null): SieReader =>
  () =>
    result;

function makeCtx(db: FakeDb | undefined, liveIdentity?: LiveDeviceIdentity): DiagnosticContext {
  return {
    mountPoint: MOUNT,
    deviceType: 'ipod',
    ...(db ? { db: db as unknown as DiagnosticContext['db'] } : {}),
    ...(liveIdentity ? { liveIdentity } : {}),
  };
}

function makeRepairCtx(db: FakeDb | undefined): RepairContext {
  return { ...makeCtx(db), adapters: [] };
}

/** USB-derived model: generation only, so it carries no model number. */
const SHUFFLE_2G_USB_MODEL: IpodModel = {
  displayName: 'iPod shuffle (2nd Generation)',
  generationId: 'shuffle_2g',
  family: 'iPod shuffle',
  ordinal: 2,
  checksumType: 'none',
  source: 'usb',
};

/** Filesystem where the classic SysInfo file does not exist. */
const NO_SYSINFO = { existsSync: () => false, copyFileSync: () => {}, mkdirSync: () => {} };

// ── Check metadata ───────────────────────────────────────────────────────────

describe('sysinfoModelnumMissingCheck metadata', () => {
  it('is an iPod-only database-health check with a repair', () => {
    expect(sysinfoModelnumMissingCheck.id).toBe('sysinfo-modelnum-missing');
    expect(sysinfoModelnumMissingCheck.scope).toBe('database-health');
    expect(sysinfoModelnumMissingCheck.applicableTo).toEqual(['ipod']);
    expect(sysinfoModelnumMissingCheck.repair).toBeDefined();
  });

  it('requires the open database, because the identity must land in memory too', () => {
    expect(sysinfoModelnumMissingCheck.repair?.requirements).toContain('database');
    expect(sysinfoModelnumMissingCheck.repair?.requirements).toContain('writable-device');
  });
});

// ── Check ────────────────────────────────────────────────────────────────────

describe('checkSysinfoModelnumMissing', () => {
  it('skips when no database is open', async () => {
    const result = await checkSysinfoModelnumMissing(makeCtx(undefined), sieReader(null));
    expect(result.status).toBe('skip');
    expect(result.repairable).toBe(false);
  });

  it('passes when the database layer already resolved a generation', async () => {
    const result = await checkSysinfoModelnumMissing(
      makeCtx(makeDb('nano_3', 'iPod nano (Silver)')),
      sieReader(null)
    );
    expect(result.status).toBe('pass');
    expect(result.repairable).toBe(false);
    expect(result.details?.databaseGeneration).toBe('nano_3');
  });

  it('warns and offers repair for a shuffle 2G the database layer cannot identify', async () => {
    const result = await checkSysinfoModelnumMissing(
      makeCtx(makeDb('unknown')),
      sieReader(makeSieResult(SHUFFLE_2G_SERIAL))
    );
    expect(result.status).toBe('warn');
    expect(result.repairable).toBe(true);
    expect(result.details?.firmwareGenerationId).toBe('shuffle_2g');
    expect(result.details?.firmwareModelNumber).toBe('A947');
    // The M-prefixed form is what the database layer's own lookup expects.
    expect(result.details?.proposedModelNumStr).toBe('MA947');
  });

  it('warns without offering repair when podkit cannot identify the device either', async () => {
    const result = await checkSysinfoModelnumMissing(makeCtx(makeDb('unknown')), sieReader(null));
    expect(result.status).toBe('warn');
    expect(result.repairable).toBe(false);
  });

  it('warns without offering repair when the only identity is USB-derived', async () => {
    // A USB-derived model names the generation but carries no model number,
    // and the database layer accepts nothing else.
    const result = await checkSysinfoModelnumMissing(
      makeCtx(makeDb('unknown'), { model: SHUFFLE_2G_USB_MODEL }),
      sieReader(null)
    );
    expect(result.status).toBe('warn');
    expect(result.repairable).toBe(false);
    expect(result.details?.firmwareGenerationId).toBe('shuffle_2g');
  });
});

// ── Repair ───────────────────────────────────────────────────────────────────

describe('runSysinfoModelnumMissingRepair', () => {
  it('reports the value it would write without touching the database in dry-run', async () => {
    const db = makeDb('unknown');
    const result = await runSysinfoModelnumMissingRepair(
      makeRepairCtx(db),
      { dryRun: true },
      sieReader(makeSieResult(SHUFFLE_2G_SERIAL)),
      NO_SYSINFO
    );
    expect(result.success).toBe(true);
    expect(result.details?.modelNumStr).toBe('MA947');
    expect(db.written).toEqual([]);
    expect(db.saveCount).toBe(0);
  });

  it('writes the hardware-attested model number and saves', async () => {
    const db = makeDb('unknown');
    const result = await runSysinfoModelnumMissingRepair(
      makeRepairCtx(db),
      undefined,
      sieReader(makeSieResult(SHUFFLE_2G_SERIAL)),
      NO_SYSINFO
    );
    expect(result.success).toBe(true);
    expect(db.written).toEqual([{ field: 'ModelNumStr', value: 'MA947' }]);
    expect(db.saveCount).toBe(1);
    expect(result.details?.firmwareGenerationId).toBe('shuffle_2g');
  });

  it('refuses when there is no hardware-attested model number to write', async () => {
    const db = makeDb('unknown');
    const result = await runSysinfoModelnumMissingRepair(
      makeRepairCtx(db),
      undefined,
      sieReader(null),
      NO_SYSINFO
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain('will not invent');
    expect(db.written).toEqual([]);
    expect(db.saveCount).toBe(0);
  });

  it('refuses when the only identity is USB-derived and carries no model number', async () => {
    const db = makeDb('unknown');
    const ctx: RepairContext = {
      ...makeCtx(db, { model: SHUFFLE_2G_USB_MODEL }),
      adapters: [],
    };
    const result = await runSysinfoModelnumMissingRepair(
      ctx,
      undefined,
      sieReader(null),
      NO_SYSINFO
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain('will not invent');
    expect(db.written).toEqual([]);
  });

  it('is a no-op when the database layer already knows the device', async () => {
    const db = makeDb('shuffle_2', 'iPod shuffle');
    const result = await runSysinfoModelnumMissingRepair(
      makeRepairCtx(db),
      undefined,
      sieReader(makeSieResult(SHUFFLE_2G_SERIAL)),
      NO_SYSINFO
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain('no change needed');
    expect(db.written).toEqual([]);
  });

  it('creates the device directory before saving', async () => {
    // libgpod resolves `iPod_Control/Device` but never creates it, and drops
    // the SysInfo write silently when it is missing — while still reporting a
    // successful save. The directory has to exist before `save()` runs.
    const db = makeDb('unknown');
    const made: string[] = [];
    const result = await runSysinfoModelnumMissingRepair(
      makeRepairCtx(db),
      undefined,
      sieReader(makeSieResult(SHUFFLE_2G_SERIAL)),
      { existsSync: () => false, copyFileSync: () => {}, mkdirSync: (p) => void made.push(p) }
    );
    expect(result.success).toBe(true);
    expect(made).toHaveLength(1);
    expect(made[0]).toEndWith('/iPod_Control/Device');
  });

  it('refuses without writing when the device directory cannot be created', async () => {
    const db = makeDb('unknown');
    const result = await runSysinfoModelnumMissingRepair(
      makeRepairCtx(db),
      undefined,
      sieReader(makeSieResult(SHUFFLE_2G_SERIAL)),
      {
        existsSync: () => false,
        copyFileSync: () => {},
        mkdirSync: () => {
          throw new Error('read-only filesystem');
        },
      }
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain('read-only filesystem');
    expect(db.written).toEqual([]);
    expect(db.saveCount).toBe(0);
  });

  it('backs up an existing classic SysInfo before the layer rewrites it', async () => {
    const db = makeDb('unknown');
    const copies: Array<[string, string]> = [];
    const result = await runSysinfoModelnumMissingRepair(
      makeRepairCtx(db),
      undefined,
      sieReader(makeSieResult(SHUFFLE_2G_SERIAL)),
      {
        existsSync: () => true,
        copyFileSync: (src: string, dest: string) => {
          copies.push([src, dest]);
        },
        mkdirSync: () => {},
      }
    );
    expect(result.success).toBe(true);
    expect(copies).toHaveLength(1);
    expect(copies[0]![1]).toEndWith('SysInfo.podkit-backup');
  });

  it('fails without writing when no database is open', async () => {
    const result = await runSysinfoModelnumMissingRepair(
      makeRepairCtx(undefined),
      undefined,
      sieReader(makeSieResult(SHUFFLE_2G_SERIAL)),
      NO_SYSINFO
    );
    expect(result.success).toBe(false);
  });
});
