/**
 * Scanner framework — typed file-system surveys that hand back lists of
 * podkit-owned debris ready for safe-auto cleanup.
 *
 * Scanners differ from {@link DiagnosticCheck}s in two ways. A check answers
 * "is this device healthy?" and may surface user-owned artefacts (orphans)
 * that require confirmation before action. A scanner answers "what podkit
 * residue is here?" — every path returned is safe to delete by construction
 * because it was created by an atomic-write tmp+rename that never finished.
 *
 * The two registries — checks and scanners — share their shape on purpose
 * so callers can browse them uniformly (`id`, `name`, `applicableTo`). Doctor
 * runs the check registry. The pre-sync sweep runs the scanner registry. The
 * registries do not double-walk: a scanner's `scan()` is the same code path
 * the corresponding check uses internally to populate its debris bucket.
 */

import type { DiagnosticDeviceType } from '../types.js';
import type { ContentPaths } from '@podkit/devices-mass-storage';

/**
 * Where a scanner can run. `'host'` lets a scanner declare it has nothing to
 * do with the attached device — e.g. the local scratch-dir sweep that walks
 * `os.tmpdir()` for abandoned transcode dirs.
 */
export type ScannerApplicableTo = DiagnosticDeviceType | 'host';

/**
 * One reaped path with the size the scanner observed at survey time.
 *
 * `bytes` is `0` for any path that failed to `stat()`. Reporting zero rather
 * than dropping the entry keeps the path itself visible to the user (so the
 * sweep can attempt the unlink) without inventing a size we don't have.
 */
export interface DebrisEntry {
  path: string;
  bytes: number;
}

export interface DebrisScanResult {
  debris: DebrisEntry[];
  totalBytes: number;
}

/**
 * Inputs the scanner registry hands to each `scan()` call.
 *
 * Sibling-process protection for host-global scanners is enforced by the
 * walker via `.owner` PID liveness probes (see `transcode-tmp-walker.ts`
 * and `packages/podkit-core/src/lib/pid-file.ts`), not by a session-time
 * floor. The scanner context therefore carries only the device-scoped
 * inputs.
 */
export interface ScannerContext {
  /**
   * Device mount point. Required for device-scoped scanners; `undefined` when
   * a host-scoped scanner runs (and the scanner must tolerate that).
   */
  mountPoint?: string;
  deviceType?: DiagnosticDeviceType;
  contentPaths?: ContentPaths;
}

export interface Scanner {
  /** Unique identifier, e.g. `'mass-storage-content-debris'`. */
  id: string;
  /** Human-readable name surfaced in sweep summaries and `--verbose` output. */
  name: string;
  /** Where this scanner can run; the registry filters by this before dispatch. */
  applicableTo: ReadonlyArray<ScannerApplicableTo>;
  /** Run the scan and return the debris bucket. */
  scan(ctx: ScannerContext): Promise<DebrisScanResult>;
}
