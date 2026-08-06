---
id: TASK-477
title: save-failure-matrix VM beforeAll wedges at 60s VM_COLD_TIMEOUT_MS
status: To Do
assignee: []
created_date: '2026-08-06 19:18'
labels:
  - testing
  - vm
  - bug
  - flaky
milestone: m-22
dependencies: []
references:
  - test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts
priority: high
ordinal: 241000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Symptom:** `bun run quality` (and any full `test:vm`) fails in phase-1 `@podkit/e2e-vm-tests#test:vm`: `save-failure-matrix.e2e.test.ts` `beforeAll` hits its `VM_COLD_TIMEOUT_MS` (60000ms) hook timeout — reproducibly, at ~exactly 60s, even as a single isolated file on a freshly-cleaned harness (dangling podkit-daemon killed, stale mounts cleared; host load 2.3, VM load 0.54 — not concurrency contention). Surfaced during TASK-476.01 (quality→local mirror); the package.json script change only reorders the identical `turbo run qa`/`test:vm`, so it cannot be the cause.

**Root shape (save-failure-matrix.e2e.test.ts:1097-1121):** the single `beforeAll` loops the ENTIRE `SAVE_FAIL_CELLS` matrix, calling `observeCell(cell)` (each a VM operation, internally bounded by `VM_WARM_TIMEOUT_MS`) for every non-skipped cell, and the whole aggregate loop is bounded by ONE `VM_COLD_TIMEOUT_MS = 60000`. The aggregate now exceeds 60s. Classic "unbounded loop under a single fixed timeout" wedge.

**Was green recently:** the file is unmodified since TASK-416 (commit 4807d9de), which predates TASK-475's "quality:rc green end-to-end" commit (17c94667) — so `test:vm` passed with this file recently. Likely either matrix growth, per-cell VM-op slowdown (near-full-mount provisioning / disk / env drift), or a single cell now hanging to its warm timeout and eating the whole cold budget.

**Do NOT blindly bump the timeout** — that may mask a real regression in the near-full-mount provisioning path. Diagnose first (which cell(s) consume the budget; is one hanging vs. all merely slow), then fix appropriately: raise/split the per-cell budget, move provisioning off the single cold-timeout, parallelise/serialise cells, or fix the slow VM op. Run 1 also saw `doctor-scope-refactor.e2e.test.ts` take 88s (passed on rerun) — a secondary signal the harness VM is running slow right now; confirm whether that's the same underlying provisioning slowdown.

**Why high / blocking:** gates the full-green acceptance of TASK-476.01 (AC#4 `bun run quality` green) and the end-to-end acceptance of TASK-476.04 (AC#6 `quality:rc` green). The epic's code is complete and correct; only the green run is blocked by this pre-existing VM-test-health issue.

Recommended approach: use systematic-debugging — instrument the `beforeAll` to time each cell's `observeCell`, identify the budget consumer, then fix root cause.
<!-- SECTION:DESCRIPTION:END -->
