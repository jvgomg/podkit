/**
 * Public --repair ID dispatch.
 *
 * Users type a public ID like `--repair orphan-files` regardless of whether
 * they're repairing an iPod or a mass-storage device. The doctor framework
 * dispatches to a device-specific internal check ID so each device type
 * keeps its own walker + repair logic. One public surface, two
 * implementations.
 *
 * Most checks have a 1:1 public→internal mapping. Only two checks need
 * device-aware dispatch today:
 *
 * - `orphan-files` — iPod variant lives at `orphan-files`, mass-storage
 *   variant at `orphan-files-mass-storage`. The iPod variant happens to
 *   share its name with the public ID — historical, kept for stability.
 * - `debris-files` — split into `debris-files-ipod` and
 *   `debris-files-mass-storage`. Neither matches the public ID; both are
 *   resolved through the dispatch table.
 *
 * Host-only checks (`debris-transcode-tmp`) have one implementation and
 * don't appear in the dispatch table at all.
 */

import type { DiagnosticCheck, DiagnosticDeviceType } from './types.js';
import { getDiagnosticCheck } from './index.js';

/**
 * For a public ID, returns the internal check ID for the given device type.
 * Non-unified public IDs (artwork-*, sysinfo-*, udev-rule, debris-transcode-tmp)
 * pass through unchanged.
 */
const UNIFIED_DISPATCH: Readonly<Record<string, Partial<Record<DiagnosticDeviceType, string>>>> = {
  'orphan-files': {
    ipod: 'orphan-files',
    'mass-storage': 'orphan-files-mass-storage',
  },
  'debris-files': {
    ipod: 'debris-files-ipod',
    'mass-storage': 'debris-files-mass-storage',
  },
};

/**
 * Every public --repair ID the CLI advertises. The doctor command pins its
 * commander `choices()` list to this array to keep the public surface
 * one-source-of-truth.
 */
export const PUBLIC_REPAIR_IDS: readonly string[] = [
  'artwork-rebuild',
  'artwork-reset',
  'debris-files',
  'debris-transcode-tmp',
  'orphan-files',
  'sysinfo-consistency',
  'sysinfo-extended',
  'sysinfo-modelnum-mismatch',
  'udev-rule',
];

/**
 * Map a public ID + device type to the internal check ID that runs the
 * repair. Returns the public ID unchanged when no dispatch is needed.
 */
export function resolvePublicRepairId(publicId: string, deviceType: DiagnosticDeviceType): string {
  return UNIFIED_DISPATCH[publicId]?.[deviceType] ?? publicId;
}

/**
 * Look up the diagnostic check that runs for a public --repair ID against a
 * given device type. Returns `undefined` if the ID is unknown or doesn't
 * have an implementation for that device type.
 */
export function getRepairCheck(
  publicId: string,
  deviceType: DiagnosticDeviceType
): DiagnosticCheck | undefined {
  return getDiagnosticCheck(resolvePublicRepairId(publicId, deviceType));
}

/**
 * Pre-device-resolution lookup: returns SOME variant of the check so the
 * CLI can read its `scope` and CLI-visible requirements (`source-collection`
 * for the `-c` flag gate, empty-set for the system-repair fast path) before
 * resolving the device.
 *
 * For unified IDs both variants share `scope` and those two CLI-visible
 * requirement signals, so the iPod variant is a safe early proxy. Per-variant
 * `requirements` arrays may diverge in other elements (e.g. iPod
 * `orphan-files` declares `['writable-device', 'database']`; the mass-storage
 * variant declares `['writable-device']`); enforcement of those non-CLI
 * requirements happens inside `runRepair` / `runMassStorageRepair`, not at
 * the CLI's early-validation step.
 *
 * If the public ID has no iPod variant (a hypothetical future mass-storage-
 * only unified ID), the function falls back to the mass-storage variant so
 * the CLI can still validate it. After the device is resolved, the CLI must
 * call `getRepairCheck(publicId, deviceType)` to get the variant that
 * actually runs.
 */
export function getRepairCheckForValidation(publicId: string): DiagnosticCheck | undefined {
  return getRepairCheck(publicId, 'ipod') ?? getRepairCheck(publicId, 'mass-storage');
}
