---
id: TASK-477
title: save-failure-matrix VM beforeAll wedges at 60s VM_COLD_TIMEOUT_MS
status: In Progress
assignee: []
created_date: '2026-08-06 19:18'
updated_date: '2026-08-06 20:41'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Diagnosed via systematic instrumentation (per-cell timing in the beforeAll). Findings refuted the "one cell hangs" and "matrix grew" theories:

- Per-cell timing (one full run): prepare() +20.2s, then 27 non-skipped cells each a uniform 1.6–2.9s (no outlier), total 82.5s. No hang; no slow cell.
- The cell generator (matrix/save-failure-rules.ts) is UNCHANGED since TASK-416 (4807d9de) — before TASK-475's last-green commit (17c94667). Same 27 cells then and now, so the matrix did not grow.

Root cause: the observation `beforeAll` runs all 27 non-skipped cells SEQUENTIALLY against the one shared VM mount (cells mutate the mount, so they cannot parallelise), plus a ~20s prepare() — aggregate ~82s — under a single FIXED 60s VM_COLD_TIMEOUT_MS. That budget was always marginal (~45–82s depending on machine load) and normal VM-perf variance now tips it over. It's an under-provisioned hook timeout, not a wedge.

Why raising it is NOT masking a real regression: each cell's internal VM ops are individually bounded by VM_WARM_TIMEOUT_MS (10s) and caught per-cell (recorded as observeError), so a genuine single-cell hang surfaces as an error, never as this aggregate hook timeout. The hook timeout only ever fires on the aggregate — so scaling the aggregate budget to the matrix size is the correct fix and cannot hide a per-cell hang.

Fix (save-failure-matrix.e2e.test.ts): derive the observe-hook budget from the matrix size — `OBSERVE_ALL_CELLS_TIMEOUT_MS = VM_COLD_TIMEOUT_MS + SAVE_FAIL_CELLS.length * VM_WARM_TIMEOUT_MS` (60s cold baseline + one warm-op budget per cell) = 330s for the current 27 cells (~4× the observed 82s, ample headroom for machine variance). Structural, so adding cells auto-extends the budget and it can never silently re-wedge.

Verified: `bun test src/save-failure-matrix.e2e.test.ts` → 27 pass / 0 fail / 82.19s (well under the 330s ceiling). The 60s hook-timeout no longer reproduces. typecheck clean; all [DEBUG-477] instrumentation removed.

Regression guard: no clean unit seam exists for a VM hook-timeout budget (the "no correct seam → that's the finding" case). The derived-from-cell-count budget IS the guard and is documented in a code comment at the constant.

Observation (out of scope, flag): prepare() takes ~20s — worth a look as a separate VM-harness perf item if setup time matters. Also: TASK-476.01's Run 1 saw doctor-scope-refactor.e2e.test.ts time out at 88s once (passed on rerun) — likely the same fixed-budget-too-tight class; a full `bun run quality` will confirm whether it needs the same treatment.

Unblocks the full-green acceptances of TASK-476.01 (AC#4) and TASK-476.04 (AC#6, together with a live :rc).
<!-- SECTION:NOTES:END -->
