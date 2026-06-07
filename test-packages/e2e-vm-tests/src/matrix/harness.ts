/**
 * Minimal matrix-test harness for VM-resident concerns.
 *
 * Mirrors the shape of `test-packages/e2e-tests/src/matrix/harness.ts` so the
 * save-failure matrix here composes the same predict/observe/diff pattern as
 * the host matrices. Inlined (not imported from `@podkit/e2e-tests`) to avoid
 * pulling that package's full host-side dependency graph (podkit + gpod-testing
 * + targets) into the VM test package. TASK-380's spec defers the question of
 * whether to lift this into a shared package until after the matrix has
 * landed.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

// ---------------------------------------------------------------------------
// Skip taxonomy — copied verbatim from the host harness.
// ---------------------------------------------------------------------------

export type SkipKind = 'redundant' | 'impossible' | 'env' | 'bug';

export interface SkipDecision {
  kind: SkipKind;
  reason: string;
  ref?: string;
}

export function skipRedundant(reason: string): SkipDecision {
  return { kind: 'redundant', reason };
}
export function skipImpossible(reason: string): SkipDecision {
  return { kind: 'impossible', reason };
}
export function skipEnvGated(reason: string): SkipDecision {
  return { kind: 'env', reason };
}
export function skipBug(reason: string, ref?: string): SkipDecision {
  return ref !== undefined ? { kind: 'bug', reason, ref } : { kind: 'bug', reason };
}

function skipTitle(label: string, d: SkipDecision): string {
  if (d.kind === 'bug') {
    const ref = d.ref ? ` ${d.ref}` : '';
    return `[BUG]${ref} ${label} — ${d.reason}`;
  }
  return `[skip:${d.kind}] ${label} — ${d.reason}`;
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

function render(value: unknown): string {
  if (value instanceof RegExp) return value.toString();
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/**
 * Diff an expected cell against an observed cell.
 *
 *   - Compares every key of `expected` except `reason` (documentation, not
 *     an assertion).
 *   - Keys whose name ends in `Matches` and whose expected value is a
 *     `RegExp` are tested via `regex.test(observed[siblingKey])` where
 *     `siblingKey` strips the `Matches` suffix and lowercases the first
 *     character (e.g. `errorMessageMatches` → `errorMessage`). A `null`
 *     regex means "no constraint" — the observed sibling field is not
 *     asserted at all.
 *   - Object-valued fields compared structurally via JSON.
 */
export function diffCell(
  expected: Record<string, unknown>,
  observed: Record<string, unknown>
): string[] {
  const diffs: string[] = [];
  const regexSiblings = new Set<string>();
  for (const key of Object.keys(expected)) {
    if (key === 'reason') continue;
    const e = expected[key];

    // Regex-paired key: assert that `regex.test(observed[siblingKey])`.
    if (key.endsWith('Matches') && (e instanceof RegExp || e === null)) {
      const siblingKey = key.slice(0, -'Matches'.length);
      regexSiblings.add(siblingKey);
      if (e === null) continue;
      const oSibling = observed[siblingKey];
      if (typeof oSibling !== 'string' || !(e as RegExp).test(oSibling)) {
        diffs.push(`  ${key}: expected=${render(e)}, observed.${siblingKey}=${render(oSibling)}`);
      }
      continue;
    }

    // `Count` suffix keys treat `expected === null` as "no constraint".
    // This is the matrix's escape hatch for fields whose precise value is
    // environment-sensitive (e.g. retry-policy artifacts) but whose
    // presence still needs to be tracked.
    if (key.endsWith('Count') && e === null) {
      continue;
    }

    const o = observed[key];
    const differs =
      e !== null && o !== null && typeof e === 'object' && typeof o === 'object'
        ? JSON.stringify(e) !== JSON.stringify(o)
        : !Object.is(e, o);
    if (differs) {
      diffs.push(`  ${key}: expected=${render(e)}, observed=${render(o)}`);
    }
  }
  // Suppress the regex-paired siblings from the debug echo so the diff
  // doesn't echo "observed.errorMessage" twice.
  if (diffs.length > 0) {
    for (const key of Object.keys(observed)) {
      if (regexSiblings.has(key)) continue;
      if (key.endsWith('Ops') || key === 'debug') {
        diffs.push(`    ${key}: ${JSON.stringify(observed[key])}`);
      }
    }
  }
  return diffs;
}

// ---------------------------------------------------------------------------
// Matrix definition
// ---------------------------------------------------------------------------

export interface CellExpectation {
  reason: string;
}

export interface MatrixDef<Cell, Expected extends CellExpectation, Observed> {
  title: string;
  cells: readonly Cell[];
  cellKey: (cell: Cell) => string;
  cellLabel: (cell: Cell) => string;
  passes: readonly boolean[];
  passLabel?: (pass: boolean) => string;
  predict: (cell: Cell, pass: boolean) => Expected;
  skip?: (cell: Cell) => SkipDecision | null;
  runPass: (pass: boolean) => Promise<Map<string, Observed>>;
  setup?: () => Promise<void>;
  teardown?: () => Promise<void>;
  timeoutMs?: number;
}

/**
 * Register a matrix: orchestrates `setup` + every `runPass` in `beforeAll`,
 * then emits one `describe` per pass and one `it` per cell asserting
 * `predict === observe`.
 */
export function defineMatrix<
  Cell,
  Expected extends CellExpectation,
  Observed extends Record<string, unknown>,
>(def: MatrixDef<Cell, Expected, Observed>): void {
  const passes = def.passes;
  const passLabel = def.passLabel ?? ((pass: boolean) => String(pass));
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
