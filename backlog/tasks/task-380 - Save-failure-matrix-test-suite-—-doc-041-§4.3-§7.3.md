---
id: TASK-380
title: Save-failure matrix test suite — doc-041 §4.3/§7.3
status: To Do
assignee: []
created_date: '2026-06-03 09:09'
labels:
  - testing
  - e2e
  - matrix
  - save-transaction
  - reliability
dependencies:
  - TASK-142
references:
  - test-packages/e2e-tests/src/matrix/
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
  - backlog/docs/doc-041 - Save-Transaction-Design-and-State-of-Play.md
priority: medium
ordinal: 106000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`doc-041 §4.3` proposes a matrix harness sweeping (device × failure-mode × recovery-strategy) so save() failure semantics get the same coverage rigor as artwork/codec already have via doc-039's matrix harness.

## Scope

1. New matrix file `test-packages/e2e-tests/src/matrix/save-failure-rules.ts` + `features/save-failure.test.ts`. Reuses the harness from doc-039.
2. Cells assert:
   - Which `save()` stage throws under the failure mode (tag/picture/move/sidecar).
   - What landed on disk (probed via filesystem walk).
   - What the next sync sees on rescan (idempotent, re-fires diff, or churn-loops).
   - What `podkit doctor` could clean (typed cleanup category — see TASK-375).
3. Initial axes:
   - devices: `[ipod-MA147, ms-echo-mini, ms-generic, ms-rockbox]`
   - failure-modes: `[tag-write-fail, picture-write-fail, move-fail, sidecar-write-fail, ENOSPC, EACCES]`
   - recovery: derived (one of `next-save-retries`, `rescan-redetects`, `doctor-cleans`, `user-reports-bug`)
4. Fence currently-undefined behaviour with `skipBug` referencing this task or follow-ups.

## Why this matters

Demonstrates podkit's resilience claim ("incremental sync + self-healing + doctor cleanup") with executable evidence, not docs. Every new failure mode discovered in the wild gets a row.

## Reference

`doc-041` §4.3 + §7.3.
<!-- SECTION:DESCRIPTION:END -->
