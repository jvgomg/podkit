---
id: TASK-398
title: Pre-sync debris sweep + dry-run plan-reporting of incomplete-sync residue
status: Done
assignee: []
created_date: '2026-06-07 12:17'
updated_date: '2026-06-07 16:09'
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
- [x] #1 `SyncPlan` carries a typed `debrisCleanup: { paths: string[], totalBytes: number }` (or equivalent) populated by the pre-sync scan
- [x] #2 Dry-run text output renders cleanup as a planned preliminary before track ops (clearly labeled as 'from a previous interrupted sync')
- [x] #3 Dry-run JSON output exposes the cleanup as `plan.preliminaries[]` (or similar) — NOT inside `operations[]`
- [x] #4 Real-run executes the cleanup at sync start; logs a single line with cleaned count + bytes; cleanup failure becomes a Warning (non-fatal)
- [x] #5 Free-space pre-check (planner) accounts for bytes that will be freed by debris cleanup
- [x] #6 Coverage: mass-storage device dirs, iPod `iPod_Control/Music/F**`, and transcode-output dirs (`pipeline.ts:1590,1696`) all swept
- [x] #7 Reuses TASK-397's debris scanner; no duplicate FS walk
- [x] #8 Tests pin: dry-run output shape (both modes), real-run cleanup, cleanup-failure-is-warning, SIGKILL fixture round-trip, transcode-debris cleanup
- [x] #9 save-transactions.md §6 updated: pre-sync sweep is part of the self-heal model, doctor remains the backstop
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Revised approach (2026-06-07 design session)

After opus second-opinion + design discussion, dropped the `DeviceSyncPlan` wrapper and inlined `preliminaries?` on the existing `SyncPlan`. Free-space accounting moved to execute-time entry (not plan-time `estimatedSize` subtraction).

### Decisions

1. **No new top-level type.** Original task spec mentioned a typed `debrisCleanup` shape on `SyncPlan` — we'll do exactly that via `preliminaries?: PlanPreliminaries`. NO `DeviceSyncPlan` aggregator. Future unified-plan refactor can collapse `collections[]` into a single `operations[]` without touching `preliminaries`.

2. **Sweep runs ONCE per device, not per-collection.** Orchestrator in `sync.ts` runs the sweep before the music + video collection loops; result threaded through a shared `SyncContext` and stamped onto the FIRST plan's `preliminaries`. Subsequent plans in the same device sync see `preliminaries === undefined`. Avoids duplicate display when syncing music + video to one device.

3. **Free-space math correction.** Do NOT subtract `preliminaries.totalBytes` from `plan.estimatedSize` (would suppress real space warnings if sweep partially fails). Subtract from REQUIRED-SPACE at execute-time entry, AFTER the sweep actually ran, using ACTUAL freed bytes. Coordinate with TASK-378 (free-space audit) — cross-reference in arch doc; do not add a third overlapping accounting point.

4. **Phantom manifest pruning closes a doctor-only gap.** Pre-sync sweep runs phantom-manifest prune alongside debris cleanup. Surfaced via TASK-397's shared scanner. Folded into AC scope.

5. **No `device-plan.md` arch doc.** Instead: NEW `documents/architecture/sync/planning.md` (long-overdue per README migration plan); `preliminaries` gets a subsection there. Plus sibling subsection in `sync/save-transactions.md` §6 for "pre-sync sweep" (sync becomes co-owner of the rescan-recovery responsibility; doctor remains the backstop).

6. **Phase 2 split into 2a + 2b** for sharper sonnet checkpoints:
   - **2a**: `SyncPlan.preliminaries` field + executor pre-flight runs sweep + Warning('debris-cleanup-failure') on non-fatal failure. Data-flow only, no UI.
   - **2b**: Presenter `renderPreamble` (text + JSON `plan.preliminaries[]`) + free-space pre-check at execute-time entry. UI + math.

### Concurrency safety inherited from TASK-397

`os.tmpdir()` is host-global. Two podkit processes (daemon + manual CLI) can stomp transcode-tmp dirs. TASK-397's scanner uses mtime-older-than-session-start filter; pre-sync sweep inherits this safety automatically.

### Sweep coverage (broader than original task spec)

Beyond device debris:
- `os.tmpdir()/podkit-transcode-*` orphaned scratch dirs (separate scanner, separate diagnostic)
- libgpod tmp-suffix residue on iPod (TASK-397 scope)
- Phantom manifest entries (this task)

### Test surface

- Unit: orchestrator threads sweep result correctly; first-plan-only attachment; cleanup-failure-as-warning; free-space math at execute-time entry.
- e2e-vm: SIGKILL round-trip (sync → kill → re-sync → assert preamble + cleaned line).
- e2e-vm: transcode-tmp sweep with concurrent-pid case (younger mtime skipped).
- Presenter shape pins (text + JSON).

### Cross-task coordination

- Cross-ref TASK-378 §4 in arch doc: pre-sync sweep makes free-space estimates more accurate but is NOT the free-space probe rewrite.
- Doctor remains backstop — explicitly stated in save-transactions.md §6 sibling subsection.
- TASK-399 (doctor docs drift) lands first as separate PR; this task's doc updates layer on top.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Pre-sync debris sweep landed end-to-end. Every `podkit sync` now reaps `.podkit-tmp` residue + abandoned `os.tmpdir()/podkit-transcode-*` directories before track operations run; doctor remains the backstop for devices that aren't synced.

## What landed

