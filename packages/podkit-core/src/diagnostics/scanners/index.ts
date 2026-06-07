/**
 * Scanner registry — typed FS surveys for podkit debris.
 *
 * Mirrors the {@link DiagnosticCheck} registry in `../index.ts` so consumers
 * can browse both uniformly. See `./types.ts` for the shape and rationale.
 */

import type { Scanner, ScannerApplicableTo, ScannerContext, DebrisScanResult } from './types.js';
import { massStorageContentDebrisScanner } from './mass-storage-debris-scanner.js';
import { ipodContentDebrisScanner } from './ipod-debris-scanner.js';
import { transcodeTmpDebrisScanner } from './transcode-tmp-scanner.js';

export type { Scanner, ScannerApplicableTo, ScannerContext, DebrisScanResult } from './types.js';
export type { DebrisEntry } from './types.js';

/** All registered scanners. */
const SCANNERS: Scanner[] = [
  massStorageContentDebrisScanner,
  ipodContentDebrisScanner,
  transcodeTmpDebrisScanner,
];

/** Look up a scanner by ID. */
export function getScanner(id: string): Scanner | undefined {
  return SCANNERS.find((s) => s.id === id);
}

/** Return the IDs of every registered scanner. */
export function getScannerIds(): string[] {
  return SCANNERS.map((s) => s.id);
}

/** Return scanners applicable to a given target (device type or `'host'`). */
export function getApplicableScanners(target: ScannerApplicableTo): Scanner[] {
  return SCANNERS.filter((s) => s.applicableTo.includes(target));
}

/**
 * Run every applicable scanner and aggregate their results.
 *
 * Callers pass a target (`'ipod'`, `'mass-storage'`, or `'host'`) and the
 * context the scanners expect. Empty arrays come back when nothing applies —
 * this is a normal "clean" result, not an error.
 */
export async function runScanners(
  target: ScannerApplicableTo,
  ctx: ScannerContext
): Promise<DebrisScanResult> {
  const applicable = getApplicableScanners(target);
  const results = await Promise.all(applicable.map((s) => s.scan(ctx)));
  const debris = results.flatMap((r) => r.debris);
  const totalBytes = results.reduce((sum, r) => sum + r.totalBytes, 0);
  return { debris, totalBytes };
}
