/**
 * Render primitives for `podkit doctor`.
 *
 * Owns the visual building blocks shared across the iPod, mass-storage,
 * and system-only doctor paths. Each function takes structured input
 * and emits via `OutputContext` — JSON mode is a no-op for these
 * helpers because the JSON envelope is composed at the call site
 * (inside `out.result(envelope, () => …)`).
 *
 * Extracted from inline rendering inside `commands/doctor.ts`. Keeps
 * the surface presentation-only — diagnostic logic stays in
 * `@podkit/core`; this module just walks the structured results.
 */

import { basename, dirname } from 'node:path';
import type { OutputContext } from '../output/index.js';
import { formatBytes } from '../output/index.js';
import { stageMarker } from './readiness-display.js';

/**
 * Shape of a check the grouped renderer expects. Compatible with both
 * `DiagnosticReport['checks'][number]` (from `@podkit/core`) and
 * `DoctorCheckOutput` (the CLI's JSON envelope).
 */
export interface GroupedRenderableCheck {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  summary: string;
  scope: 'system' | 'device-readiness' | 'database-health';
  repairOnly?: boolean;
  details?: Record<string, unknown>;
}

/**
 * Format one check as a single-line "  ${marker} ${name}    ${summary}"
 * row. The marker comes from `stageMarker(status)` so the same legend
 * applies as the readiness pipeline (`✓`/`✗`/`!`/`·`).
 *
 * Pre-extraction this row template appeared verbatim in three places:
 * inside `printGroupedChecks` and twice inline within the iPod-doctor
 * render block. Centralising it here means a future marker / column
 * change is a single-file edit.
 */
export function formatCheckRow(check: {
  status: GroupedRenderableCheck['status'];
  name: string;
  summary: string;
}): string {
  const sym = stageMarker(check.status);
  return `  ${sym} ${check.name}    ${check.summary}`;
}

/**
 * Render checks under the unified `System` / `Device Readiness` /
 * `Database Health` structure. Empty sections are omitted.
 *
 * Categorisation is a direct branch on `scope`, with no defaulting:
 *  - `'system'` → "System".
 *  - `'device-readiness'` → "Device Readiness".
 *  - `'database-health'` → "Database Health".
 *
 * `opts.inlineDetails` is called after each rendered row, letting the
 * iPod-doctor path interleave its orphan-summary block under the
 * `orphan-files` check without forking the section renderer. Default
 * is a no-op.
 */
export function printGroupedChecks(
  out: OutputContext,
  checks: ReadonlyArray<GroupedRenderableCheck>,
  opts?: { inlineDetails?: (check: GroupedRenderableCheck) => void }
): void {
  const inlineDetails = opts?.inlineDetails;
  const systemChecks = checks.filter((c) => !c.repairOnly && c.scope === 'system');
  const readinessChecks = checks.filter((c) => !c.repairOnly && c.scope === 'device-readiness');
  const databaseChecks = checks.filter((c) => !c.repairOnly && c.scope === 'database-health');

  const renderSection = (title: string, group: ReadonlyArray<GroupedRenderableCheck>): void => {
    if (group.length === 0) return;
    out.newline();
    out.print(title);
    for (const check of group) {
      out.print(formatCheckRow(check));
      inlineDetails?.(check);
    }
  };

  renderSection('System', systemChecks);
  renderSection('Device Readiness', readinessChecks);
  renderSection('Database Health', databaseChecks);
}

/**
 * Print the standard "All checks passed." / "N issues found." line.
 * Appears in all three doctor paths (mass-storage / iPod / system-only)
 * with byte-identical wording.
 */
export function printSummaryLine(out: OutputContext, healthy: boolean, issueCount: number): void {
  if (healthy) {
    out.success('All checks passed.');
    return;
  }
  const n = issueCount || 1;
  out.error(`${n} issue${n === 1 ? '' : 's'} found.`);
}

// ── Orphan file helpers ─────────────────────────────────────────────────────

/**
 * Print a verbose summary of orphan files: breakdown by directory, by
 * extension, plus the 10 largest. All output goes through `out.verbose1`
 * so it only renders at `-v` or higher.
 */
export function printOrphanSummary(out: OutputContext, details: Record<string, unknown>): void {
  const orphans = details.orphans as Array<{ path: string; size: number }> | undefined;
  if (!orphans || orphans.length === 0) return;

  // Breakdown by F* directory
  const byDir = new Map<string, { count: number; size: number }>();
  for (const o of orphans) {
    const dir = basename(dirname(o.path));
    const entry = byDir.get(dir) ?? { count: 0, size: 0 };
    entry.count++;
    entry.size += o.size;
    byDir.set(dir, entry);
  }

  out.newline();
  out.verbose1('    By directory:');
  const sortedDirs = [...byDir.entries()].sort((a, b) => b[1].size - a[1].size);
  for (const [dir, { count, size }] of sortedDirs) {
    out.verbose1(
      `      ${dir.padEnd(5)} ${String(count).padStart(5)} files  ${formatBytes(size).padStart(10)}`
    );
  }

  // Breakdown by extension
  const byExt = new Map<string, { count: number; size: number }>();
  for (const o of orphans) {
    const name = basename(o.path);
    const dotIdx = name.lastIndexOf('.');
    const ext = dotIdx >= 0 ? name.slice(dotIdx).toLowerCase() : '(none)';
    const entry = byExt.get(ext) ?? { count: 0, size: 0 };
    entry.count++;
    entry.size += o.size;
    byExt.set(ext, entry);
  }

  out.verbose1('    By extension:');
  const sortedExts = [...byExt.entries()].sort((a, b) => b[1].size - a[1].size);
  for (const [ext, { count, size }] of sortedExts) {
    out.verbose1(
      `      ${ext.padEnd(8)} ${String(count).padStart(5)} files  ${formatBytes(size).padStart(10)}`
    );
  }

  // Top 10 largest files
  const sorted = [...orphans].sort((a, b) => b.size - a.size);
  const top = sorted.slice(0, 10);
  out.verbose1('    Largest orphans:');
  for (const o of top) {
    const rel = o.path.replace(/.*iPod_Control\/Music\//, '');
    out.verbose1(`      ${formatBytes(o.size).padStart(10)}  ${rel}`);
  }

  out.verbose1(`    Use --format csv to export the full list.`);
}

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Emit the orphan-file list from a diagnostic report as CSV.
 *
 * Walks both possible check IDs — iPod (`orphan-files`) and
 * mass-storage (`orphan-files-mass-storage`) — so the CSV export works
 * regardless of which device type produced the report. Both checks
 * expose the same `details.orphans: Array<{ path; size }>` shape, so
 * the row format is identical.
 *
 * Emits a header row only when at least one orphan is present.
 * Otherwise emits nothing — matching the pre-fix iPod-only behaviour
 * pinned by the doctor-flag-matrix tests.
 */
export function emitOrphanCsv(
  out: OutputContext,
  report: { checks: ReadonlyArray<{ id: string; details?: Record<string, unknown> | undefined }> }
): void {
  const orphanCheck =
    report.checks.find((c) => c.id === 'orphan-files') ??
    report.checks.find((c) => c.id === 'orphan-files-mass-storage');
  const orphans = (orphanCheck?.details as Record<string, unknown> | undefined)?.orphans as
    | Array<{ path: string; size: number }>
    | undefined;
  if (!orphans || orphans.length === 0) return;
  out.stdout('path,size');
  for (const o of orphans) {
    out.stdout(`${escapeCsvField(o.path)},${o.size}`);
  }
}
