/**
 * SysInfo ModelNumStr vs firmware-serial consistency check.
 *
 * Detects when the classic on-disk `iPod_Control/Device/SysInfo` file's
 * `ModelNumStr` claims a different generation than the firmware-stamped
 * identity. The TERAPOD case (iPod 5G Video with iFlash 1TB mod) is the
 * canonical positive: the user manually wrote `ModelNumStr: MA147` (video_5g
 * / 60 GB) into SysInfo, but the firmware-stamped serial is `9C642MEFV9M`
 * → suffix `V9M` → A446 → `video_5_5g`. The cascade in
 * `resolveIpodModel` trusts `modelNumStr` first (correct general-case
 * priority), so podkit silently treats the device as the wrong generation.
 *
 * This check exists to surface that silent misidentification so the user
 * can either correct it (via `--repair sysinfo-modelnum-mismatch`) or
 * acknowledge it. Companion to `sysinfo-consistency`, which compares
 * `SysInfoExtended` vs live USB — that check passes for TERAPOD because
 * SysInfoExtended itself agrees with the USB descriptor; the discrepancy
 * lives in the *classic* SysInfo neighbour.
 *
 * Firmware-truth sourcing:
 *   1. Prefer `SysInfoExtended.SerialNumber` from disk (firmware-stamped at
 *      manufacture; survives clones; gives variant detail via suffix lookup).
 *   2. Fall back to `liveIdentity.model` (USB-derived; generation-only).
 *
 * Trigger rule: fire `warn` only when BOTH the on-disk `ModelNumStr` and a
 * firmware truth resolve to a definite model AND those models disagree at
 * `generationId` granularity. Either side missing → skip (no comparison
 * possible). Either side unresolvable → skip (no spurious warnings on
 * older devices whose serial suffix doesn't appear in the table —
 * `S4G` on mini 2G before commit `c20b7f3` is the canonical regression
 * target).
 *
 * The repair owns its own side effects (filesystem write, backup file) —
 * see `repair.run()` below.
 *
 * @module
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SYSINFO_PATH,
  readSysInfoExtended,
  type SysInfoExtendedResult,
} from '@podkit/ipod-firmware';
import { identify, type IpodModel } from '@podkit/devices-ipod';
import type {
  DiagnosticCheck,
  CheckResult,
  DiagnosticContext,
  RepairContext,
  RepairRunOptions,
  RepairResult,
} from '../types.js';

// ── Injectable filesystem reader (parallels sysinfo-consistency) ─────────────

export interface SysInfoFsReader {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: 'utf-8'): string;
}

const defaultFsReader: SysInfoFsReader = {
  existsSync,
  readFileSync: (p, enc) => readFileSync(p, enc),
};

// ── Firmware-truth source ────────────────────────────────────────────────────

/**
 * Where the firmware-derived model came from. Surfaced in `details` so JSON
 * consumers and downstream tooling know which axis fired.
 *
 * - `'sysinfo-extended'` — derived from `SysInfoExtended.SerialNumber` (richest
 *   source — gives variant info via serial-suffix lookup).
 * - `'live-usb'` — derived from the USB descriptor's product ID (generation-only).
 */
export type FirmwareTruthSource = 'sysinfo-extended' | 'live-usb';

interface FirmwareTruth {
  model: IpodModel;
  source: FirmwareTruthSource;
  /** Serial used for resolution, when source === 'sysinfo-extended'. */
  serialNumber?: string;
  /** Serial-suffix used for the lookup (last 3 chars). */
  serialSuffix?: string;
}

/**
 * Injection seam for the SysInfoExtended reader. Tests pass an in-memory
 * stub so they can drive the firmware-truth resolver without touching disk
 * or installing a module-level mock that leaks across test files.
 *
 * Production callers leave this unset and get the real
 * `readSysInfoExtended` from `@podkit/ipod-firmware`.
 */
export type SieReader = (mountPoint: string) => SysInfoExtendedResult | null;

/**
 * Resolve the firmware-truth model from the richest available source.
 *
 * Reads `SysInfoExtended` first (firmware-stamped serial — most authoritative
 * on-disk identifier); falls back to live USB-derived model when SIE is
 * missing or its serial doesn't resolve.
 *
 * Returns `undefined` when no firmware truth can be obtained — the check
 * then skips, because there's nothing to compare against.
 */
