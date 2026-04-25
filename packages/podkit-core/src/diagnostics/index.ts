/**
 * Diagnostics framework — extensible health check runner for devices
 *
 * Provides a registry of diagnostic checks that can be run against a device.
 * Each check returns a structured result with pass/fail status, human-readable
 * summary, and optional repair capability. The repair interface describes
 * domain-level requirements without any CLI/UX awareness — the consuming
 * layer (CLI, GUI, etc.) maps requirements to its own UX patterns.
 *
 * Checks declare which device types they apply to via `applicableTo`.
 * The runner filters the registry before executing, so mass-storage devices
 * skip iPod-only checks automatically.
 */

import { IpodDatabase } from '../ipod/database.js';
import { artworkRebuildCheck } from './checks/artwork.js';
import { artworkResetCheck } from './checks/artwork-reset.js';
import { codecEncodersCheck } from './checks/codec-encoders.js';
import { orphanFilesCheck } from './checks/orphans.js';
import { orphanFilesMassStorageCheck } from './checks/orphans-mass-storage.js';
import { sysInfoExtendedCheck } from './checks/sysinfo-extended.js';
import type {
  DiagnosticCheck,
  DiagnosticReport,
  DiagnosticContext,
  DiagnosticDeviceType,
} from './types.js';

// Re-export types for consumers
export type {
  DiagnosticDeviceType,
  DiagnosticContext,
  CheckResult,
  RepairRequirement,
  RepairContext,
  RepairResult,
  RepairRunOptions,
  DiagnosticRepair,
  DiagnosticCheck,
  DiagnosticReport,
} from './types.js';

// ── Registry ────────────────────────────────────────────────────────────────

/** All registered diagnostic checks */
const CHECKS: DiagnosticCheck[] = [
  artworkRebuildCheck,
  artworkResetCheck,
  codecEncodersCheck,
  orphanFilesCheck,
  orphanFilesMassStorageCheck,
  sysInfoExtendedCheck,
];

/**
 * Get a diagnostic check by ID.
 *
 * Useful for the CLI to look up a specific check when the user requests
 * a targeted repair (e.g. `podkit doctor --repair artwork-rebuild`).
 */
export function getDiagnosticCheck(id: string): DiagnosticCheck | undefined {
  return CHECKS.find((c) => c.id === id);
}

/** Get all registered diagnostic check IDs */
export function getDiagnosticCheckIds(): string[] {
  return CHECKS.map((c) => c.id);
}

// ── Runner ──────────────────────────────────────────────────────────────────

/** Input for runDiagnostics — structured to support both iPod and mass-storage devices */
export interface RunDiagnosticsInput {
  /** Device mount point path */
  mountPoint: string;
  /** Device type */
  deviceType: DiagnosticDeviceType;
  /** Pre-opened IpodDatabase — only for iPod devices */
  db?: IpodDatabase;
  /** Device model name for the report */
  deviceModel?: string;
  /** Content paths for mass-storage devices */
  contentPaths?: import('../device/mass-storage-utils.js').ContentPaths;
}

/**
 * Run all applicable diagnostic checks against a device.
 *
 * Filters the check registry by device type before running. For iPod devices,
 * uses the provided `db` or opens one internally. For mass-storage devices,
 * runs applicable checks (e.g. orphan file detection) using contentPaths.
 *
 * @param input - Device info and optional pre-opened database
 * @returns Diagnostic report with results from applicable checks
 */
export async function runDiagnostics(input: RunDiagnosticsInput): Promise<DiagnosticReport> {
  const { mountPoint, deviceType } = input;

  // Resolve iPod database: use provided handle, or open internally for backward compat
  let db = input.db;
  let ownedDb = false;
  if (deviceType === 'ipod' && !db) {
    try {
      db = await IpodDatabase.open(mountPoint);
      ownedDb = true;
    } catch {
      // DB unavailable — checks will receive undefined db and should skip gracefully
    }
  }

  try {
    const ctx: DiagnosticContext = { mountPoint, deviceType, db, contentPaths: input.contentPaths };

    // Resolve device model
    const deviceModel =
      input.deviceModel ?? (db ? (db.getInfo().device.modelName ?? 'Unknown') : 'Unknown');

    // Filter checks by device type (default applicableTo is ['ipod'])
    const applicable = CHECKS.filter((c) => {
      const types = c.applicableTo ?? ['ipod'];
      return types.includes(deviceType);
    });

    const checks: DiagnosticReport['checks'] = [];

    for (const check of applicable) {
      const result = await check.check(ctx);
      checks.push({
        id: check.id,
        name: check.name,
        hasRepair: check.repair !== undefined,
        repairOnly: check.repairOnly ?? false,
        scope: check.scope ?? 'device',
        ...result,
      });
    }

    const healthy = checks.every((c) => c.status === 'pass' || c.status === 'skip');

    return {
      mountPoint,
      deviceModel,
      deviceType,
      checks,
      healthy,
    };
  } finally {
    if (ownedDb && db) {
      db.close();
    }
  }
}
