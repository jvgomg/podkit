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

import type {
  DiagnosticCheck,
  DiagnosticDeviceType,
  RepairContext,
  RepairRunOptions,
} from './types.js';
import { getDiagnosticCheck } from './index.js';
import {
  assessIpodIdentity as defaultAssessIpodIdentity,
  type IpodIdentityAssessment,
} from '../device/ipod-identity.js';
import type { ReadinessUnsupportedReason } from '@podkit/device-types';

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
  'sysinfo-modelnum-missing',
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

// ── Typed repair execution ────────────────────────────────────────────────

/**
 * Result of executing a diagnostic repair through `runDiagnosticRepair`.
 *
 * Three disjoint outcomes:
 *  - `'refused'` — pre-flight identity assessment surfaced a cascade-known
 *    unsupported iPod generation (hashAB nano 6/7, shuffle 3/4, iOS, …).
 *    The repair was not executed. `reason` carries the typed payload the
 *    presenter renders.
 *  - `'ok'` — the repair ran and its `RepairResult.success` was `true`.
 *  - `'failed'` — the repair ran and its `RepairResult.success` was `false`.
 *
 * The dispatcher does NOT throw on refusal. Callers decide exit code and
 * rendering — keeps the core surface presentation-agnostic. Underlying
 * exceptions from `check.repair.run` still propagate; they represent
 * unexpected execution failures distinct from a structured `failed` result.
 */
export type RepairExecutionResult =
  | { status: 'refused'; checkId: string; reason: ReadinessUnsupportedReason }
  | { status: 'ok'; checkId: string; summary: string; details?: Record<string, unknown> }
  | { status: 'failed'; checkId: string; summary: string; details?: Record<string, unknown> };

export interface RunDiagnosticRepairDeps {
  /** Override the identity assessment used for the unsupported-device pre-flight (tests). */
  assessIpodIdentity?: (mountPoint: string) => Promise<IpodIdentityAssessment>;
}

/**
 * Run the cascade-unsupported pre-flight in isolation. Returns the
 * refusal reason on a refused device, otherwise `null`. Never throws —
 * transient I/O failures fall through to `null`, matching the best-effort
 * semantics of `runDiagnosticRepair`'s internal pre-flight.
 *
 * Pre-flight is iPod-scoped: returns `null` immediately for mass-storage
 * or empty mountPoint inputs.
 *
 * Callers that need to refuse BEFORE opening a device handle use this to
 * gate the open call; the CLI's iPod `--repair` flow does exactly that,
 * since opening libgpod against SQLite-based unsupported generations
 * (hashAB nano 6/7, shuffle 3/4, iOS) can corrupt on-device state.
 */
export async function assessRepairRefusal(
  ctx: { deviceType: DiagnosticDeviceType; mountPoint: string },
  deps: { assessIpodIdentity?: (mountPoint: string) => Promise<IpodIdentityAssessment> } = {}
): Promise<ReadinessUnsupportedReason | null> {
  if (ctx.deviceType !== 'ipod' || !ctx.mountPoint) return null;
  const assess = deps.assessIpodIdentity ?? defaultAssessIpodIdentity;
  try {
    const assessment = await assess(ctx.mountPoint);
    return assessment?.model?.unsupportedReason ?? null;
  } catch {
    return null;
  }
}

/**
 * Execute a diagnostic repair with the cascade-unsupported pre-flight applied.
 *
 * Before invoking `check.repair.run`, this resolves the iPod identity for the
 * mount point and refuses if the cascade flagged the device as a known
 * unsupported generation — even if the user explicitly asked for the repair.
 * Applying mutating repairs to refused generations risks corrupting on-device
 * state (notably the SQLite-based generations where libgpod writes are not
 * safe).
 *
 * Pre-flight is iPod-scoped: mass-storage and system-scope repairs skip it
 * (no cascade applies). The pre-flight is best-effort — transient I/O errors
 * during assessment fall through to `repair.run`, which surfaces any genuine
 * device-side problems with its own error path.
 *
 * Existing direct callers of `check.repair.run` are unaffected — this is a
 * strictly additive entry point for consumers (CLI, future web/GUI) that
 * want the refusal semantics centralised in core.
 */
export async function runDiagnosticRepair(
  check: DiagnosticCheck,
  ctx: RepairContext,
  options: RepairRunOptions = {},
  deps: RunDiagnosticRepairDeps = {}
): Promise<RepairExecutionResult> {
  if (!check.repair) {
    throw new Error(`Check "${check.id}" has no repair defined`);
  }

  const reason = await assessRepairRefusal(ctx, deps);
  if (reason) {
    return { status: 'refused', checkId: check.id, reason };
  }

  const result = await check.repair.run(ctx, options);
  return result.success
    ? {
        status: 'ok',
        checkId: check.id,
        summary: result.summary,
        ...(result.details !== undefined ? { details: result.details } : {}),
      }
    : {
        status: 'failed',
        checkId: check.id,
        summary: result.summary,
        ...(result.details !== undefined ? { details: result.details } : {}),
      };
}
