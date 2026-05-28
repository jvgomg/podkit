---
id: TASK-356.04
title: >-
  P4 — Add device + transfer-mode axes; migrate imperative codec/mass-storage
  tests
status: To Do
assignee: []
created_date: '2026-05-28 08:00'
labels:
  - testing
  - e2e
  - matrix
  - device
  - transfer-mode
dependencies:
  - TASK-356.01
  - TASK-356.03
references:
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
  - test-packages/e2e-tests/src/features/codec-preference.test.ts
  - test-packages/e2e-tests/src/features/mass-storage-sync.test.ts
  - test-packages/e2e-tests/src/features/preset-change.test.ts
parent_task_id: TASK-356
priority: medium
ordinal: 70000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-039 phase 5. With the harness (P1) and SyncTarget (P3) in place, promote device and transfer mode to real matrix axes and fold the existing imperative feature tests into concern matrices.

## Scope

- Add `device` axis: run the relevant concern matrices across `[ipod-MA147, mass-storage-echo-mini, mass-storage-generic]`; `predict()` keys off `target.capabilities`, not a hardcoded model.
- Add `transferMode` axis: `fast | optimized | portable`.
- Extend the `skip(cell)` predicate to prune redundant/impossible combos (e.g. transfer mode is a no-op on non-embedded-art devices; subsonic needs docker).
- Migrate `codec-preference.test.ts` and `mass-storage-sync.test.ts` (and codec/quality assertions from `preset-change.test.ts`) into concern matrices on the harness. Delete the bespoke per-file device-config plumbing now that P3's target generates it.

Depends on P1 (harness) and P3 (SyncTarget).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 device is a matrix axis spanning iPod + mass-storage presets; predict() keys off target.capabilities
- [ ] #2 transferMode (fast/optimized/portable) is a matrix axis
- [ ] #3 skip() prunes redundant/impossible/env-gated device×mode combos
- [ ] #4 codec-preference + mass-storage-sync imperative tests migrated into concern matrices (old files removed or reduced to non-matrix smoke)
- [ ] #5 Full suite green
<!-- AC:END -->
