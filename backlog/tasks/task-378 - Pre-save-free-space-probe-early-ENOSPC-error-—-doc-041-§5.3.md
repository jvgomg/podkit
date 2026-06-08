---
id: TASK-378
title: >-
  Free-space handling review: probe, strategy, error surface, tests — doc-041
  §5.3
status: Done
assignee: []
created_date: '2026-06-03 09:08'
updated_date: '2026-06-08 08:27'
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
- [x] #1 Audit of existing free-space probe code complete: documented per-call-site (planner / executor / save / transcode / transfer manager) with the typed-error class each throws (or string-error fallback if not typed)
- [x] #2 Situations catalogue lists at least 7 scenarios: device full at start, planner-estimate-vs-actual mismatch, transcode bigger than source, manifest+sidecar+ithmb overhead, source added between plan and execute, ENOSPC mid-save (pre-flight cannot catch), Subsonic source download mid-sync, video transcoding (different dynamics)
- [x] #3 Error surface evaluated: --json structure documented; user message actionable; matches typed-error convention from error-handling.md or has a justified divergence
- [x] #4 Strategy on rejection evaluated: device left clean (atomic contract honoured) or partial debris documented as known-gap with doctor recovery path
- [x] #5 save-transactions.md gains a `Free-space contract` subsection describing the primitive
- [x] #6 doc-041 §5.3 updated to reflect implemented vs open
- [x] #7 Unit + integration tests pin each call-site's contract; TASK-380 matrix references at least the planner-pre-flight envelope; mid-save ENOSPC tested if reachable
- [x] #8 **JSON envelope gap**: `sync --json` + `doctor --json` audit — errors[] array now carries `{class, category, causes}` per CategorizedSyncError for every typed error path, not just ENOSPC. Matches the error-handling.md contract.
- [x] #9 **OGG filetype-label gap**: planner's filetype-label resolution correctly identifies OGG sources (and any other format falling through to the `Audio file` generic fallback). Test pins OGG → `.ogg` on the device. Audit other extensions for similar gaps.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Pre-existing context from TASK-398 (landed 2026-06-07)

TASK-398 added a partial free-space accounting layer that this audit should fold into:

- `SyncPlan.preliminaries.debrisCleanup.totalBytes` carries the *estimated* bytes the pre-sync sweep will free (scan-time totals from `walkMassStorageContent` + `walkIpodContentForDebris` + `walkAbandonedTranscodeDirs`).
- `genericSyncCollection` (`sync-presenter.ts`) now treats those bytes as additional headroom on the AVAILABLE side of `willFit`:
  ```
  effectiveFreeSpace = storage.free + plan.preliminaries.debrisCleanup.totalBytes
  ```
  rather than subtracting from `plan.estimatedSize`. Per opus's Phase 1 critique this is the honest model: subtracting from required space would suppress real warnings when the sweep partially fails.
- **Known degradation** (documented in `documents/architecture/sync/planning.md` §6): when the pre-flight's `rm` calls fail (permissions, ENOENT race, transient I/O), the actual freed bytes can fall short of `totalBytes`. The transfer phase surfaces these as per-track write errors rather than a coherent ENOSPC summary. This audit's call-site catalogue should explicitly cover the post-sweep-failure ENOSPC pathway and recommend either a probe-rewrite that reads space POST-sweep, a more conservative envelope, or both.
- **Top-level sweep failure surfaces as a `Warning('debris-cleanup-failure')`** (added 2026-06-07 after sonnet review) — the orchestrator catches the sweep error and pushes the warning into `allWarnings` so JSON consumers see it. The audit's `--json` envelope gap (AC #8) should verify this warning surfaces correctly through the typed-error path.

### Where TASK-398 left the math

- Plan-time: estimate is generous (assumes sweep will free `totalBytes`).
- Execute-time: the executor's pre-flight returns `PreFlightResult.freedBytes` (actual freed bytes after per-path `rm`). Today this value is NOT fed back into any free-space recalculation — it's only used for log-line formatting.

The probe rewrite should consider whether to:
1. Recompute `willFit` after the pre-flight using actual freed bytes (re-fail the sync if space is now insufficient), OR
2. Trust the plan-time generosity + rely on per-track ENOSPC handling at the transfer phase (current behaviour).