function resolveFirmwareTruth(
  mountPoint: string,
  liveIdentity: { model?: IpodModel } | undefined,
  sieReader: SieReader
): FirmwareTruth | undefined {
  // 1. SysInfoExtended.SerialNumber → suffix lookup
  const sie = sieReader(mountPoint);
  const serial = sie?.identity.serialNumber;
  if (serial && serial.length >= 3) {
    const model = identify({ from: 'serial', serialNumber: serial });
    if (model) {
      return {
        model,
        source: 'sysinfo-extended',
        serialNumber: serial,
        serialSuffix: serial.slice(-3),
      };
    }
  }

  // 2. Live USB-derived model (generation only)
  if (liveIdentity?.model) {
    return { model: liveIdentity.model, source: 'live-usb' };
  }

  return undefined;
}

// ── Classic SysInfo helpers ──────────────────────────────────────────────────

/**
 * Read the classic SysInfo file and extract `ModelNumStr`. Returns `undefined`
 * when the file is absent, unreadable, or doesn't carry a ModelNumStr line.
 *
 * Mirrors the regex used by `@podkit/ipod-firmware`'s `readSysInfoModelNumStr`
 * (private helper there). Kept local because we also need the *raw* file
 * content for the repair's backup + line-replacement, and re-using the
 * private helper would require two reads.
 */
function readClassicSysInfo(
  mountPoint: string,
  fs: SysInfoFsReader
): { content: string; modelNumStr: string | undefined } | undefined {
  const filePath = join(mountPoint, SYSINFO_PATH);
  if (!fs.existsSync(filePath)) return undefined;
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return undefined;
  }
  const match = content.match(/ModelNumStr:\s*(\S+)/);
  return { content, modelNumStr: match?.[1] };
}

// ── Pure check logic ─────────────────────────────────────────────────────────

/**
 * Run the on-disk SysInfo ModelNumStr vs firmware-truth comparison. Exposed
 * for unit tests so they can drive the comparator with synthetic FS reads +
 * synthetic live identity without touching the real filesystem.
 *
 * `sieReader` defaults to `readSysInfoExtended` from `@podkit/ipod-firmware`.
 * Tests pass an in-memory stub to avoid module-level mocks that leak across
 * test files.
 */
