/**
 * Database-layer identity check: the iTunesDB layer cannot tell what this iPod is.
 *
 * podkit resolves an iPod's model through its own cascade (SysInfoExtended,
 * classic SysInfo `ModelNumStr`, USB product ID, FamilyID). libgpod — which
 * owns the actual database writes — resolves it through a *narrower* path: its
 * own serial-suffix table, then classic SysInfo `ModelNumStr`. It has no USB
 * product-ID axis and no FamilyID axis. A device whose serial suffix libgpod
 * does not know, and which carries no classic SysInfo, therefore resolves to an
 * unknown generation inside the database layer even when podkit knows exactly
 * what it is.
 *
 * That is not cosmetic. Generation drives real branches in the write path:
 *
 * - whether the shuffle playback database (`iTunesSD`) is written at all — an
 *   unknown generation is not a shuffle, so the write is skipped and the device
 *   receives tracks it cannot play, while the write still reports success;
 * - which `iTunesSD` format is written — an unknown generation falls to the
 *   3g/4g `bdhs` layout, which a 1g/2g shuffle cannot read;
 * - how many music directories to create, and which artwork formats are offered.
 *
 * The fix is to give the database layer the model number podkit already
 * resolved **from the device**. `ModelNumStr` is the one input it accepts, and
 * setting it corrects every generation-keyed branch at once.
 *
 * Provenance rule: the value written must come from hardware — the
 * firmware-stamped `SysInfoExtended` serial resolved through the model tables.
 * When no such value exists, the repair refuses. podkit never invents a model
 * number to satisfy a lookup.
 *
 * Companion to `sysinfo-modelnum-mismatch`, which handles the opposite defect:
 * a `ModelNumStr` that is present but disagrees with the firmware.
 *
 * @module
 */

import { existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SYSINFO_PATH } from '@podkit/ipod-firmware';
import { toModelNumStr } from '@podkit/devices-ipod';
import { defaultSieReader, resolveFirmwareTruth, type SieReader } from './firmware-truth.js';
import { readDatabaseDeviceView } from './database-device-view.js';
import type {
  DiagnosticCheck,
  CheckResult,
  DiagnosticContext,
  RepairContext,
  RepairRunOptions,
  RepairResult,
} from '../types.js';

/**
 * The value libgpod reports when it could not resolve the device to a known
 * generation — either because no model number was available at all, or because
 * the one it found is not in its table. Both land here.
 */
const UNKNOWN_GENERATION = 'unknown';

/** Minimal view of the open database the repair needs. */
interface DatabaseIdentityWriter {
  setSysInfo(field: string, value: string | null): void;
  save(): Promise<void>;
}

/**
 * Run the database-layer identity comparison.
 *
 * Exposed for unit tests so they can drive it with a synthetic database view
 * and an in-memory SysInfoExtended reader, rather than a module-level mock.
 */
export async function checkSysinfoModelnumMissing(
  ctx: DiagnosticContext,
  sieReader: SieReader = defaultSieReader
): Promise<CheckResult> {
  const view = readDatabaseDeviceView(ctx.db);
  if (!view) {
    return { status: 'skip', summary: 'No iPod database', repairable: false };
  }

  const generation = view.generation;
  if (generation !== UNKNOWN_GENERATION) {
    return {
      status: 'pass',
      summary: `Database layer identifies this iPod as ${view.modelName} (${generation})`,
      repairable: false,
      details: { databaseGeneration: generation },
    };
  }

  // The database layer is blind. Can podkit see what it cannot?
  const truth = resolveFirmwareTruth(ctx.mountPoint, ctx.liveIdentity, sieReader);
  if (!truth) {
    return {
      status: 'warn',
      summary:
        'The database layer cannot identify this iPod, and no firmware-derived ' +
        'identity is available to tell it — device-specific database writes ' +
        '(shuffle playback database, music directory layout, artwork formats) ' +
        'will take generic defaults',
      repairable: false,
      details: { databaseGeneration: generation },
    };
  }

  if (!truth.model.modelNumber) {
    return {
      status: 'warn',
      summary:
        `The database layer cannot identify this iPod. podkit resolves it as ` +
        `${truth.model.displayName}, but that resolution carries no model number, ` +
        'which is the only identity the database layer accepts',
      repairable: false,
      details: {
        databaseGeneration: generation,
        firmwareGenerationId: truth.model.generationId,
        firmwareDisplayName: truth.model.displayName,
        firmwareSource: truth.source,
      },
    };
  }

  return {
    status: 'warn',
    summary:
      `The database layer cannot identify this iPod, but podkit resolves it as ` +
      `${truth.model.displayName} — device-specific database writes will take ` +
      'generic defaults until SysInfo carries a model number it recognises',
    repairable: true,
    details: {
      databaseGeneration: generation,
      firmwareGenerationId: truth.model.generationId,
      firmwareDisplayName: truth.model.displayName,
      firmwareModelNumber: truth.model.modelNumber,
      firmwareSource: truth.source,
      ...(truth.serialNumber ? { firmwareSerialNumber: truth.serialNumber } : {}),
      ...(truth.serialSuffix ? { firmwareSerialSuffix: truth.serialSuffix } : {}),
      proposedModelNumStr: toModelNumStr(truth.model.modelNumber),
    },
  };
}

