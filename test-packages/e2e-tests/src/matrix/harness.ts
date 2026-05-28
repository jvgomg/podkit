/**
 * Generic matrix-test harness.
 *
 * Owns the machinery that was copy-pasted across the three `art-matrix*`
 * files: operation classification, the device-track lookup, the two-pass
 * (`--check-artwork` off/on) `beforeAll` orchestration, and the per-cell
 * expected-vs-observed diff + assertion.
 *
 * Concern modules (e.g. `artwork-rules.ts`) supply the axes, a `predict()`,
 * and a `runPass()` that produces the observed map; this harness wires them
 * into `describe`/`it` blocks.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import type { TrackInfo } from '@podkit/gpod-testing';
import type { SyncOutput } from 'podkit/types';
import { trackId } from './axes.js';

// ---------------------------------------------------------------------------
// Operation classification
// ---------------------------------------------------------------------------

/** `reason` values on an upgrade op that indicate artwork churn. */
export const ARTWORK_OP_REASONS = new Set(['artwork-added', 'artwork-updated', 'artwork-removed']);
/** Operation types that re-add a track. */
export const ADD_OP_TYPES = new Set(['add-transcode', 'add-direct-copy', 'add-optimized-copy']);
/** Operation types that replace an existing track's file. */
export const UPGRADE_OP_TYPES = new Set([
  'upgrade-transcode',
  'upgrade-direct-copy',
  'upgrade-optimized-copy',
]);

/** Minimal projection of a sync operation used by the matrix. */
export interface OpSummary {
  type: string;
  reason?: string;
}

/** All operations in a dry-run output that target a given track. */
export function opsForTrack(dryJson: SyncOutput, artist: string, title: string): OpSummary[] {
  const target = trackId(artist, title);
  return (dryJson.operations ?? [])
    .filter((op) => (op.track ?? '') === target)
    .map((op) => ({ type: op.type, reason: op.reason }));
}

/**
 * Whether a track's second-sync operations are free of artwork churn — i.e.
 * no re-add, no standalone `upgrade-artwork`, and no file-replacement upgrade
 * carrying an artwork reason. This is the "idempotent" signal for the static
 * artwork matrices.
 */
export function isArtworkIdempotent(ops: OpSummary[]): boolean {
  return !ops.some(
    (op) =>
      op.type === 'upgrade-artwork' ||
      ADD_OP_TYPES.has(op.type) ||
      (UPGRADE_OP_TYPES.has(op.type) &&
        op.reason !== undefined &&
        ARTWORK_OP_REASONS.has(op.reason))
  );
}

/**
 * Whether a track's second-sync operations contain no track-add or
 * file-replacement upgrade — the "nothing left to do" signal for concerns
 * (like the codec matrix) where any add/upgrade on the second sync means the
 * first sync didn't converge.
 */
export function isStableNoFileOp(ops: OpSummary[]): boolean {
  return !ops.some((op) => ADD_OP_TYPES.has(op.type) || UPGRADE_OP_TYPES.has(op.type));
}

/** Sorted `type:reason` join — the change matrix's op fingerprint. */
export function formatOpsString(ops: OpSummary[]): string {
  return ops
    .map((op) => `${op.type}:${op.reason ?? ''}`)
    .sort()
    .join(',');
}

