---
id: TASK-355
title: Artwork-handling bugs surfaced by the art-matrix tests
status: To Do
assignee: []
created_date: '2026-05-26 22:48'
labels:
  - bug
  - artwork
  - test-driven
dependencies: []
references:
  - test-packages/e2e-tests/src/features/art-matrix.test.ts
  - test-packages/e2e-tests/src/features/art-matrix.docker.test.ts
  - test-packages/e2e-tests/src/features/art-matrix-change.test.ts
  - test-packages/test-fixtures/src/static/audio-multi-format.ts
priority: medium
ordinal: 60000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`test-packages/e2e-tests/src/features/art-matrix.test.ts`, `art-matrix.docker.test.ts`, and `art-matrix-change.test.ts` form a prediction-vs-observation matrix over the (scenario × audio format × `--check-artwork`) grid for podkit's two source adapters (directory and Subsonic/Navidrome). Each cell's expected outcome is encoded by a rule-based `predict()` function and asserted against the result of a real sync; the `reason` string on each cell documents why the outcome is what it is. When a bug fix lands, the matrix fails until the prediction is updated — making the matrix files themselves a living regression catalogue.

Running the matrix today is green, but several cells encode current *buggy* behaviour. This umbrella task collects the bugs the matrix surfaced. Subtasks investigate and fix each one. When a bug is fixed, the matching matrix cells must be updated to predict the new (correct) outcome — that update is part of each subtask's scope.

## How to use the matrix

1. Read the `predict()` function in the relevant `art-matrix*.test.ts` file. Each branch documents one rule of current podkit behaviour.
2. Cells whose `reason` mentions "bug" or "spurious" or "loop" are bugs encoded as current behaviour.
3. Pick a bug, implement the fix, re-run the matrix. The cells that flip will fail. Update the predictor to encode the new (correct) outcome and the reason string. Test passes again, regression is locked in.

## Subtasks

Each subtask is independently grabbable. None depend on the others. All target the matrix files plus the code path that produced the bug.

## References

- `test-packages/e2e-tests/src/features/art-matrix.test.ts` — host (directory adapter) matrix
- `test-packages/e2e-tests/src/features/art-matrix.docker.test.ts` — Subsonic/Navidrome matrix
- `test-packages/e2e-tests/src/features/art-matrix-change.test.ts` — artwork-change detection matrix (host)
- `test-packages/test-fixtures/src/static/audio-multi-format.ts` — the parameterised fixture generator and the four scenario variants (none / embedded / sidecar / both) plus the `-alt` cover-swap variant used by the change matrix
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All subtasks reach Done
- [ ] #2 All three art-matrix test files remain green after each subtask lands
<!-- AC:END -->
