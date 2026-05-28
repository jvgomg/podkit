# E2E sync-matrix harness

Shared machinery for podkit's rule-based **prediction vs observation** matrix
tests. Full strategy, rationale, and roadmap: **backlog `doc-039 — E2E Sync
Matrix Testing Strategy`**. This README is the how-to for the code here.

## The pattern

A matrix walks a cross-product of axes (scenario, format, `--check-artwork`, …)
and, for each cell:

1. `predict(cell, pass)` → the outcome we *believe* podkit produces today, plus
   a `reason` string documenting *why*.
2. `runPass(pass)` → performs a real sync sequence and returns the *observed*
   outcome per cell.
3. The harness asserts `predict === observe`, cell by cell, with a precise diff
   on mismatch.

The prediction **is** the assertion — there is no `expectedBroken` flag. When a
code change flips a cell, the test fails and you either accept the change
(update the rule) or revert the regression. Cells whose `reason` mentions "bug"
encode current-but-wrong behaviour as a living regression catalogue.

## Modules

| File | Role |
|------|------|
| `axes.ts` | Typed axis values (`Scenario`, `Format`), the artist/title maps, `trackId`, cell builders. The home for new axes. |
| `reference-model.ts` | Capability functions (`sourceEmbedsArt`, …) — a small model of podkit's sync semantics that `predict()` composes. **Not** per-format `if` branches. |
| `harness.ts` | Generic engine: op-classification, `opsForTrack`/`isArtworkIdempotent`/`formatOpsString`/`findDeviceTrack`, the cell diff, and `defineArtworkMatrix()` (two-pass `beforeAll` + `describe`/`it` generation). |
| `artwork-rules.ts` | The artwork concern: `predictDirectory` / `predictSubsonic` / `predictChange` and the `observe*` sync sequences shared by the test files. |

The thin test files (`features/art-matrix*.test.ts`) only choose a source and
wire a predictor + pass-runner into `defineArtworkMatrix`.

## Why `predict()` composes the reference model

Per-format / per-device `if` branches explode combinatorially as axes are
added. Expressing rules as composition of capability functions
(`sourceEmbedsArt(scenario, format)`, and — later — `deviceAction`,
`deviceStoresArt`, `artSurvives`) keeps the rule set linear in the number of
capabilities, not the number of cells. When the reference model and the real
system disagree, exactly one is wrong; the cell's `reason` says which we
currently believe.

## The `--check-artwork` pass dimension

`defineArtworkMatrix` runs each matrix twice (`[false, true]`) — this is the
`passes` dimension. Each value gets its own `runPass`, and the predictor
receives the pass value. Override `passes` / `passLabel` for non-artwork
concerns.

## Host vs docker (filename gate)

The test runner gates on the `*.docker.test.ts` suffix (`--exclude` for host,
`--pattern` for docker), so Subsonic cells **cannot** share a file with host
cells. The directory and Subsonic matrices are therefore separate test files
that import the **same** `artwork-rules.ts` — duplication lives in neither.

## Decision-assertion seam

`diffCell` compares object-valued fields structurally (JSON). A future
`decisions` object on the Expected/Observed shapes (e.g. the auto-selected
transfer mode, the resolved codec) therefore diffs out of the box, once podkit
exposes those decisions (TASK-357). See doc-039 §"Two assertion dimensions".

## Adding a new axis

1. Add the axis values + types to `axes.ts`.
2. Add the capability function(s) it affects to `reference-model.ts`.
3. Extend the concern's `predict()` to compose the new capability.
4. Extend the concern's `observe*` to vary the axis in the sync sequence.
5. Add a `skip(cell)` predicate (planned) to prune impossible/redundant/
   env-gated combinations before the product explodes.