/**
 * Write the firmware-derived model number into the device's SysInfo record via
 * the database layer, so its own model resolution starts succeeding.
 *
 * Unlike `sysinfo-modelnum-mismatch`, which edits the classic SysInfo file
 * in place, this repair goes through the database handle: the in-memory device
 * must learn its identity too, not just the file, and `save()` is what pushes
 * both out. That also means the save re-writes the database with the corrected
 * generation in effect — which is the point.
 *
 * Exposed for unit tests via the `repair.run()` adapter below.
 */
export async function runSysinfoModelnumMissingRepair(
  ctx: RepairContext,
  options?: RepairRunOptions,
  sieReader: SieReader = defaultSieReader,
  fs: {
    existsSync: (path: string) => boolean;
    copyFileSync: (src: string, dest: string) => void;
    mkdirSync: (path: string) => void;
  } = { existsSync, copyFileSync, mkdirSync: (p) => void mkdirSync(p, { recursive: true }) }
): Promise<RepairResult> {
  options?.onProgress?.({
    phase: 'reading',
    message: 'Reading firmware identity and database-layer model resolution',
  });

  const db = ctx.db as DatabaseIdentityWriter | undefined;
  const view = readDatabaseDeviceView(ctx.db);
  if (!db || !view) {
    return {
      success: false,
      summary: 'No iPod database is open — cannot write the device model number',
    };
  }

  if (view.generation !== UNKNOWN_GENERATION) {
    return {
      success: true,
      summary:
        `The database layer already identifies this iPod as ${view.modelName} ` +
        `(${view.generation}) — no change needed`,
      details: { databaseGeneration: view.generation },
    };
  }

  const truth = resolveFirmwareTruth(ctx.mountPoint, ctx.liveIdentity, sieReader);
  if (!truth) {
    return {
      success: false,
      summary:
        'No firmware-derived identity available to write (SysInfoExtended missing, ' +
        'or its serial is not in the model tables) — podkit will not invent one',
    };
  }

  if (!truth.model.modelNumber) {
    return {
      success: false,
      summary:
        `podkit resolves this iPod as ${truth.model.displayName}, but that resolution ` +
        'carries no model number — podkit will not invent one',
      details: {
        firmwareGenerationId: truth.model.generationId,
        firmwareSource: truth.source,
      },
    };
  }

  const modelNumStr = toModelNumStr(truth.model.modelNumber);

  if (options?.dryRun) {
    return {
      success: true,
      summary: `Dry run: would set SysInfo ModelNumStr to ${modelNumStr} (${truth.model.displayName})`,
      details: {
        modelNumStr,
        firmwareGenerationId: truth.model.generationId,
        firmwareDisplayName: truth.model.displayName,
        firmwareSource: truth.source,
        ...(truth.serialNumber ? { firmwareSerialNumber: truth.serialNumber } : {}),
      },
    };
  }

  // If a classic SysInfo file already exists, keep a copy: the database layer
  // rewrites the whole file from its in-memory table, so any key it did not
  // parse would be lost. Same backup convention as the sibling repair.
  const sysInfoPath = join(ctx.mountPoint, SYSINFO_PATH);
  const backupPath = `${sysInfoPath}.podkit-backup`;
  let backedUp = false;
  if (fs.existsSync(sysInfoPath)) {
    try {
      fs.copyFileSync(sysInfoPath, backupPath);
      backedUp = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        summary: `Could not back up SysInfo to ${backupPath}: ${msg}`,
        details: { filePath: sysInfoPath, backupPath },
      };
    }
  }

  options?.onProgress?.({
    phase: 'writing',
    message: `Setting SysInfo ModelNumStr to ${modelNumStr}`,
  });

  // libgpod resolves `iPod_Control/Device` but never creates it, and it drops
  // the SysInfo write on the floor if the directory is missing — the save
  // would still report success. Make sure it exists first.
  try {
    fs.mkdirSync(dirname(sysInfoPath));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      summary: `Could not create the device directory for SysInfo: ${msg}`,
      details: { filePath: sysInfoPath },
    };
  }

  try {
    db.setSysInfo('ModelNumStr', modelNumStr);
    await db.save();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      summary: `Could not write the device model number: ${msg}`,
      details: { modelNumStr, ...(backedUp ? { backupPath } : {}) },
    };
  }

  return {
    success: true,
    summary:
      `Set SysInfo ModelNumStr to ${modelNumStr} (${truth.model.displayName}); ` +
      'the database layer can now identify this iPod' +
      (backedUp ? '. Original SysInfo backed up to SysInfo.podkit-backup' : ''),
    details: {
      modelNumStr,
      firmwareGenerationId: truth.model.generationId,
      firmwareDisplayName: truth.model.displayName,
      firmwareSource: truth.source,
      ...(truth.serialNumber ? { firmwareSerialNumber: truth.serialNumber } : {}),
      ...(backedUp ? { backupPath } : {}),
    },
  };
}

// ── Exported check object ────────────────────────────────────────────────────

export const sysinfoModelnumMissingCheck: DiagnosticCheck = {
  id: 'sysinfo-modelnum-missing',
  name: 'Database-layer device identity',
  scope: 'database-health',
  applicableTo: ['ipod'],

  async check(ctx: DiagnosticContext): Promise<CheckResult> {
    return checkSysinfoModelnumMissing(ctx);
  },

  repair: {
    description: 'Give the database layer the firmware-derived model number it cannot resolve',
    // Needs the open database: the identity has to land in the in-memory
    // device as well as on disk, and `save()` is what persists both.
    requirements: ['writable-device', 'database'],
    async run(ctx, options) {
      return runSysinfoModelnumMissingRepair(ctx, options);
    },
  },
};
