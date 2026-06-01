---
id: TASK-369
title: 'Matrix coverage: assert "other" codec key source in single-stack cells'
status: Done
assignee: []
created_date: '2026-06-01 20:11'
updated_date: '2026-06-01 21:10'
labels:
  - test
  - matrix
dependencies:
  - TASK-368
references:
  - test-packages/e2e-tests/src/matrix/config-rules.ts
  - packages/podkit-cli/src/commands/sync-decisions.test.ts
modified_files:
  - test-packages/e2e-tests/src/matrix/config-rules.ts
priority: low
ordinal: 95000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up surfaced during TASK-368 sonnet review.

The config-inheritance matrix cells in `test-packages/e2e-tests/src/matrix/config-rules.ts` pin ONE setting at ONE level and assert only that setting's `source`. They don't assert the *other* codec key's source in the same run.

Consequence: a regression that reinstated the old TASK-367 single-source behavior (where a `[devices.x.codec] lossy = [...]` block stamped `losslessCodec.source = 'device'`) would not be caught by the matrix. Today this is covered by a unit test in `packages/podkit-cli/src/commands/sync-decisions.test.ts` ("split stacks: lossy from global + lossless from device"), so the gap is integration-level only.

## Fix sketch
Extend `predictConfig` (or add a sibling matrix axis) so that single-stack codec cells *also* assert the un-pinned key's source. e.g. when `lossyCodec/device` is the cell:
- assert `lossyCodec.source === 'device'` (existing)
- assert `losslessCodec.source === 'default'` (new)

Alternatively, add a separate "split" cell axis (lossy at level A, lossless at level B) for explicit coverage of the split case.

## Why low priority
Unit-level regression coverage exists; matrix gap is belt-and-suspenders. Worth filling when next touching the matrix.
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Closed the matrix coverage gap by extending codec cells to assert ALL FOUR codec keys' sources in one go, not just the cell's primary setting.

## Design

Added a `CodecSources` map to `ConfigExpected` / `ConfigObserved`. Codec cells now assert:
- Pinned stack's scalar AND preference both carry the cell's level (intra-stack invariant — both keys driven by the same `lossyCodecSource`/`losslessCodecSource` in sync.ts).
- Un-pinned stack's two keys carry `'default'` (cross-stack independence).

This catches three regression shapes:
1. **TASK-367 single-source contamination** — one source stamped onto all four keys.
2. **Intra-stack drift** — scalar/preference for the same stack diverge despite sharing a source variable.
3. **Cross-stack leakage** — un-pinned stack accidentally picks up the pinned stack's source.

## Sonnet review iteration

First attempt paired cross-stack only (`lossyCodec↔losslessCodec`), which sonnet flagged as missing the canonical TASK-367 bug shape (where the bug stamps both scalar AND preference within the same stack via one variable). Replaced with the all-four `codecSources` map. A second iteration discovered a JSON.stringify key-order mismatch between predictor and observer that caused all 12 codec cells to false-fail; canonicalized the insertion order. Final sonnet pass confirmed both regression shapes are caught and no vacuous assertions remain.

## Files

- `test-packages/e2e-tests/src/matrix/config-rules.ts` — new `CodecSources` interface and `expectedCodecSources(cell)` helper; `predictCodecScalar` + `predictCodecPreference` set `codecSources` for all three reachable levels; `readDecisionForSetting` returns `codecSources` for codec settings (using the same key order).

## Verification

- Matrix e2e: 25 pass / 17 skipImpossible / 0 fail. Same cell count as before — assertions extended per-cell, no new cells added.
- No CLI rebuild needed (pure test-package change).
- Two-pass sonnet review confirms the assertion is meaningful and the key-order matches.
<!-- SECTION:FINAL_SUMMARY:END -->