export async function checkSysinfoModelnumMismatch(
  ctx: DiagnosticContext,
  fsReader: SysInfoFsReader = defaultFsReader,
  sieReader: SieReader = readSysInfoExtended
): Promise<CheckResult> {
  // 1. Read classic SysInfo + extract ModelNumStr. Absent / no ModelNumStr →
  //    nothing to compare; skip silently. This is the common case for
  //    devices that have never had their SysInfo edited.
  const classic = readClassicSysInfo(ctx.mountPoint, fsReader);
  if (!classic || !classic.modelNumStr) {
    return {
      status: 'skip',
      summary: 'Classic SysInfo has no ModelNumStr to compare against firmware',
      repairable: false,
    };
  }

  // 2. Resolve the on-disk ModelNumStr to a model. Unresolvable (unknown
  //    M-prefix code) → skip; we have no opinion when the table doesn't
  //    know the value.
  const onDiskModel = identify({ from: 'sysinfo', modelNumStr: classic.modelNumStr });
  if (!onDiskModel) {
    return {
      status: 'skip',
      summary: `On-disk SysInfo ModelNumStr ${classic.modelNumStr} doesn't resolve to a known model`,
      repairable: false,
      details: { onDiskModelNumStr: classic.modelNumStr },
    };
  }

  // 3. Resolve firmware truth. SIE serial first, USB-derived model second.
  //    No truth → skip; the cascade has nothing better than ModelNumStr.
  const truth = resolveFirmwareTruth(ctx.mountPoint, ctx.liveIdentity, sieReader);
  if (!truth) {
    return {
      status: 'skip',
      summary:
        'No firmware-derived identity available (no SysInfoExtended serial; no live USB model)',
      repairable: false,
      details: {
        onDiskModelNumStr: classic.modelNumStr,
        onDiskGenerationId: onDiskModel.generationId,
      },
    };
  }

  // 4. Compare at generation granularity. The live USB-derived live model
  //    only resolves to a generation (no capacity/color), so finer-grained
  //    comparison would false-negative on every real iPod.
  if (onDiskModel.generationId === truth.model.generationId) {
    return {
      status: 'pass',
      summary: `SysInfo ModelNumStr ${classic.modelNumStr} agrees with firmware (${truth.model.generationId})`,
      repairable: false,
      details: {
        onDiskModelNumStr: classic.modelNumStr,
        onDiskGenerationId: onDiskModel.generationId,
        firmwareGenerationId: truth.model.generationId,
        firmwareSource: truth.source,
        ...(truth.serialNumber ? { firmwareSerialNumber: truth.serialNumber } : {}),
        ...(truth.serialSuffix ? { firmwareSerialSuffix: truth.serialSuffix } : {}),
      },
    };
  }

  // 5. Mismatch — warn. The device still works; identity is just wrong.
  return {
    status: 'warn',
    summary:
      `SysInfo ModelNumStr ${classic.modelNumStr} (${onDiskModel.displayName}) ` +
      `disagrees with firmware-derived identity (${truth.model.displayName}); ` +
      'classic SysInfo may have been manually edited or copied from another iPod',
    repairable: true,
    details: {
      onDiskModelNumStr: classic.modelNumStr,
      onDiskGenerationId: onDiskModel.generationId,
      onDiskDisplayName: onDiskModel.displayName,
      firmwareGenerationId: truth.model.generationId,
      firmwareDisplayName: truth.model.displayName,
      firmwareSource: truth.source,
      ...(truth.serialNumber ? { firmwareSerialNumber: truth.serialNumber } : {}),
      ...(truth.serialSuffix ? { firmwareSerialSuffix: truth.serialSuffix } : {}),
      ...(truth.model.modelNumber ? { firmwareModelNumber: truth.model.modelNumber } : {}),
    },
  };
}

// ── Repair ───────────────────────────────────────────────────────────────────

/**
 * Rewrite the on-disk `ModelNumStr` line in classic SysInfo using the
 * firmware-derived variant. Backs up the original file to a sibling
 * `SysInfo.podkit-backup` before overwriting.
 *
 * Strategy: minimal in-place line replacement. Only the `ModelNumStr: ...`
 * line is touched; every other line (BuildID, FirewireGuid, etc.) is
 * preserved verbatim. This protects any non-Apple-standard keys some users
 * keep in their SysInfo and avoids accidental drift on capabilities the
 * classic SysInfo carries that we haven't catalogued.
 *
 * Exposed for unit tests via the `repair.run()` adapter below.
 */
