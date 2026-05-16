/**
 * Diagnostic framework types
 *
 * Provides a check + repair interface for device health diagnostics.
 * The core defines domain-level requirements (e.g. "needs source collection")
 * without any awareness of CLI flags or UX. The CLI layer maps requirements
 * to flags, prompts, and user-facing messages.
 */

import type { IpodDatabase } from '../ipod/database.js';
import type { CollectionAdapter } from '../adapters/interface.js';
import type { IpodModel } from '@podkit/devices-ipod';

// ── Device type ──────────────────────────────────────────────────────────────

export type DiagnosticDeviceType = 'ipod' | 'mass-storage';

// ── Live identity ────────────────────────────────────────────────────────────

/**
 * Live device identity resolved by the host platform layer.
 *
 * Populated by the CLI/diagnostic caller from whatever live transports are
 * available (USB descriptor, SCSI inquiry, firmware probe). Checks should
 * treat any absent field as "skip the axis that depends on it" rather than
 * failing — absent live data means the host couldn't read it, not that the
 * device is misconfigured.
 */
export interface LiveDeviceIdentity {
  /**
   * Live FireWireGUID. For classic iPods this is the USB descriptor's
   * serial number. May also come from a SCSI inquiry on hosts where USB
   * descriptors aren't reachable. Normalised to 16-char uppercase hex by
   * the producer.
   */
  firewireGuid?: string;
  /**
   * Live model identification, typically derived from the USB product ID.
   * Generation-only on classic iPods (USB descriptors don't reveal capacity
   * or color).
   */
  model?: IpodModel;
}

// ── Check types ──────────────────────────────────────────────────────────────

export interface DiagnosticContext {
  /** Device mount point path */
  mountPoint: string;
  /** Device type discriminant */
  deviceType: DiagnosticDeviceType;
  /** Open iPod database — only present for iPod devices */
  db?: IpodDatabase;
  /** Content directory paths for mass-storage devices */
  contentPaths?: import('@podkit/devices-mass-storage').ContentPaths;
  /**
   * Live device identity (FireWireGUID, USB-derived model). Undefined when
   * the caller couldn't resolve live data — checks that depend on live
   * data must skip rather than fail in that case.
   */
  liveIdentity?: LiveDeviceIdentity;
}

export interface CheckResult {
  /** Check outcome */
  status: 'pass' | 'fail' | 'warn' | 'skip';
  /** One-line human-readable summary */
  summary: string;
  /** Structured data for JSON output */
  details?: Record<string, unknown>;
  /** URL to relevant documentation */
  docsUrl?: string;
  /** Whether this issue can be automatically repaired */
  repairable: boolean;
}

// ── Repair types ─────────────────────────────────────────────────────────────

/**
 * Domain-level requirements for a repair operation.
 *
 * - `'source-collection'` — repair reads from a podkit collection adapter
 *   (e.g. artwork rebuild needs the original cover-art bytes).
 * - `'writable-device'` — repair writes to the device filesystem.
 * - `'database'` — repair reads or writes the iTunesDB. Repairs that lack
 *   this requirement must run on freshly-formatted iPods that have no
 *   database yet (e.g. `sysinfo-extended` populates identity *before* the
 *   database makes sense). The CLI uses this to decide whether to call
 *   `IpodDatabase.open()` before invoking the repair.
 */
export type RepairRequirement = 'source-collection' | 'writable-device' | 'database';

export interface RepairContext extends DiagnosticContext {
  /** Source collection adapters (already connected) */
  adapters: CollectionAdapter[];
}

export interface RepairResult {
  success: boolean;
  summary: string;
  details?: Record<string, unknown>;
}

export interface DiagnosticRepair {
  /** What the repair does, in domain terms */
  description: string;
  /** What this repair needs to run (the CLI maps these to flags/prompts) */
  requirements: RepairRequirement[];
  /** Execute the repair */
  run(ctx: RepairContext, options?: RepairRunOptions): Promise<RepairResult>;
}

export interface RepairRunOptions {
  /** If true, don't modify the iPod — just report what would change */
  dryRun?: boolean;
  /** Called with progress updates */
  onProgress?: (progress: Record<string, unknown>) => void;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /**
   * Caller's verbosity level (CLI `-v` accumulator, `0..3`). Repairs may use
   * this to decide how much per-transport / per-step detail to surface in
   * their `summary`. Defaults to `0` when omitted.
   *
   * Today only the `sysinfo-extended` repair consults this — the orchestrator
   * failure message includes more transport-specific detail at `-vv`+.
   */
  verbose?: number;
}

// ── Diagnostic check ─────────────────────────────────────────────────────────

export interface DiagnosticCheck {
  /** Unique identifier, e.g. "artwork-rebuild" */
  id: string;
  /** Human-readable name, e.g. "Artwork Integrity" */
  name: string;
  /**
   * Which device types this check applies to.
   * Defaults to `['ipod']` if omitted (backward-compatible).
   */
  applicableTo?: ReadonlyArray<DiagnosticDeviceType>;
  /**
   * Output section this check belongs to.
   * 'system' = host environment (e.g. FFmpeg encoders).
   * 'device' = device-specific health (default).
   */
  scope?: 'system' | 'device';
  /** Run the check */
  check(ctx: DiagnosticContext): Promise<CheckResult>;
  /** If this check can auto-repair, how */
  repair?: DiagnosticRepair;
  /** If true, this check has no detection logic — it only exposes a repair action */
  repairOnly?: boolean;
}

// ── Report ───────────────────────────────────────────────────────────────────

export interface DiagnosticReport {
  /** Device mount point */
  mountPoint: string;
  /** Device model name */
  deviceModel: string;
  /** Device type */
  deviceType: DiagnosticDeviceType;
  /** Individual check results */
  checks: Array<
    {
      id: string;
      name: string;
      hasRepair: boolean;
      repairOnly: boolean;
      scope: 'system' | 'device';
    } & CheckResult
  >;
  /** Overall health: true if all checks passed */
  healthy: boolean;
}
