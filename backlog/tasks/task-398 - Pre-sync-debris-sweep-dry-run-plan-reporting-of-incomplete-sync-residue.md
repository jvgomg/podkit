---
id: TASK-398
title: Pre-sync debris sweep + dry-run plan-reporting of incomplete-sync residue
status: To Do
assignee: []
created_date: '2026-06-07 12:17'
labels:
  - enhancement
  - sync-engine
  - cli
  - dry-run
  - self-healing
  - doctor
dependencies:
  - TASK-397
references:
  - packages/podkit-core/src/sync/engine/planner.ts
  - packages/podkit-core/src/sync/engine/executor.ts
  - packages/podkit-core/src/sync/engine/types.ts
  - packages/podkit-cli/src/commands/sync.ts
  - packages/podkit-cli/src/commands/sync-presenter.ts
  - packages/podkit-core/src/diagnostics/checks/
  - packages/podkit-core/src/sync/music/pipeline.ts
  - documents/architecture/sync/save-transactions.md
priority: medium
ordinal: 109400
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

Podkit's atomic-write contract (helper landed in TASK-391; retrofit in TASK-376) ensures that mid-write failures leave behind `.podkit-tmp` debris but never torn target files. The doc-041 §6 self-heal-via-rescan model says the next sync re-detects gaps and re-fires the diff. But podkit today does NOT clean the debris on its own — it sits there until the user runs `podkit doctor`, which is opportunistic.

This task makes debris cleanup **part of the sync plan** rather than relying on the user to discover and run doctor. Pre-sync sweep: at sync start (after `connect()`, before/during plan), scan for debris using TASK-397's debris-only scanner, surface the cleanup as a planned step in the dry-run output, and execute it at the start of the real run.

The user-facing UX:

```
$ podkit sync --dry-run

Plan:
  1. Clean 12 .podkit-tmp files (240 MB) from a previous interrupted sync
  2. Add 48 tracks (1.2 GB)
  3. Update metadata for 3 tracks
  ...
```

Debris cleanup is a **first-class plan step** — visible, explained, and the user understands WHY it's there ("interrupted prior sync"). Not silent housekeeping.

## Why this is part of the sync, not doctor-only

doctor remains the backstop for users who run it manually or on devices not currently being synced. But the common case is sync → SIGKILL → next sync. Having the user discover + manually run doctor between failed syncs is bad UX. Making it part of the plan closes the gap by default.

## Why NOT auto-resume from `.podkit-tmp`

The `.podkit-tmp` is by definition incomplete:
- We don't know if fsync completed for any of its bytes.
- We don't know if the rename was atomic-at-the-time-of-kill (might be partial).
- The planner's choice for that file may differ in the new sync (codec, quality, target path could have changed).
- The atomic-write contract is "all or nothing"; "almost-all" is not in the design.

Renaming a `.podkit-tmp` to its intended target would require a write-ahead log proving completeness, which doc-041 §6 deliberately rejects. **Sweep + re-do is the design.**

## Scope

1. **Hook the planner** (or the sync orchestrator) at sync start to invoke TASK-397's debris-only scanner. Gather paths + total bytes.
2. **Plan representation**: extend `SyncPlan` to include a `debrisCleanup: { paths: string[], totalBytes: number }` field (or similar typed shape).
3. **Dry-run output**: render debris cleanup as a planned step in both text and `--json` modes. Make it visually distinct from add/update/remove ops — it's a preliminary, not a track op. Suggested:
   - Text: `Plan:` section gets a leading line `Cleaning 12 .podkit-tmp files (240 MB) from a previous interrupted sync` before the track ops.
   - JSON: `plan.preliminaries[]` or similar — clearly bounded; not in `operations[]`.
4. **Execution**: at the start of the real run (before the transfer batches start), execute the cleanup. Log a single line: `Cleaned 12 .podkit-tmp files (240 MB) from a previous interrupted sync`. Errors during cleanup are warnings, not fatals — debris cleanup failing should NOT block the sync (the next sync will retry).
5. **Source for the cleanup**: reuse TASK-397's debris scanner — DO NOT duplicate. If TASK-397 names it `findDebrisFiles(mountPoint, contentPaths)`, call that directly.
6. **Free-space accounting**: the freed bytes from debris cleanup should be available to the planner's free-space pre-check (TASK-378's territory). Order: scan debris → planner subtracts debris bytes from required space → if still over, fail; if under, proceed.
7. **Transcode-debris coverage**: `pipeline.ts:1590,1696` also writes `.podkit-tmp` during transcoding. Verify the sweep covers transcode-output dirs too, not just final device paths.
8. **iPod parity**: the sweep should cover iPod-side debris (depends on TASK-397's iPod debris check).
9. **Tests**: dry-run output shape (text + JSON); real-run execution; cleanup failure becomes a warning (not fatal); SIGKILL fixture (sync, kill, re-sync, assert cleanup line); transcode-debris cleanup.
10. **Docs**:
   - `documents/architecture/sync/save-transactions.md` §6 — the self-heal section grows a "pre-sync sweep" subsection explaining that debris cleanup is part of the rescan recovery model.
   - `documents/architecture/sync/error-handling.md` §3 if the new `Warning` type (cleanup-failure) is added.

## Why deferred to a follow-up

Depends on TASK-397 (the debris-only scanner foundation). Until that lands, calling into the existing mixed orphan check would either trigger orphan-confirmation flows OR duplicate the walk.

## Adjacent (informational, no hard dependency)

- **TASK-378 §4** (free-space strategy): the free-space audit might re-frame this as "pre-sync sweep makes free-space estimates more accurate". Worth a cross-ref but not a blocker.
- **TASK-376** (Done) — created the additional debris sources this task cleans up.
- **TASK-391** (Done) — the helper writing the debris.

## Acceptance

- `SyncPlan` carries a typed `debrisCleanup` shape.
- Dry-run text + JSON output renders cleanup as a planned preliminary (not in operations[]).
- Real-run executes cleanup at sync start; logs the cleaned count; doesn't fail the sync if cleanup itself fails.
- Free-space pre-check accounts for the bytes that will be freed.
- iPod + mass-storage + transcode-output dirs all swept.
- Cross-cuts: doctor remains the backstop for users who never sync (or for the edge case where the sweep itself failed).
- Architecture doc updated.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `SyncPlan` carries a typed `debrisCleanup: { paths: string[], totalBytes: number }` (or equivalent) populated by the pre-sync scan
- [ ] #2 Dry-run text output renders cleanup as a planned preliminary before track ops (clearly labeled as 'from a previous interrupted sync')
- [ ] #3 Dry-run JSON output exposes the cleanup as `plan.preliminaries[]` (or similar) — NOT inside `operations[]`
- [ ] #4 Real-run executes the cleanup at sync start; logs a single line with cleaned count + bytes; cleanup failure becomes a Warning (non-fatal)
- [ ] #5 Free-space pre-check (planner) accounts for bytes that will be freed by debris cleanup
- [ ] #6 Coverage: mass-storage device dirs, iPod `iPod_Control/Music/F**`, and transcode-output dirs (`pipeline.ts:1590,1696`) all swept
- [ ] #7 Reuses TASK-397's debris scanner; no duplicate FS walk
- [ ] #8 Tests pin: dry-run output shape (both modes), real-run cleanup, cleanup-failure-is-warning, SIGKILL fixture round-trip, transcode-debris cleanup
- [ ] #9 save-transactions.md §6 updated: pre-sync sweep is part of the self-heal model, doctor remains the backstop
<!-- AC:END -->
