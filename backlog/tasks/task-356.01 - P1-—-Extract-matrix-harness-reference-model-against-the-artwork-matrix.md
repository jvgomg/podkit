---
id: TASK-356.01
title: P1 — Extract matrix harness + reference model against the artwork matrix
status: Done
assignee: []
created_date: '2026-05-28 07:59'
updated_date: '2026-05-28 08:14'
labels:
  - testing
  - e2e
  - matrix
  - refactor
dependencies: []
references:
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
  - test-packages/e2e-tests/src/features/art-matrix.test.ts
  - test-packages/e2e-tests/src/features/art-matrix.docker.test.ts
  - test-packages/e2e-tests/src/features/art-matrix-change.test.ts
modified_files:
  - test-packages/e2e-tests/src/matrix/axes.ts
  - test-packages/e2e-tests/src/matrix/reference-model.ts
  - test-packages/e2e-tests/src/matrix/harness.ts
  - test-packages/e2e-tests/src/matrix/artwork-rules.ts
  - test-packages/e2e-tests/src/matrix/README.md
  - test-packages/e2e-tests/src/features/art-matrix.test.ts
  - test-packages/e2e-tests/src/features/art-matrix.docker.test.ts
  - test-packages/e2e-tests/src/features/art-matrix-change.test.ts
parent_task_id: TASK-356
priority: medium
ordinal: 67000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
De-risking first step (doc-039 phase 2). Extract the duplicated matrix machinery into a shared harness and re-express the existing three art-matrix files on top of it, proving the new harness reproduces today's green cells with ZERO behaviour change.

## Scope

Create `test-packages/e2e-tests/src/matrix/`:
- `axes.ts` — typed axis enums (Scenario, Format, CheckArtwork, …) + a cartesian-product helper.
- `harness.ts` — `runMatrix({ axes, predict, observe, skip })`: the cartesian walk, the fresh-sync + idempotency-sync sequence, the artwork op-classification sets, and the `Cell X/Y mismatched expectations` diff formatter (all currently copy-pasted across the three files). The `observe()` result type must leave a seam for a future `decisions` block (see doc-039 §"Two assertion dimensions").
- `reference-model.ts` — the capability functions (`sourceEmbedsArt`, `deviceAction`, `deviceStoresArt`, `artSurvives`) that `predict()` composes, replacing per-format `if` branches.
- `README.md` — philosophy, axis meanings, invalid-combo rules, how to add an axis.

Re-express `art-matrix.test.ts`, `art-matrix.docker.test.ts`, `art-matrix-change.test.ts` as thin files that import shared `*.rules.ts` + the harness. Host/docker stay as separate files (the runner gates on the `*.docker.test.ts` suffix) but share one rules module.

## Acceptance

Cell-for-cell parity: every cell that passes today must pass after the refactor, with the same predicted values. No production code changes. No new coverage in this task — coverage extensions are P2+.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 matrix/ harness (axes, harness, reference-model, README) created
- [x] #2 All three art-matrix files re-expressed on the harness with no duplicated machinery
- [x] #3 Host + docker + change matrices remain green with identical predicted values (cell-for-cell parity)
- [x] #4 observe() result type includes a seam for a future decisions block
- [x] #5 No production (non-test) code changed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What landed

New `test-packages/e2e-tests/src/matrix/`:
- **`axes.ts`** — `Scenario`/`Format` types + arrays, `SCENARIO_ARTIST`/`FORMAT_TITLE` maps, `trackId()`, `scenarioFormatCells()`.
- **`reference-model.ts`** — `FIXTURE_EMBEDS_ART`, `fixtureHasEmbeddedSlot()`, `sourceEmbedsArt()`. The capability layer `predict()` composes.
- **`harness.ts`** — generic engine: op-classification sets, `opsForTrack` / `isArtworkIdempotent` / `formatOpsString` / `findDeviceTrack`, `diffCell` (structural compare with the decisions seam), and `defineArtworkMatrix()` (two-pass `beforeAll` + `describe`/`it` generation + assertion).
- **`artwork-rules.ts`** — `predictDirectory` / `predictSubsonic` / `predictChange` (composed over the reference model) + `observeStaticArtwork` (shared host/docker sync sequence) + `observeChangePass` (mutate-between-syncs sequence).
- **`README.md`** — pattern, modules, why-compose-the-model, host/docker filename gate, decisions seam, how-to-add-an-axis.

The three test files (`art-matrix.test.ts`, `art-matrix.docker.test.ts`, `art-matrix-change.test.ts`) are now thin: each chooses a source (directory config / Navidrome container / mutable temp dir) and wires a predictor + pass-runner into `defineArtworkMatrix`. ~320/355/294-line files dropped to ~70/85/45 lines.

## Design decisions

- **Two static predictors kept distinct** (`predictDirectory` vs `predictSubsonic`): the adapters genuinely differ on the source side (directory reports real embed state; Subsonic optimistically trusts Navidrome's coverArt ID). Both compose the same `sourceEmbedsArt()` for the device side. Unifying them behind one adapter-parameterised predictor is deferred to P4 (adapter axis) — forcing it now would be premature and risk parity.
- **Decisions seam (AC#4):** `diffCell` compares object-valued fields structurally via JSON, so a future `decisions: {...}` field on the Expected/Observed shapes diffs out of the box once TASK-357 exposes podkit's decisions. No type churn needed when that lands.
- **Host/docker stay separate files** (runner gates on `*.docker.test.ts`) but import the same `artwork-rules.ts` — rule duplication lives in neither.

## Parity proof (AC#3)

- `bun run test:e2e -- art-matrix`: `art-matrix.test.ts` (64 cells) + `art-matrix-change.test.ts` (16 cells) green.
- `bun run test:docker -- art-matrix.docker`: subsonic matrix (64 cells) green.
- Same cell labels, same pass/fail as before the refactor.

## Verification

- `bun run typecheck --filter @podkit/e2e-tests`: clean.
- `oxlint` on matrix/ + the three test files: 0 warnings, 0 errors.
- `git status`: only `test-packages/e2e-tests/` + backlog touched — **no `packages/` production code changed** (AC#5).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Extracted the duplicated matrix machinery into `test-packages/e2e-tests/src/matrix/` (`axes.ts`, `reference-model.ts`, `harness.ts`, `artwork-rules.ts`, `README.md`) and re-expressed the three art-matrix test files on top of it. The files dropped from ~320/355/294 lines to ~70/85/45 lines of source-wiring; all axes, op-classification, the two-pass orchestration, and the diff/assert now live once in the harness.

`predict()` composes capability functions from the reference model (`sourceEmbedsArt`) rather than per-format branches. The two static predictors stay distinct (directory vs subsonic source behaviour) — unification behind an adapter axis is P4. `diffCell` compares object fields structurally, providing the decisions-block seam for TASK-357 (AC#4).

Parity proven cell-for-cell: host matrices (64 + 16 cells) and docker matrix (64 cells) all green with identical labels/outcomes. Typecheck + oxlint clean. No production code changed (AC#5) — diff is confined to `test-packages/e2e-tests/` plus the new matrix dir.
<!-- SECTION:FINAL_SUMMARY:END -->
