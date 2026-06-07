/**
 * Detect + reap abandoned transcode scratch directories.
 *
 * Every sync creates `<os.tmpdir()>/podkit-transcode-<uuid>/` and removes
 * it in a `finally` block. A SIGKILLed sync misses the finally and leaves
 * the dir behind — usually small (one or two partial transcode outputs),
 * but on a busy machine they accumulate over time and waste disk.
 *
 * Host-scoped (`scope: 'system'`): no device is needed. Repair is
 * safe-by-design because the walker only returns directories older than
 * the current podkit session — anything younger belongs to a concurrent
 * sibling process and is never touched.
 */

import { tmpdir } from 'node:os';
import type {
  DiagnosticCheck,
  CheckResult,
  DiagnosticContext,
  RepairContext,
  RepairRunOptions,
  RepairResult,
} from '../types.js';
import { formatBytes } from '../scanners/mass-storage-walker.js';
import {
  walkAbandonedTranscodeDirs,
  removeAbandonedDir,
} from '../scanners/transcode-tmp-walker.js';

/**
 * The wall-clock time the check + repair use as the "anything newer is live"
 * floor. Captured at module load — once per process — so the diagnostic and
 * any subsequent invocations inside the same run share the same cutoff.
 *
 * **Timing guarantee.** `@podkit/core` is lazy-loaded by the CLI (`await
 * import('@podkit/core')` in `runDoctorAction` and `genericSyncCollection`),
 * and the diagnostics barrel transitively imports this file. The first
 * sync- or doctor-related CLI command in a process triggers the load
 * BEFORE any file-system operations run, so `SESSION_START_MS` reliably
 * precedes any podkit-owned write activity in the same process. Sibling
 * `podkit-transcode-*` directories created after this point are by
 * definition another process's work and must not be reaped.
 */
const SESSION_START_MS = Date.now();

// Exported for tests + the pre-sync sweep so they can override the safety
// floor (e.g. simulate an old session, or scope a sweep to "since N minutes
// ago"). Production callers should leave it alone.
export function getSessionStartMs(): number {
  return SESSION_START_MS;
}

// ── Check ────────────────────────────────────────────────────────────────────

export const debrisTranscodeTmpCheck: DiagnosticCheck = {
  id: 'debris-transcode-tmp',
  name: 'Abandoned transcode scratch directories',
  // Applies to BOTH device types — the residue is host-global and exists
  // independent of which device the user is syncing.
  applicableTo: ['ipod', 'mass-storage'],
  // System scope: the check runs against the host, not the device.
  scope: 'system',

  async check(_ctx: DiagnosticContext): Promise<CheckResult> {
    const abandoned = await walkAbandonedTranscodeDirs(tmpdir(), getSessionStartMs());

    if (abandoned.length === 0) {
      return {
        status: 'pass',
        summary: 'No abandoned transcode scratch directories',
        repairable: false,
        details: { debrisCount: 0, wastedBytes: 0, debris: [] },
      };
    }

    const totalBytes = abandoned.reduce((sum, d) => sum + d.bytes, 0);

    return {
      status: 'warn',
      summary: `${abandoned.length} abandoned transcode dir${abandoned.length === 1 ? '' : 's'} found (${formatBytes(totalBytes)} wasted)`,
      repairable: true,
      details: {
        debrisCount: abandoned.length,
        wastedBytes: totalBytes,
        wastedFormatted: formatBytes(totalBytes),
        debris: abandoned.map((d) => ({ path: d.path, size: d.bytes })),
      },
    };
  },

  repair: {
    description:
      'Always-safe: delete abandoned transcode scratch dirs left by SIGKILLed prior syncs',
    // Host-only repair — no device required. The empty requirements list
    // marks this so the CLI can run it without a -d flag.
    requirements: [],

    async run(_ctx: RepairContext, options?: RepairRunOptions): Promise<RepairResult> {
      const abandoned = await walkAbandonedTranscodeDirs(tmpdir(), getSessionStartMs());
      const totalBytes = abandoned.reduce((sum, d) => sum + d.bytes, 0);

      if (abandoned.length === 0) {
        return { success: true, summary: 'No abandoned transcode dirs to clean up' };
      }

      if (options?.dryRun) {
        return {
          success: true,
          summary: `Dry run: ${abandoned.length} abandoned transcode dir${abandoned.length === 1 ? '' : 's'} would be removed, freeing ${formatBytes(totalBytes)}`,
          details: {
            debrisCount: abandoned.length,
            freedBytes: totalBytes,
            freedFormatted: formatBytes(totalBytes),
            files: abandoned.map((d) => ({ path: d.path, size: d.bytes })),
          },
        };
      }

      let removed = 0;
      let freedBytes = 0;
      const errors: string[] = [];

      for (let i = 0; i < abandoned.length; i++) {
        const target = abandoned[i]!;
        options?.onProgress?.({
          phase: 'deleting',
          current: i + 1,
          total: abandoned.length,
          path: target.path,
        });

        try {
          freedBytes += await removeAbandonedDir(target);
          removed++;
        } catch (error) {
          errors.push(
            `Failed to remove ${target.path}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      return {
        success: errors.length === 0,
        summary: `Removed ${removed} abandoned dir${removed === 1 ? '' : 's'}, freed ${formatBytes(freedBytes)}${errors.length > 0 ? ` (${errors.length} error${errors.length === 1 ? '' : 's'})` : ''}`,
        details: {
          removed,
          freedBytes,
          freedFormatted: formatBytes(freedBytes),
          errors: errors.length > 0 ? errors : undefined,
        },
      };
    },
  },
};
