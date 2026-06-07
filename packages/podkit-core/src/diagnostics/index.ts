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
import { inquiryMethodsCheck } from './checks/inquiry-methods.js';
import { orphanFilesCheck } from './checks/orphans.js';
import { orphanFilesMassStorageCheck } from './checks/orphans-mass-storage.js';
import { debrisFilesMassStorageCheck } from './checks/debris-files-mass-storage.js';
import { debrisFilesIpodCheck } from './checks/debris-files-ipod.js';
import { debrisTranscodeTmpCheck } from './checks/debris-transcode-tmp.js';
import { sysInfoExtendedCheck } from './checks/sysinfo-extended.js';
import { sysinfoConsistencyCheck } from './checks/sysinfo-consistency.js';
import { sysinfoModelnumMismatchCheck } from './checks/sysinfo-modelnum-mismatch.js';
import { udevRuleCheck } from './checks/udev-rule.js';
import { videoEncoderCheck } from './checks/video-encoder.js';
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
  LiveDeviceIdentity,
  CheckResult,
  RepairRequirement,
  RepairContext,
  RepairResult,
  RepairRunOptions,
  DiagnosticRepair,
  DiagnosticCheck,
  DiagnosticReport,
} from './types.js';

// Public --repair ID dispatch
export {
  PUBLIC_REPAIR_IDS,
  resolvePublicRepairId,
  getRepairCheck,
  getRepairCheckForValidation,
} from './repair-dispatch.js';

// ── Registry ────────────────────────────────────────────────────────────────

/** All registered diagnostic checks */
const CHECKS: DiagnosticCheck[] = [
  artworkRebuildCheck,
  artworkResetCheck,
  codecEncodersCheck,
  inquiryMethodsCheck,
  videoEncoderCheck,
  orphanFilesCheck,
  orphanFilesMassStorageCheck,
  debrisFilesMassStorageCheck,
  debrisFilesIpodCheck,
  debrisTranscodeTmpCheck,
  sysInfoExtendedCheck,
  sysinfoConsistencyCheck,
  sysinfoModelnumMismatchCheck,
  udevRuleCheck,
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
  contentPaths?: import('@podkit/devices-mass-storage').ContentPaths;
  /**
   * Live device identity (FireWireGUID, USB-derived model). Forwarded to
   * checks that compare on-disk state against the connected device.
   */
  liveIdentity?: import('./types.js').LiveDeviceIdentity;
  /**
   * Restrict to checks of these scopes. Default: all three scopes.
   *
   * Pass `['system']` to skip device-touching checks (useful when no iPod
   * is plugged in). Pass `['device-readiness', 'database-health']` to skip
   * host-environment checks (FFmpeg, libusb availability, etc.) — useful
   * for tests and any caller that wants device-only diagnostics.
   *
   * The CLI's user-facing `--scope device` flag maps to both device-side
   * scopes here; the 3-way split is for renderer/grouping purposes only,
   * the CLI scope flag continues to expose the original 2-way split.
   */
  scopes?: ReadonlyArray<'system' | 'device-readiness' | 'database-health'>;
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

  // Resolve iPod database: use provided handle, or open internally for backward compat.
  // Skip when scopes does not include any device-side scope — system-only runs
  // have no need for the DB.
  let db = input.db;
  let ownedDb = false;
  const allowedScopesEarly: ReadonlyArray<'system' | 'device-readiness' | 'database-health'> =
    input.scopes ?? ['system', 'device-readiness', 'database-health'];
  const wantsDeviceSide =
    allowedScopesEarly.includes('device-readiness') ||
    allowedScopesEarly.includes('database-health');
  if (deviceType === 'ipod' && !db && wantsDeviceSide) {
    try {
      db = await IpodDatabase.open(mountPoint);
      ownedDb = true;
    } catch {
      // DB unavailable — checks will receive undefined db and should skip gracefully
    }
  }

  try {
    const ctx: DiagnosticContext = {
      mountPoint,
      deviceType,
      db,
      contentPaths: input.contentPaths,
      liveIdentity: input.liveIdentity,
    };

    // Resolve device model
    const deviceModel =
      input.deviceModel ?? (db ? (db.getInfo().device.modelName ?? 'Unknown') : 'Unknown');

    // Filter checks by device type (default applicableTo is ['ipod'])
    // and by scope (default: include all three).
    // When running system-only, bypass the device-type filter: a system-scope check
    // must run regardless of which device is attached (or declared).
    const allowedScopes = allowedScopesEarly;
    const isSystemOnly = allowedScopes.length === 1 && allowedScopes[0] === 'system';
    const applicable = CHECKS.filter((c) => {
      const types = c.applicableTo ?? ['ipod'];
      return (isSystemOnly || types.includes(deviceType)) && allowedScopes.includes(c.scope);
    });

    const checks: DiagnosticReport['checks'] = [];

    for (const check of applicable) {
      const result = await check.check(ctx);
      checks.push({
        id: check.id,
        name: check.name,
        hasRepair: check.repair !== undefined,
        repairOnly: check.repairOnly ?? false,
        scope: check.scope,
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