Option 1 is more correct but introduces a new exit point; option 2 is simpler but leaks accounting drift into the transfer-phase error surface. Audit + decide as part of this task.

### Documentation hand-off

- `sync/planning.md` §3 covers the current `willFit` math; §6 documents the degradation. Both should evolve as this task lands.
- `sync/save-transactions.md` already has a 'Pre-sync sweep' subsection (added by TASK-398) that names sync + doctor as co-owners of the rescan-recovery responsibility. The 'Free-space contract' subsection this task plans to add should sit alongside it.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## AC #9 (OGG filetype-label) — closed without code change (2026-06-08)

The `.Audio file` artefact on OGG sources was the stale-binary symptom from TASK-380 Phase C.2, not a live planner bug. Closed by:

- **TASK-358.01** added `OptimizedCopyFormat='vorbis'` + `getOptimizedCopyFormat(fileType='ogg')` → FFmpeg `-f ogg` (was falling through to `-f ipod` which produced the original error).
- **TASK-394** (closed obsolete) confirmed the bug doesn't exist on main; the May-26 VM binary used by Phase C.2 predated TASK-358.01.
- **TASK-380 Phase E** (commit `fa6b2502`) added Turborepo-driven VM build-staleness detection (`@podkit/device-testing#vm:install` + `#vm:doctor`) so this class of false-RED can't recur silently.

### Current invariants pinned by existing tests

- `packages/podkit-core/src/sync/music/pipeline.ts:344-370` — `getFileTypeLabel` covers every member of `AudioFileType` (`flac|mp3|m4a|aac|ogg|opus|wav|aiff|alac` + the `.aif` synonym).
- `packages/podkit-core/src/device/mass-storage-adapter.ts:1874-1896` — `resolveFileExtension('Ogg Vorbis audio file')` → `.ogg` via `label.includes('vorbis')`.
- `packages/podkit-core/src/sync/music/pipeline.test.ts:257-274` — round-trips every `AudioFileType` extension through `getFileTypeLabel → resolveFileExtension`. Comment explicitly locks the `.ogg → 'Audio file' → .Audio file` regression class.
- `packages/podkit-core/src/device/mass-storage-utils.ts:114` `KNOWN_DEBRIS_EXTENSIONS` + `debris-files-mass-storage.test.ts:87,172` — any leftover `.Audio file` debris on disk from prior versions is now swept by the pre-sync sweep (TASK-398) or `--repair debris-files` (TASK-397).

### Residual hazard NOT taken in scope

`getFileTypeLabel`'s `default: return 'Audio file'` branch is unreachable from valid `AudioFileType` inputs but would silently fire if a new format is added to the union without updating the switch. Considered tightening to an exhaustive `assertNever`; opus second-opinion (2026-06-08) flagged it as churn — the existing round-trip test already breaks on the same scenario with a clearer failure than a buried `never` violation. Not worth the call-site ripple; leaving as-is.

No files modified.

## ACs #1-6 — audit + docs slice landed (2026-06-08)

Four doc artefacts; zero production code changes in this slice. ADR-018 implementation, AC #7, and AC #8 tracked as follow-up code work.

### What landed