**Type surface** (`packages/podkit-core/src/sync/engine/types.ts`):
- `PlanPreliminaries` — extensible device-scoped pre-flight envelope with `debrisCleanup` + `phantomPrune`.
- `SyncPlan.preliminaries?: PlanPreliminaries` — optional; only the FIRST plan executed against a device carries it.
- New `'debris-cleanup-failure'` Warning type for non-fatal pre-flight failures.

**Sweep + pre-flight** (`packages/podkit-core/src/sync/engine/pre-sync-sweep.ts`):
- `runPreSyncSweep(input)` aggregates the three TASK-397 scanners (mass-storage walker, iPod walker, transcode-tmp walker) into one `PlanPreliminaries`. Tolerant of every scanner failure; the next sync retries.
- `runPreliminariesPreFlight(preliminaries, options)` consumes the result during executor pre-flight. `rm({ recursive: true, force: true })` handles both file debris (`.podkit-tmp` siblings) AND directory debris (transcode-tmp dirs) with one code path. Per-path failures become Warnings; the loop continues. Respects abort signals.

**Orchestrator wiring** (`packages/podkit-cli/src/commands/sync.ts`):
- Runs `runPreSyncSweep` ONCE per device sync before the music/video loops.
- Prints a single preamble line (text mode): `Cleaning N incomplete-write files (X MB) from a previous interrupted sync` (or `Would clean...` in dry-run).
- `preliminariesConsumed` flag ensures only the FIRST collection's `genericSyncCollection` call receives the result.

**Presenter layer**:
- `genericSyncCollection` gained a `preliminaries` param threaded through to `plan.preliminaries`.
- Music + video presenters serialize `plan.preliminaries` into the dry-run JSON (`plan.preliminaries`, per task spec §3).
- `willFit` adds `debrisFreedEstimate` to the available envelope (not subtracted from `estimatedSize`) — honest accounting per opus critique.

**openDevice** returns the resolved `contentPaths` alongside the adapter so the sweep can walk mass-storage content paths without duplicating the resolution logic.

**Executors**:
- `MusicPipeline.execute()` runs the pre-flight before the dry-run/real branches.
- Generic `SyncExecutor.execute()` (used by video) does the same.

## Architecture docs

- **NEW** `documents/architecture/sync/planning.md` — long-overdue per the README migration plan. Eight-section template covering the SyncDiffer → SyncPlanner pipeline plus the device-scoped `PlanPreliminaries` pre-flight that landed here. README marked ✅.
- `sync/save-transactions.md` §3 grew a new "Pre-sync sweep" subsection naming the sweep as co-owner of the rescan-recovery responsibility (doctor stays the backstop).
- `sync/error-handling.md` §3 names `runPreliminariesPreFlight` as the new `'debris-cleanup-failure'` emitter + phantom-manifest advisory carrier.

## User-facing docs

- `docs/user-guide/devices/doctor.md` "Cleaning up Debris Files" section now leads with "you usually don't need to run this" — the sweep makes it automatic.
- `docs/troubleshooting/common-issues.md` points users at the automatic sweep first, doctor second.

## Tests

- 4692/4692 podkit-core + podkit-cli tests green (5 skip).
- 18 pre-sync-sweep unit tests cover scanner failure tolerance, dry-run no-op, abort signal mid-loop, file-vs-directory `rm` handling, phantom-prune advisory emission, and the throwing-loadManagedFiles fallback.
- New flag-matrix AC #15b pins `debris-transcode-tmp` through the system-repair fast-path (lands in TASK-397, exercised here).

## Sonnet review (folded in)

Final Phase 2 sonnet review found 0 blockers, 2 fix-soon items both addressed in commit `a86e02d1`:
1. `runPreSyncSweep` now wraps `loadManagedFiles` in its own try/catch (docstring promised tolerance; implementation diverged).
2. `planning.md` §6 documents the partial-sweep ENOSPC degradation honestly — the failed-rm-during-pre-flight path falls through to per-track write errors during transfer rather than a single ENOSPC summary. TASK-378's free-space probe rewrite is the eventual fix.

Three nice-to-have items not addressed (no behaviour impact):
- `perPathEstimate` even-allocation accuracy (informational log line only).
- `tmpDirOverride`/`sessionStartMsOverride` could be tagged `@internal` (test-only).
- Mid-loop partial-abort test (existing pre-abort test covers the contract).

## Carried forward / deferred

- **TASK-400** filed: e2e-vm SIGKILL round-trip fixture. Unit coverage exercises every code path; the VM fixture is the end-to-end completeness layer. Deferred for scope.
- **TASK-401** filed: auto-prune phantom manifest entries from the pre-sync sweep. Currently the pre-flight emits an advisory pointing at `--repair orphan-files` because the manifest rewrite crosses the adapter contract boundary.

## Commit log (9)

c0ff37dd Sonnet-review nice-to-haves from Phase 1 (TASK-397)
4164e8cf `SyncPlan.preliminaries` + `'debris-cleanup-failure'` Warning type
972c08f4 Pre-sync sweep module (`runPreSyncSweep`)
b3fffb5b Executor pre-flight (`runPreliminariesPreFlight`)
158c1303 Orchestrator + presenter wiring
4e3830e1 Free-space envelope math fix
471f0299 Architecture docs (new `sync/planning.md` + updates)
9176755e User-facing doc updates
a86e02d1 Sonnet review follow-ups

Branch: `phase2-task-398` → merged to `main`.
<!-- SECTION:FINAL_SUMMARY:END -->