export async function runSysinfoModelnumRepair(
  ctx: RepairContext,
  options: RepairRunOptions | undefined,
  fs: {
    existsSync: (path: string) => boolean;
    readFileSync: (path: string, enc: 'utf-8') => string;
    writeFileSync: (path: string, data: string, enc: 'utf-8') => void;
    copyFileSync: (src: string, dest: string) => void;
  } = { existsSync, readFileSync, writeFileSync, copyFileSync },
  sieReader: SieReader = readSysInfoExtended
): Promise<RepairResult> {
  options?.onProgress?.({
    phase: 'reading',
    message: 'Reading classic SysInfo and firmware identity',
  });

  const sysInfoPath = join(ctx.mountPoint, SYSINFO_PATH);
  if (!fs.existsSync(sysInfoPath)) {
    return {
      success: false,
      summary: `Classic SysInfo not present at ${sysInfoPath}`,
      details: { filePath: sysInfoPath },
    };
  }

  let content: string;
  try {
    content = fs.readFileSync(sysInfoPath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      summary: `Classic SysInfo could not be read: ${msg}`,
      details: { filePath: sysInfoPath },
    };
  }

  const match = content.match(/ModelNumStr:\s*(\S+)/);
  if (!match) {
    return {
      success: false,
      summary: 'Classic SysInfo has no ModelNumStr line to rewrite',
      details: { filePath: sysInfoPath },
    };
  }
  const oldValue = match[1]!;

  // Resolve firmware truth using the same cascade as the check.
  const truth = resolveFirmwareTruth(ctx.mountPoint, ctx.liveIdentity, sieReader);
  if (!truth) {
    return {
      success: false,
      summary:
        'No firmware-derived identity available to rewrite ModelNumStr ' +
        '(SysInfoExtended missing or empty; no live USB model)',
      details: { filePath: sysInfoPath, oldValue },
    };
  }

  // The firmware-truth model carries a stripped modelNumber (e.g. `A446`)
  // when it came from a serial-suffix or modelNumStr lookup. The classic
  // SysInfo line stores the M-prefixed form (`MA446`). Re-prefix here so
  // the post-repair file matches what Apple's own SysInfo writers produce.
  if (!truth.model.modelNumber) {
    return {
      success: false,
      summary:
        `Firmware truth (${truth.model.displayName}) doesn't carry a model number — ` +
        'cannot rewrite ModelNumStr (only USB-derived models lack it; need SysInfoExtended)',
      details: { filePath: sysInfoPath, oldValue, firmwareSource: truth.source },
    };
  }
  const newValue = `M${truth.model.modelNumber}`;

  if (oldValue === newValue) {
    return {
      success: true,
      summary: `Classic SysInfo ModelNumStr ${oldValue} already matches firmware — no change needed`,
      details: { filePath: sysInfoPath, value: oldValue },
    };
  }

  if (options?.dryRun) {
    return {
      success: true,
      summary: `Dry run: would rewrite ModelNumStr ${oldValue} → ${newValue} in classic SysInfo`,
      details: {
        filePath: sysInfoPath,
        oldValue,
        newValue,
        firmwareSource: truth.source,
        ...(truth.serialNumber ? { firmwareSerialNumber: truth.serialNumber } : {}),
      },
    };
  }

  // Backup the original file before overwriting. Keep the same directory so
  // the user can find it without a `find` walk; suffix is podkit-specific so
  // it's clear who wrote it. Idempotent — overwrites the backup if a prior
  // repair run already created one.
  const backupPath = `${sysInfoPath}.podkit-backup`;
  try {
    fs.copyFileSync(sysInfoPath, backupPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      summary: `Could not back up SysInfo to ${backupPath}: ${msg}`,
      details: { filePath: sysInfoPath, backupPath },
    };
  }

  options?.onProgress?.({
    phase: 'writing',
    message: `Rewriting ModelNumStr ${oldValue} → ${newValue}`,
  });

  const rewritten = content.replace(/ModelNumStr:\s*\S+/, `ModelNumStr: ${newValue}`);
  try {
    fs.writeFileSync(sysInfoPath, rewritten, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      summary: `Could not write rewritten SysInfo: ${msg}`,
      details: { filePath: sysInfoPath, backupPath },
    };
  }

  return {
    success: true,
    summary:
      `Rewrote classic SysInfo ModelNumStr ${oldValue} → ${newValue} ` +
      `(${truth.model.displayName}); original backed up to SysInfo.podkit-backup`,
    details: {
      filePath: sysInfoPath,
      backupPath,
      oldValue,
      newValue,
      firmwareSource: truth.source,
      firmwareGenerationId: truth.model.generationId,
      firmwareDisplayName: truth.model.displayName,
      ...(truth.serialNumber ? { firmwareSerialNumber: truth.serialNumber } : {}),
    },
  };
}

// ── Exported check object ────────────────────────────────────────────────────

export const sysinfoModelnumMismatchCheck: DiagnosticCheck = {
  id: 'sysinfo-modelnum-mismatch',
  name: 'SysInfo ModelNumStr vs firmware identity',
  scope: 'database-health',
  applicableTo: ['ipod'],

  async check(ctx: DiagnosticContext): Promise<CheckResult> {
    return checkSysinfoModelnumMismatch(ctx);
  },

  repair: {
    description: 'Rewrite classic SysInfo ModelNumStr from firmware-derived identity',
    // No `'database'` requirement — like sysinfo-extended, this repair runs
    // before / independent of the iTunesDB. The classic SysInfo file is
    // identity, not database state.
    requirements: ['writable-device'],
    async run(ctx, options) {
      return runSysinfoModelnumRepair(ctx, options);
    },
  },
};
