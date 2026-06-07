/**
 * Pre-sync debris sweep.
 *
 * Runs once per device sync — before any track operations — and returns a
 * `PlanPreliminaries` describing what the executor should clean up. The
 * orchestrator (`sync.ts`) attaches the result to the FIRST plan executed
 * against the device so the executor's pre-flight runs the cleanup exactly
 * once even when multiple collections (music + video) share a device.
 *
 * Three classes are surfaced:
 *
 * 1. **Mass-storage debris** — `.podkit-tmp` + adapter-failure residue
 *    under the configured content directories. Walked by the same shared
 *    walker the doctor `debris-files-mass-storage` check uses.
 * 2. **iPod debris** — `.podkit-tmp` residue across the full iPod
 *    `iPod_Control/` surface (Music F-buckets, iTunes/, Artwork/, Device/,
 *    Photos/). Same walker as `debris-files-ipod`.
 * 3. **Host transcode-tmp** — abandoned `podkit-transcode-<uuid>/`
 *    scratch directories under `os.tmpdir()`. The mtime-safety floor from
 *    `transcode-tmp-walker` ensures sibling-process dirs are never
 *    touched (`mtimeMs < sessionStartMs`).
 *
 * Phantom manifest entries (manifest rows whose backing file vanished)
 * are surfaced for mass-storage devices alongside debris — the same FS
 * traversal produces both buckets, no double walk.
 */

import { rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { PlanPreliminaries, Warning, WarningSink } from './types.js';
import type { DiagnosticDeviceType } from '../../diagnostics/types.js';
import type { ContentPaths } from '@podkit/devices-mass-storage';
import { walkMassStorageContent } from '../../diagnostics/scanners/mass-storage-walker.js';
import { walkIpodContentForDebris } from '../../diagnostics/scanners/ipod-walker.js';
import { walkAbandonedTranscodeDirs } from '../../diagnostics/scanners/transcode-tmp-walker.js';
import { getSessionStartMs } from '../../diagnostics/checks/debris-transcode-tmp.js';

export interface PreSyncSweepInput {
  /** Device mount point. */
  mountPoint: string;
  /** Device type discriminator. */
  deviceType: DiagnosticDeviceType;
  /** Content paths config — required for mass-storage devices. */
  contentPaths?: ContentPaths;
  /**
   * Loader for the mass-storage manifest's managed-files set. When the
   * loader is provided (and returns a set), the sweep ALSO surfaces
   * phantom manifest entries — manifest rows whose backing file is
   * missing. iPod callers may pass undefined; iPods don't use this
   * manifest concept.
   *
   * The loader is async + injectable so the sweep doesn't need to know
   * about manifest file locations or formats.
   */
  loadManagedFiles?: () => Promise<Set<string> | undefined>;
  /**
   * Override for the host-tmpdir scan root. Defaults to `os.tmpdir()`.
   * Tests use this to point the sweep at a controlled fixture root.
   */
  tmpDirOverride?: string;
  /**
   * Override for the session-start mtime floor. Defaults to the value
   * pinned at module-load time. Tests use this to simulate older
   * sessions.
   */
  sessionStartMsOverride?: number;
}

/**
 * Walk every applicable debris surface and return a `PlanPreliminaries`.
 *
 * Returns an empty object (no `debrisCleanup`, no `phantomPrune`) when
 * the device is clean — the executor's pre-flight can detect this with a
 * single `!preliminaries?.debrisCleanup && !preliminaries?.phantomPrune`
 * check and skip the pre-flight entirely.
 *
 * Tolerant of every scanner failure: a missing content path, an
 * unreadable directory, a `stat()` that races with another process —
 * none of these throw out of `runPreSyncSweep`. The sweep is best-effort
 * by design (TASK-398 specifies non-fatal cleanup), and the next sync
 * always retries.
 */
export async function runPreSyncSweep(input: PreSyncSweepInput): Promise<PlanPreliminaries> {
  const debris: Array<{ path: string; bytes: number }> = [];
  const phantomPaths: string[] = [];

  // ── Device-side ────────────────────────────────────────────────────────────
  if (input.deviceType === 'mass-storage' && input.contentPaths) {
    let managedFiles: Set<string> | undefined;
    if (input.loadManagedFiles) {
      try {
        managedFiles = await input.loadManagedFiles();
      } catch {
        // Loader rejection is non-fatal — fall back to debris-only
        // detection. The walker still runs against an empty managed set,
        // so debris surfaces correctly; phantom rows just don't surface
        // this run.
        managedFiles = undefined;
      }
    }
    try {
      const result = await walkMassStorageContent(
        input.mountPoint,
        input.contentPaths,
        managedFiles ?? new Set()
      );
      for (const p of result.debris) {
        debris.push({ path: p, bytes: await sizeOrZero(p) });
      }
      // Only surface phantoms when the manifest loaded successfully —
      // without a manifest there's no notion of a phantom row.
      if (managedFiles && result.missingTrackedFiles.length > 0) {
        phantomPaths.push(...result.missingTrackedFiles);
      }
    } catch {
      // Walker errors are non-fatal; the sweep continues to the host pass.
    }
  } else if (input.deviceType === 'ipod') {
    try {
      const paths = await walkIpodContentForDebris(input.mountPoint);
      for (const p of paths) {
        debris.push({ path: p, bytes: await sizeOrZero(p) });
      }
    } catch {
      // Same tolerance as the mass-storage path.
    }
  }

  // ── Host transcode-tmp ─────────────────────────────────────────────────────
  try {
    const transcodeDirs = await walkAbandonedTranscodeDirs(
      input.tmpDirOverride ?? tmpdir(),
      input.sessionStartMsOverride ?? getSessionStartMs()
    );
    for (const d of transcodeDirs) {
      debris.push({ path: d.path, bytes: d.bytes });
    }
  } catch {
    // Same tolerance.
  }

  const totalBytes = debris.reduce((sum, d) => sum + d.bytes, 0);

  const result: PlanPreliminaries = {};
  if (debris.length > 0) {
    result.debrisCleanup = {
      paths: debris.map((d) => d.path),
      totalBytes,
    };
  }
  if (phantomPaths.length > 0) {
    result.phantomPrune = { paths: phantomPaths };
  }
  return result;
}

async function sizeOrZero(path: string): Promise<number> {
  try {
    const s = await stat(path);
    return s.size;
  } catch {
    return 0;
  }
}

// =============================================================================
// Executor pre-flight
// =============================================================================

/**
 * Result of the pre-flight: how many paths were removed and how many bytes
 * were freed. The executor logs a single line based on this so the user
 * can see what the pre-sync sweep did before track ops started.
 */
export interface PreFlightResult {
  /** Number of paths the pre-flight successfully unlinked. */
  debrisDeleted: number;
  /** Sum of bytes freed across successfully-deleted paths. */
  freedBytes: number;
  /** Paths where deletion failed (already surfaced as Warnings). */
  failedPaths: string[];
}

/**
 * Run the pre-flight cleanup that consumes a {@link PlanPreliminaries}.
 *
 * - **No-op** when `preliminaries` is undefined, when no `debrisCleanup`
 *   bucket is set, or when running in dry-run mode (the presenter
 *   reports preliminaries from the plan directly; the executor doesn't
 *   simulate them).
 * - **Tolerant of every individual unlink failure**: a single failure
 *   becomes a `Warning('debris-cleanup-failure')` and the loop continues.
 *   The pre-flight NEVER throws — the next sync will retry.
 * - **Phantom-manifest pruning is currently advisory**: if `phantomPrune`
 *   is set, a single advisory warning is emitted recommending the user
 *   run `podkit doctor --repair orphan-files` to clean up phantom rows.
 *   Full auto-pruning is deferred — the manifest-rewrite crosses adapter
 *   boundaries that this sweep deliberately avoids touching today.
 */
export async function runPreliminariesPreFlight(
  preliminaries: PlanPreliminaries | undefined,
  options: { dryRun: boolean; warningSink: WarningSink; signal?: AbortSignal }
): Promise<PreFlightResult> {
  const empty: PreFlightResult = { debrisDeleted: 0, freedBytes: 0, failedPaths: [] };
  if (!preliminaries || options.dryRun) return empty;

  const debris = preliminaries.debrisCleanup;
  let debrisDeleted = 0;
  let freedBytes = 0;
  const failedPaths: string[] = [];

  if (debris && debris.paths.length > 0) {
    // Distribute the totalBytes pessimistically across paths so a
    // pre-stat'd estimate is available even when a per-path stat fails
    // mid-unlink. The number is only used for the summary log line.
    const perPathEstimate = Math.floor(debris.totalBytes / debris.paths.length);

    for (const path of debris.paths) {
      if (options.signal?.aborted) break;
      try {
        // rm with recursive+force handles BOTH single files (e.g.
        // `.podkit-tmp` siblings) AND abandoned transcode-tmp
        // directories. No need to discriminate kind at the caller.
        await rm(path, { recursive: true, force: true });
        debrisDeleted += 1;
        freedBytes += perPathEstimate;
      } catch (err) {
        failedPaths.push(path);
        const warning: Warning = {
          phase: 'execute',
          type: 'debris-cleanup-failure',
          message: `Failed to clean up incomplete-write residue ${path}: ${err instanceof Error ? err.message : String(err)}`,
          // No track ref — debris isn't track-scoped.
          tracks: [],
        };
        options.warningSink.emit(warning);
      }
    }
  }

  // Phantom-manifest prune is currently advisory. Surface a single
  // warning per sweep when any phantom rows were detected so the user
  // knows to run doctor manually.
  if (preliminaries.phantomPrune && preliminaries.phantomPrune.paths.length > 0) {
    options.warningSink.emit({
      phase: 'execute',
      type: 'debris-cleanup-failure',
      message: `${preliminaries.phantomPrune.paths.length} phantom manifest entries detected. Run \`podkit doctor --repair orphan-files\` to prune them.`,
      tracks: [],
    });
  }

  return { debrisDeleted, freedBytes, failedPaths };
}