/** Find a device track by exact artist + title. */
export function findDeviceTrack(
  tracks: readonly TrackInfo[],
  artist: string,
  title: string
): TrackInfo | undefined {
  return tracks.find((t) => t.artist === artist && t.title === title);
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

function render(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/**
 * Diff an expected cell against an observed cell. Compares every key of
 * `expected` except `reason` (which is documentation, not an assertion).
 *
 * Object-valued fields (the seam for a future `decisions` block — see doc-039
 * §"Two assertion dimensions") are compared structurally via JSON. When any
 * field differs and the observed cell carries a `secondSyncOps` debug echo,
 * it is appended to aid diagnosis.
 */
export function diffCell(
  expected: Record<string, unknown>,
  observed: Record<string, unknown>
): string[] {
  const diffs: string[] = [];
  for (const key of Object.keys(expected)) {
    if (key === 'reason') continue;
    const e = expected[key];
    const o = observed[key];
    const differs =
      e !== null && o !== null && typeof e === 'object' && typeof o === 'object'
        ? JSON.stringify(e) !== JSON.stringify(o)
        : !Object.is(e, o);
    if (differs) {
      diffs.push(`  ${key}: expected=${render(e)}, observed=${render(o)}`);
    }
  }
  if (diffs.length > 0) {
    // Echo any operation-trace field (e.g. `secondSyncOps`, `planOps`) to aid
    // diagnosis of a mismatched cell.
    for (const key of Object.keys(observed)) {
      if (key.endsWith('Ops')) {
        diffs.push(`    ${key}: ${JSON.stringify(observed[key])}`);
      }
    }
  }
  return diffs;
}

// ---------------------------------------------------------------------------
// Skip taxonomy
// ---------------------------------------------------------------------------

/**
 * Why a cell is not asserted. The `kind` is load-bearing — it separates
 * *permanent* prunings from *deferred work*:
 *
 * - `redundant` / `impossible` / `env` — **structural**. The cell is not
 *   meaningful to assert, ever. These are correct-by-design and never become
 *   work. A structural skip is not a bug.
 * - `bug` — **deferred work**. The cell *could* be asserted but podkit's
 *   behaviour is currently broken, so it's fenced off rather than failing the
 *   suite. Every `bug` skip is a known defect that needs fixing; `ref` points
 *   at where it's tracked (a task id or a doc section).
 *
 * This is the dividing line the suite makes visible: a green run with only
 * structural skips has nothing hidden; any `bug` skip is outstanding work.
 * Grep the source for `skipBug(` (or filter the runner output for `[BUG]`) to
 * enumerate exactly what needs attention.
 */
export type SkipKind = 'redundant' | 'impossible' | 'env' | 'bug';

export interface SkipDecision {
  kind: SkipKind;
  reason: string;
  /** For `bug` skips: where the defect is tracked (task id / doc section). */
  ref?: string;
}

/** A cell that is permanently not worth asserting (a no-op everywhere it's pruned). */
export function skipRedundant(reason: string): SkipDecision {
  return { kind: 'redundant', reason };
}
/** A cell that cannot exist (e.g. sidecar art on a non-sidecar adapter). */
export function skipImpossible(reason: string): SkipDecision {
  return { kind: 'impossible', reason };
}
/** A cell gated on an absent environment (Docker, real hardware). */
export function skipEnvGated(reason: string): SkipDecision {
  return { kind: 'env', reason };
}
/**
 * A cell fenced off because podkit is currently broken for it — **deferred
 * work, not a permanent prune**. Pass a `ref` (task id / doc section) so the
 * defect is traceable.
 */
export function skipBug(reason: string, ref?: string): SkipDecision {
  return ref !== undefined ? { kind: 'bug', reason, ref } : { kind: 'bug', reason };
}

/** Render a skip decision as the `it.skip` title suffix, tagging bugs loudly. */
function skipTitle(label: string, d: SkipDecision): string {
  if (d.kind === 'bug') {
    const ref = d.ref ? ` ${d.ref}` : '';
    return `[BUG]${ref} ${label} — ${d.reason}`;
  }
  return `[skip:${d.kind}] ${label} — ${d.reason}`;
}

// ---------------------------------------------------------------------------
// Matrix definition
// ---------------------------------------------------------------------------

/** Any expected cell must carry a documentation `reason`. */
export interface CellExpectation {
  reason: string;
}

export interface MatrixDef<Cell, Expected extends CellExpectation, Observed> {
  /** `describe` title for the whole matrix. */
  title: string;
  /** The cells to assert (the axis subset this concern varies). */
  cells: readonly Cell[];
  /** Stable key for a cell, shared between `predict` lookup and `runPass` map. */
  cellKey: (cell: Cell) => string;
  /** Human label for the `it` block. */
  cellLabel: (cell: Cell) => string;
  /** The pass dimension. Defaults to `[false, true]` (--check-artwork). */
  passes?: readonly boolean[];
  /** Label for a pass value. Defaults to `--check-artwork on/off`. */
  passLabel?: (pass: boolean) => string;
  /** Predicted outcome for a cell under a given pass. */
  predict: (cell: Cell, pass: boolean) => Expected;
  /**
   * Prune a cell from the asserted product, or `null` to assert it. Returns a
   * typed {@link SkipDecision} so structural prunings (`redundant`/`impossible`
   * /`env`) are distinguishable from `bug` deferrals at a glance — in the code
   * (the `skipBug(` call site) and in the runner (`[BUG]` vs `[skip:kind]`).
   * Skipped cells are not looked up in the observed map, so `runPass` may
   * consult the same predicate to avoid syncing them.
   */
  skip?: (cell: Cell) => SkipDecision | null;
  /** Run one pass (a fresh sync sequence) → observed map keyed by `cellKey`. */
  runPass: (pass: boolean) => Promise<Map<string, Observed>>;
  /** Optional one-time setup before any pass runs (e.g. start a container). */
  setup?: () => Promise<void>;
  /** Optional one-time teardown after all passes. */
  teardown?: () => Promise<void>;
  /** Timeout for the combined setup + all passes. */
  timeoutMs?: number;
}

/**
 * Register a matrix: orchestrates `setup` + every `runPass` in `beforeAll`,
 * then emits one `describe` per pass and one `it` per cell asserting
 * `predict === observe`.
 */
export function defineArtworkMatrix<
  Cell,
  Expected extends CellExpectation,
  Observed extends Record<string, unknown>,
>(def: MatrixDef<Cell, Expected, Observed>): void {
  const passes = def.passes ?? [false, true];
  const passLabel = def.passLabel ?? ((pass: boolean) => `--check-artwork ${pass ? 'on' : 'off'}`);
  const resultsByPass = new Map<boolean, Map<string, Observed>>();

  beforeAll(async () => {
    if (def.setup) await def.setup();
    for (const pass of passes) {
      resultsByPass.set(pass, await def.runPass(pass));
    }
  }, def.timeoutMs ?? 900000);

  if (def.teardown) {
    afterAll(async () => {
      await def.teardown!();
    });
  }

  describe(def.title, () => {
    for (const pass of passes) {
      describe(passLabel(pass), () => {
        for (const cell of def.cells) {
          const skip = def.skip?.(cell) ?? null;
          if (skip !== null) {
            it.skip(skipTitle(def.cellLabel(cell), skip), () => {});
            continue;
          }
          const expected = def.predict(cell, pass);
          it(def.cellLabel(cell), () => {
            const byKey = resultsByPass.get(pass);
            expect(byKey).toBeDefined();
            const observed = byKey!.get(def.cellKey(cell));
            expect(observed).toBeDefined();

            const diffs = diffCell(
              expected as unknown as Record<string, unknown>,
              observed as unknown as Record<string, unknown>
            );
            if (diffs.length > 0) {
              throw new Error(
                `Cell ${def.cellLabel(cell)} (${passLabel(pass)}) mismatched expectations:\n${diffs.join(
                  '\n'
                )}\n  rule: ${expected.reason}`
              );
            }
          });
        }
      });
    }
  });
}
