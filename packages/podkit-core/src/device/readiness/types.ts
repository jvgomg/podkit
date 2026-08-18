import type { IpodModel, ReadinessUnsupportedReason } from '@podkit/device-types';

// Re-export so existing `import { ReadinessUnsupportedReason } from './types.js'`
// call sites inside core continue to compile. The canonical home is
// `@podkit/device-types` — that's where new code should import it from.
export type { ReadinessUnsupportedReason } from '@podkit/device-types';

// ── Stage identifiers ────────────────────────────────────────────────────────

export type ReadinessStage = 'usb' | 'partition' | 'filesystem' | 'mount' | 'sysinfo' | 'database';

// ── Stage result ─────────────────────────────────────────────────────────────

export interface ReadinessStageResult {
  stage: ReadinessStage;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  summary: string;
  details?: Record<string, unknown>;
}

// ── Readiness levels ─────────────────────────────────────────────────────────

export type ReadinessLevel =
  | 'ready'
  | 'needs-repair'
  | 'needs-init'
  | 'needs-format'
  | 'needs-partition'
  | 'hardware-error'
  /**
   * The device was recognised (Apple-vendor unsupported PID, non-Apple USB
   * with no preset, …) but podkit explicitly refuses to operate on it.
   * Distinct from `'unknown'`, which means the pipeline could not identify
   * the device at all. The structured rejection payload lives in
   * `ReadinessResult.unsupported`.
   */
  | 'unsupported'
  | 'unknown';

export interface ReadinessResult {
  level: ReadinessLevel;
  stages: ReadinessStageResult[];
  /** Model from USB product ID lookup (generation only, no color) */
  usbModel?: IpodModel;
  /** Model from SysInfo/SysInfoExtended (has color, capacity, model number) */
  deviceModel?: IpodModel;
  /**
   * Structured rejection payload. Set only when `level === 'unsupported'`.
   * Pulled from the iPod unsupported-PID table, the iOS-range fallback,
   * the filesystem policy (HFS+ on Linux), or (for non-Apple mass-storage)
   * the vendor-with-no-preset path.
   */
  unsupported?: ReadinessUnsupportedReason;
  summary?: {
    trackCount: number;
    freeBytes?: number;
    totalBytes?: number;
  };
}

// ── Pipeline input ───────────────────────────────────────────────────────────

import type { DiscoveredDevice } from '../discovery.js';
import type { IpodDatabase } from '../../ipod/database.js';

/**
 * Input to {@link checkReadiness}.
 *
 * The pipeline dispatches on `device.kind` (and on `device.block` presence
 * within the `'ipod'` arm) — there is exactly one entry point. The CLI no
 * longer needs to choose between "call this for full iPods", "call that for
 * USB-only iPods", or "call the other one for unsupported devices".
 *
 * Per-arm semantics:
 * - `kind: 'ipod'` with `block`: runs the full 6-stage pipeline
 *   (usb → partition → filesystem → mount → sysinfo → database). USB
 *   context (`usbConnection`, `usbModel`) is read from `device.usb`. If
 *   `device.usb.supported === false`, the unsupported short-circuit fires
 *   using `device.usb.unsupportedReason`.
 * - `kind: 'ipod'` with no `block` (USB-only): synthesises a 2-stage
 *   result (usb pass + partition fail, remaining stages skipped) with
 *   `level: 'needs-partition'`. If `device.usb.supported === false`, the
 *   unsupported short-circuit fires instead.
 * - `kind: 'mass-storage'`: returns a `'ready'` (block present) or
 *   `'needs-partition'` (USB-only) marker result — mass-storage devices
 *   don't run iPod readiness checks; the result is a structural placeholder
 *   so JSON consumers see a consistent shape.
 * - `kind: 'unsupported'`: short-circuits with `level: 'unsupported'`
 *   and a typed reason synthesised from `device.usb.reason`.
 */
export interface ReadinessInput {
  device: DiscoveredDevice;
  /**
   * Pre-opened iPod database. Skips the redundant libgpod open in the
   * `database` stage when the caller already has a handle. Caller owns
   * the handle's lifecycle — readiness will not close it.
   *
   * Ignored when `device.kind !== 'ipod'`, when the iPod arm has no `block`
   * (USB-only iPods can't have a database), or when the pipeline short-circuits
   * to `level: 'unsupported'` before reaching the database stage (USB-arm
   * rejection or post-sysinfo unsupported check).
   */
  ipod?: IpodDatabase;
  /**
   * What the caller intends to do with the device. Defaults to `'write'`.
   *
   * A `read-only` generation (shuffle 3G/4G, nano 6G/7G) refuses writes but
   * reads its `iTunesDB` fine, so the answer to "is this device ready?"
   * depends on what is being asked of it:
   *
   * - `'write'` — the historical behaviour. A `read-only` generation
   *   short-circuits to `level: 'unsupported'` with its rejection reason
   *   before any disk probe runs; sync / init / add must not proceed.
   * - `'read'` — the cascade runs to completion on a `read-only` generation,
   *   so the caller learns whether the device is partitioned, mounted, has
   *   SysInfo and opens its database. Every stage probe is non-destructive
   *   (`stat`, file reads, a libgpod parse), so running them costs the device
   *   nothing. Access tier `'none'` still short-circuits — those devices have
   *   no readable disk representation at all.
   *
   * The split mirrors the access-intent gate in ADR-024: reads are safe on a
   * read-only device, writes are not.
   */
  requiredAccess?: 'read' | 'write';
  /**
   * Platform override for filesystem-policy checks (TASK-317.12). Defaults to
   * `process.platform`. Production code never sets this — it exists so tests
   * can exercise the HFS+-on-Linux refusal from a macOS or Linux runner
   * without mutating `process.platform`.
   *
   * Only consulted for the iPod-with-block arm; other arms ignore it.
   */
  platform?: NodeJS.Platform | string;
}

// ── SysInfo check result ─────────────────────────────────────────────────────

export interface SysInfoCheckResult {
  stage: ReadinessStageResult;
  deviceModel?: IpodModel;
}

// ── Stage display names ───────────────────────────────────────────────────────

export const STAGE_DISPLAY_NAMES: Record<ReadinessStage, string> = {
  usb: 'USB Connection',
  partition: 'Partition Table',
  filesystem: 'Filesystem',
  mount: 'Mounted',
  sysinfo: 'SysInfo',
  database: 'Database',
};

// ── Stage ordering ───────────────────────────────────────────────────────────

export const STAGE_ORDER: ReadinessStage[] = [
  'usb',
  'partition',
  'filesystem',
  'mount',
  'sysinfo',
  'database',
];
