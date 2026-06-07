---
id: TASK-378
title: >-
  Free-space handling review: probe, strategy, error surface, tests — doc-041
  §5.3
status: To Do
assignee: []
created_date: '2026-06-03 09:08'
updated_date: '2026-06-07 12:18'
labels:
  - enhancement
  - save-transaction
  - preflight
  - reliability
dependencies:
  - TASK-142
  - TASK-397
  - TASK-398
references:
  - packages/podkit-core/src/device/
  - backlog/docs/doc-041 - Save-Transaction-Design-and-State-of-Play.md
priority: low
ordinal: 104000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background (updated 2026-06-06)

Originally filed as "add a pre-save free-space probe". Discovered during TASK-380 thin-slice cell wiring (2026-06-06) that podkit **already has a planner-level free-space pre-flight check** — a near-full mount makes `podkit sync` exit with `{success: false, error: "Not enough space. Need 443.5 KB, have 408.0 KB"}` BEFORE save() runs. ENOSPC never reaches the typed-error path because the planner gates it upstream.

This **changes the task**. The free-space probe exists. What's now unclear is whether the existing implementation is the best possible version of it — across all the situations a user can hit ENOSPC, the error surface they see, the strategy podkit chooses, and the test coverage that pins all of it.

**TASK-380 Phase C.2 fan-out (2026-06-06)** surfaced two additional gaps adjacent to free-space + error-reporting concerns that are folded into this audit:

- **`--json` envelope drops typed-error-class info.** The Phase C.2 matrix had to drop `sync --json` and parse `-vv` stderr text to recover error-class strings. Neither `sync --json` nor `doctor --json` surfaces the typed `CategorizedSyncError` subclass — the `errors[]` array is empty for ENOSPC-style failures. This contradicts `documents/architecture/sync/error-handling.md`'s claim that typed errors flow through `--json`. Material architecture gap; folded here because the free-space pre-flight is the primary place this hurts JSON consumers.
- **Planner OGG filetype-label gap.** OGG sources land on device with extension `.Audio file` because the planner's filetype-label resolution falls through to a generic fallback. Surfaced incidentally by the chmod-fault matrix and adjacent to the planner audit this task does.

## Scope (revised)

A holistic review + improvement pass over podkit's free-space handling AND adjacent JSON/planner-label gaps:

1. **Audit the existing code.** Find the pre-flight check (the error string `"Not enough space"` is the most reliable anchor). Map every place it fires: planner, executor, save(), transcode buffering, transfer manager. Catalogue the current contract per call-site.
2. **Catalogue the situations.** Not just "device full from the start". Also: planner estimate accurate vs not, transcode output bigger than source, manifest+sidecar+ithmb overhead, source files added between plan and execute, partial save() then ENOSPC mid-batch (different shape — planner's pre-flight cannot catch this), Subsonic source download mid-sync, video transcoding which has very different size dynamics.
3. **Evaluate the error surface.** Is the user-facing message actionable? Does `--json` carry structured signal (`code`, `bytesNeeded`, `bytesAvailable`)? Does it match the typed-error convention from `documents/architecture/sync/error-handling.md`? Does the doctor report point at "free up X bytes"?
4. **Evaluate the strategy.** What does podkit do when the pre-flight rejects? Does it leave the device clean (atomic-write contract) or with partial debris? Does it offer hints (e.g. "removing N tracks would free Y bytes; run `podkit doctor --repair orphans`")?
5. **JSON envelope gap (Phase C.2 finding).** `sync --json` + `doctor --json` should surface typed-error-class info per TASK-381's `CategorizedSyncError` hierarchy. Today the `errors[]` array is empty even when a typed error fires. Audit `--json` for ALL typed errors (not just ENOSPC). Surface `error.class`, `error.category`, `error.causes` per `documents/architecture/sync/error-handling.md`.
6. **OGG filetype-label gap (Phase C.2 finding).** OGG sources land on device with extension `.Audio file` because the planner's filetype-label resolution falls through to a generic fallback. Fix the planner's filetype detection for OGG (and audit the rest of the filetype-label fallbacks for similar gaps).
7. **Update docs.** save-transactions.md should describe the free-space contract as a primitive (currently silent on it). doc-041 §5.3 should reflect what's actually implemented vs what's still open. error-handling.md should reflect what `--json` actually carries.
8. **Test coverage.** Unit + integration tests pinning each call-site's contract. The TASK-380 thin-slice cell (`save-failure-matrix.e2e.test.ts`) anchors the planner pre-flight path; widen for the other situations enumerated in step 2.

## What the TASK-380 Phase C.2 fan-out surfaced

- **Planner pre-flight intercepts ENOSPC before save() can fire its typed errors.** Original anchor for this task; predicted MoveError, got `{success: false, error: "Not enough space..."}` from the planner.
- **JSON envelope drops typed error info.** Matrix had to use `-vv` stderr parsing to recover typed-error-class strings. Major architectural gap.
- **OGG filetype-label fallthrough.** OGG sources mis-labelled as `.Audio file` on the device. Real planner bug.

Reference: `test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts` — anchor test for both ENOSPC pre-flight and the JSON envelope gap.

## Reference

- doc-041 §5.3 (the original failure-mode entry)
- `documents/architecture/sync/error-handling.md` (the convention the error surface should match)
- `documents/architecture/sync/save-transactions.md` (where the free-space contract should be a primitive)
- `test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts` (anchor test)
- TASK-380 (matrix that reveals planner-pre-flight gating + the JSON envelope gap + the OGG filetype-label gap)
- TASK-381 (typed error hierarchy that should flow through `--json`)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Audit of existing free-space probe code complete: documented per-call-site (planner / executor / save / transcode / transfer manager) with the typed-error class each throws (or string-error fallback if not typed)
- [ ] #2 Situations catalogue lists at least 7 scenarios: device full at start, planner-estimate-vs-actual mismatch, transcode bigger than source, manifest+sidecar+ithmb overhead, source added between plan and execute, ENOSPC mid-save (pre-flight cannot catch), Subsonic source download mid-sync, video transcoding (different dynamics)
- [ ] #3 Error surface evaluated: --json structure documented; user message actionable; matches typed-error convention from error-handling.md or has a justified divergence
- [ ] #4 Strategy on rejection evaluated: device left clean (atomic contract honoured) or partial debris documented as known-gap with doctor recovery path
- [ ] #5 save-transactions.md gains a `Free-space contract` subsection describing the primitive
- [ ] #6 doc-041 §5.3 updated to reflect implemented vs open
- [ ] #7 Unit + integration tests pin each call-site's contract; TASK-380 matrix references at least the planner-pre-flight envelope; mid-save ENOSPC tested if reachable
- [ ] #8 **JSON envelope gap**: `sync --json` + `doctor --json` audit — errors[] array now carries `{class, category, causes}` per CategorizedSyncError for every typed error path, not just ENOSPC. Matches the error-handling.md contract.
- [ ] #9 **OGG filetype-label gap**: planner's filetype-label resolution correctly identifies OGG sources (and any other format falling through to the `Audio file` generic fallback). Test pins OGG → `.ogg` on the device. Audit other extensions for similar gaps.
<!-- AC:END -->
