/**
 * Orchestrator-level render helpers for `podkit sync`.
 *
 * Separated from `sync-presenter.ts` because those classes
 * (`MusicPresenter` / `VideoPresenter`) implement the per-collection
 * `ContentTypePresenter` polymorphic contract. The summary helpers
 * below render the multi-collection wrap-up that runs once at the end
 * of `runSync` — orchestrator-level, not per-collection — so they live
 * in their own file rather than muddling the presenter abstraction.
 *
 * All output goes through `OutputContext`; helpers no-op cleanly in
 * JSON mode (the JSON envelope is composed inline in `runSync`).
 */

import type { Warning } from '@podkit/core';
import type { OutputContext } from '../output/index.js';
import { formatNumber, formatDurationSeconds } from '../output/index.js';

/**
 * Render the "=== Sync Interrupted ===" block. Caller decides whether
 * to emit it — typically when `shutdown.isShuttingDown` is true at the
 * end of the orchestrator loop.
 *
 * No-op under `--dry-run` (the dry-run path doesn't write anything to
 * the device, so an "interrupted" summary would misrepresent the run).
 */
export function printInterruptedSummary(
  out: OutputContext,
  opts: {
    dryRun: boolean;
    totalCompleted: number;
    totalFailed: number;
    durationSeconds: number;
  }
): void {
  if (opts.dryRun) return;
  out.newline();
  out.print('=== Sync Interrupted ===');
  out.newline();
  if (opts.totalCompleted > 0) {
    out.print(`Saved ${formatNumber(opts.totalCompleted)} completed items to device.`);
  }
  if (opts.totalFailed > 0) {
    out.print(`${formatNumber(opts.totalFailed)} items failed before interruption.`);
  }
  out.print(`Duration: ${formatDurationSeconds(opts.durationSeconds)}`);
}

/**
 * Render the "=== Summary ===" block for a completed (non-interrupted)
 * sync. Includes the totals line + duration + (optionally) the grouped
 * execute-phase warnings block.
 *
 * No-op under `--dry-run` (dry-run renders its plan summary via the
 * presenters; orchestrator summary is for real runs only).
 *
 * The warnings block:
 *  - Counts each `WarningInfo.phase === 'execute'` (plan-phase warnings
 *    are already surfaced upstream by each presenter).
 *  - Groups counts by `warning.type` for the at-a-glance line.
 *  - At `-v`+ verbose, expands to per-warning detail with a track hint
 *    (single-track: `(artist — title)`; multi-track: `(N tracks)`).
 *  - At `-v0`, prints a `(re-run with -v for details)` nudge.
 */
export function printSuccessSummary(
  out: OutputContext,
  opts: {
    dryRun: boolean;
    totalCompleted: number;
    totalFailed: number;
    durationSeconds: number;
    allWarnings: Warning[];
  }
): void {
  if (opts.dryRun) return;
  out.newline();
  out.print('=== Summary ===');
  out.newline();
  if (opts.totalFailed > 0) {
    out.print(
      `Synced ${formatNumber(opts.totalCompleted)} items (${formatNumber(opts.totalFailed)} failed)`
    );
  } else if (opts.totalCompleted > 0) {
    out.print(`Synced ${formatNumber(opts.totalCompleted)} items successfully`);
  } else {
    out.print('Everything already in sync!');
  }
  out.print(`Duration: ${formatDurationSeconds(opts.durationSeconds)}`);

  printExecuteWarnings(out, opts.allWarnings);
}

/**
 * Internal: render the grouped execute-phase warnings sub-block.
 * Pulled out of `printSuccessSummary` so the summary body reads
 * top-to-bottom.
 */
function printExecuteWarnings(out: OutputContext, allWarnings: Warning[]): void {
  const executeWarnings = allWarnings.filter((w) => w.phase === 'execute');
  if (executeWarnings.length === 0) return;

  out.newline();
  out.print(`Warnings: ${formatNumber(executeWarnings.length)}`);

  // Group by warning type so the user sees "3 artwork, 2 tag-write"
  // rather than N raw lines.
  const byType = new Map<string, number>();
  for (const w of executeWarnings) {
    byType.set(w.type, (byType.get(w.type) ?? 0) + 1);
  }
  for (const [type, count] of byType) {
    out.print(`  ${type}: ${formatNumber(count)}`);
  }

  if (out.isVerbose) {
    out.newline();
    for (const w of executeWarnings) {
      const first = w.tracks[0];
      const trackHint =
        w.tracks.length === 1 && first
          ? ` (${first.artist} — ${first.title})`
          : w.tracks.length > 1
            ? ` (${w.tracks.length} tracks)`
            : '';
      out.print(`  [${w.type}]${trackHint}: ${w.message}`);
    }
  } else {
    out.print('  (re-run with -v for details)');
  }
}