- **NEW** `adr/adr-018-free-space-pre-flight-strategy.md` — decides the TASK-398-deferred probe-rewrite question. Option 1 (recompute willFit post-sweep via fresh `statfsSync`) + new `InsufficientSpaceAfterCleanup` typed error subclass under `CategorizedSyncError`. Sonnet review caught a guard-vs-decision-driver inconsistency; recompute is unconditional when `preliminaries` is present (not gated on `freedBytes > 0`).
- **EDIT** `documents/architecture/sync/planning.md` — new "Free-space contract — plan-time" subsection under §2 Primitives covering estimator surface, envelope math, planner-side `space-constraint` warning, and three drift classes (sweep partial-fail / estimate drift / plan-execute race). §7 Open-work entry rewritten to point at ADR-018 + estimate-drift as separate follow-up.
- **EDIT** `documents/architecture/sync/save-transactions.md` — new "Free-space contract — execute-time" subsection under §2 Primitives covering three execute-time ENOSPC pathways (post-sweep recompute, per-track atomic-write, sweep-failure-as-warning), the atomic-write contract under ENOSPC, and a what-the-user-sees table. §3 Pre-sync sweep's "Free-space envelope" bullet rewritten to cross-link both new subsections + ADR-018.
- **EDIT** `backlog/docs/doc-041` §5.3 — replaced gap entry with settled three-tier model + journal of what TASK-378 closes (ACs #1-6) vs leaves open (ADR-018 implementation, estimate-drift mitigation, AC #8 JSON envelope, AC #7 mid-save test).

### Findings folded into the docs

- `estimatedSize` is gross, not net (upgrade ops add full bytes; remove ops contribute zero). Conservative-by-design.
- `estimateCopySize` uses *typical* bitrates per format (256kbps mp3/aac, 900 flac, 1411 wav). A 320kbps mp3 estimated at 256kbps underestimates by 25%. Tracked as the estimate-drift follow-up.
- Plan-time envelope adds `debrisCleanup.totalBytes` to AVAILABLE side, not subtracted from REQUIRED — TASK-398 opus-review rationale preserved.
- `PreFlightResult.freedBytes` is currently log-only; ADR-018 wires it into a new recompute path.
- The planner's own `space-constraint` warning at `planner.ts:153-162` only fires when callers pass `maxSize`; the CLI doesn't, so it serves library consumers today.
- ENOSPC at iPod database write surfaces as `DatabaseWriteError` (single hard fail; rescan recovers via libgpod's atomic tmp+rename).

### Sonnet review (folded in)

Three fixes applied:
1. Cross-doc anchors used single-dash where em-dash headings produce double-dash on GitHub/Starlight (`#free-space-contract--plan-time` / `#free-space-contract--execute-time`). Pattern matches existing `error-handling.md#2-hard-failures--categorizedsyncerror`.
2. ADR-018 implementation outline had a guard `if (freedBytes > 0 || failedPaths.length > 0)` that contradicted the "concurrent processes can shift free-space" decision driver. Recompute is now unconditional when `preliminaries` is present.
3. `sync/video/planner.ts` line range corrected from `80-138` (overshot into the time estimator) to `80-113` (size only).

## AC #8 + ADR-018 implementation — landed (2026-06-08)

### ADR-018: post-sweep statfs recompute

- **NEW** `InsufficientSpaceAfterCleanup` typed error in `packages/podkit-core/src/sync/engine/errors.ts`. Subclass of `CategorizedSyncError`, category `'space'`, detail payload `{bytesNeeded, bytesAvailable, bytesFreedBySweep, failedSweepPaths}`. `causes` populated from `failedSweepPaths`.
- **NEW** `'space'` member added to `ErrorCategory` union (`types.ts`). Threaded through `RetryConfig` / `DEFAULT_RETRY_CONFIG` / `VIDEO_RETRY_CONFIG` / `getRetriesForCategory` exhaustive switch with `space: 0` (no retry).
- **NEW** `safeStatfsFree(mountPoint)` + `assertSpaceAfterSweep({mountPoint, bytesNeeded, preflight})` exported from `pre-sync-sweep.ts`. statfs failure → silent fallback to plan-time envelope (current behaviour preserved).
- Wired into both pre-flight call sites: `executor.ts` (generic executor) + `MusicPipeline.execute()`. Unconditional recompute when `plan.preliminaries` is present (per ADR-018 decision driver).
- Exported from `@podkit/core` barrel + mirrored in `packages/demo/src/mock-core.ts`.

### AC #8: JSON envelope `errors[]`

- Extended `ErrorInfo` (`sync.ts`) with optional `class?: string` + `causes?: readonly string[]`.
- Extended `CollectedError` (`output/formatters.ts`) with `errorClass?: string` + `causes?: readonly string[]`. Music + video presenters now capture both from `CategorizedSyncError` instances when pushing to `collectedErrors`.
- Plan-time ENOSPC JSON path (`sync-presenter.ts:566-604`) now populates `errors: [{class:'NotEnoughSpacePlanTime', category:'space', ...}]` alongside the existing `error` string. Existing string kept for backwards-compat.
- Post-sweep ENOSPC: new try/catch around `executeSync` in `sync-presenter.ts` catches `InsufficientSpaceAfterCleanup` and renders the same shape with the typed-error detail payload via `buildPostSweepSpaceErrorInfo`.
- Execute-phase typed errors: per-collection `collectedErrors` now flow through `genericSyncCollection` return → orchestrator `allErrors` aggregator → final JSON output's `errors[]` field.

### Tests

- 7 new tests in `pre-sync-sweep.test.ts`: `safeStatfsFree` (positive byte count, nonexistent path → undefined) + `assertSpaceAfterSweep` (fits / exceeds throws with full detail / statfs failure silent fallback).
- 672/672 podkit-core sync tests green. 1469/1469 podkit-cli tests green. Workspace typecheck 34/34 clean.

### Sonnet review (folded in)

Verdict: ship. No blockers. One informational observation:
- `InsufficientSpaceAfterCleanup` catch in sync-presenter returns early without populating `collectedErrors`, so per-collection JSON envelope (emitted immediately at the catch) carries the detail but the multi-collection aggregate envelope does not. Consistent with the existing plan-time ENOSPC asymmetry; documented for future readers if it ever needs to change.

### Open

- AC #7 (mid-save ENOSPC reachability test) — separate slice. Requires a new `SystemState` forcing estimate drift (device-full-at-start is now caught by both the plan-time and post-sweep gates). Tracked as a follow-up.
- Changeset — not written; the new `errors[]` field is additive and `InsufficientSpaceAfterCleanup` is a new export. No CLI break; could ship as a patch or minor depending on policy.

## AC #7 closed (2026-06-08) + TASK-378 closure

### AC #7 coverage breakdown

The AC asks for three things:

1. **Unit + integration tests pin each call-site's contract.** ✓
   - `packages/podkit-core/src/sync/engine/pre-sync-sweep.test.ts` gained 7 tests covering `safeStatfsFree` (positive byte count, nonexistent path → undefined) + `assertSpaceAfterSweep` (fits-no-throw / exceeds-throws-with-detail / statfs-failure-silent-fallback). 672/672 sync tests pass.
2. **TASK-380 matrix references at least the planner-pre-flight envelope.** ✓ — already done in TASK-380 Phase 1. The existing `embedded × flac × prefer-copy × fast × enospc` cell pins the plan-time envelope. Comment + reason text in `matrix/save-failure-rules.ts` updated this session to reflect: (a) ADR-018 post-sweep gate is unreachable from device-mount-near-full because the plan-time gate fires first; (b) AC #8's synthetic `NotEnoughSpacePlanTime` errors[] entry is now part of the envelope.
3. **Mid-save ENOSPC tested if reachable.** Filed as **TASK-412** — covers the two remaining reachable mid-save paths (ADR-018 post-sweep recompute + estimate-drift mid-save). Requires two new `SystemState` variants beyond the existing `device-mount-near-full`. ~4-6 hours of VM-harness work that didn't fit the audit-slice scope.

### TASK-378 closure summary

**Acceptance criteria status:** 9/9 ticked.

**Slices landed (4 commits):**
- `bca54814 docs(sync): audit free-space contract + file ADR-018` — ADR-018 + planning.md + save-transactions.md + doc-041 §5.3 updates.
- `70a2d479 feat(sync): post-sweep ENOSPC recompute (ADR-018)` — InsufficientSpaceAfterCleanup typed error, safeStatfsFree + assertSpaceAfterSweep helpers, executor + pipeline wiring, mock-core mirror, 7 unit tests.
- `bccaa8b0 feat(cli): typed errors[] in sync --json envelope (TASK-378 AC #8)` — Synthetic NotEnoughSpacePlanTime entry on plan-time ENOSPC path, post-sweep ENOSPC catch + render, execute-phase collectedErrors → orchestrator allErrors → final --json errors[].
- `21c2a02d fix(test): use unified --repair orphan-files in mass-storage e2e` — unrelated doctor-drift fix surfaced during the work.

**Quality gates:**
- Workspace typecheck 34/34 clean.
- podkit-core sync tests 672/672 green.
- podkit-cli tests 1469/1469 green.
- e2e tests 916 pass / 129 skip / 0 fail.
- Two sonnet reviews (audit-docs + implementation); all flagged fixes folded in.

**Follow-up tasks filed:**
- **TASK-412** — Mid-save ENOSPC matrix cells (ADR-018 post-sweep + estimate-drift). Carries the AC #7 "if reachable" carve-out.

**Changeset:** not written. The new `errors[]` field is additive and `InsufficientSpaceAfterCleanup` is a new export. No CLI break. Ship policy is the user's call — patch or minor both defensible.
<!-- SECTION:NOTES:END -->
