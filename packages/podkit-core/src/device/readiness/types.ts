import type { IpodModel } from '@podkit/devices-ipod';

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

/**
 * Structured payload describing why a device is rejected. Carries
 * machine-readable fields so JSON consumers can render rich diagnostics
 * and the CLI can emit a multi-line message without parsing strings.
 *
 * The `kind` discriminator lets renderers branch on rejection class
 * (filesystem policy, unsupported model, missing preset, iOS device)
 * while keeping the payload extension-friendly.
 */
export interface ReadinessUnsupportedReason {
  /** Rejection class. New variants can be added as podkit grows policies. */
  kind:
    | 'filesystem-unsupported-on-linux'
    | 'unsupported-device'
    | 'unsupported-preset'
    | 'ios-device';
  /** Single-line headline shown first (e.g. "Filesystem not supported on Linux"). */
  headline: string;
  /** Optional indented detail lines rendered under the headline. */
  details?: string[];
  /** Optional documentation link the user can follow. */
  docsUrl?: string;
  /** Filesystem string (when kind === 'filesystem-unsupported-on-linux'). */
  filesystem?: string;
  /** Mount path (when kind === 'filesystem-unsupported-on-linux'). */
  path?: string;
}

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

import type { PlatformDeviceInfo } from '../types.js';
import type { DeviceAssessment } from '../assessment.js';
import type { UsbFingerprint } from '@podkit/device-types';
import type { IpodDatabase } from '../../ipod/database.js';

export interface ReadinessInput {
  device: PlatformDeviceInfo;
  assessment?: DeviceAssessment;
  /** USB connection data */
  usbConnection?: UsbFingerprint;
  /** iPod model from USB discovery */
  usbModel?: IpodModel;
  /**
   * Pre-opened iPod database. Skips the redundant libgpod open in the
   * `database` stage when the caller already has a handle. Caller owns
   * the handle's lifecycle — readiness will not close it.
   */
  ipod?: IpodDatabase;
  /**
   * Optional rejection signal threaded from the iPod / mass-storage
   * classifier when the device was recognised but is explicitly not
   * supported by podkit (Apple unsupported-PID table, iOS range fallback,
   * non-Apple USB with no preset). Sets `level = 'unsupported'` short-circuit
   * and surfaces the structured reason on the result.
   *
   * Accepts either the structured payload directly or a bare headline
   * string (legacy callers — wrapped to `kind: 'unsupported-device'`).
   */
  unsupported?: ReadinessUnsupportedReason | string;
  /**
   * Platform override for filesystem-policy checks (TASK-317.12). Defaults to
   * `process.platform`. Production code never sets this — it exists so tests
   * can exercise the HFS+-on-Linux refusal from a macOS or Linux runner
   * without mutating `process.platform`.
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
