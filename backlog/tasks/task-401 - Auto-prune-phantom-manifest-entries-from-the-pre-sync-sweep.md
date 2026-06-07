---
id: TASK-401
title: Auto-prune phantom manifest entries from the pre-sync sweep
status: To Do
assignee: []
created_date: '2026-06-07 16:01'
labels:
  - enhancement
  - sync-engine
  - follow-up
  - mass-storage
dependencies:
  - TASK-398
references:
  - packages/podkit-core/src/sync/engine/pre-sync-sweep.ts
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - packages/podkit-core/src/diagnostics/checks/orphans-mass-storage.ts
priority: low
ordinal: 117000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

TASK-398 added a `phantomPrune` bucket to `PlanPreliminaries` and surfaces phantom manifest entries (rows whose backing file vanished) during the pre-sync sweep. But the pre-flight executes only the `debrisCleanup` bucket — for `phantomPrune` it emits an advisory `Warning('debris-cleanup-failure')` recommending the user run `podkit doctor --repair orphan-files` to prune them manually.

The reason: the manifest rewrite crosses the `DeviceAdapter` contract boundary. `orphans-mass-storage.ts` does the atomic-write rewrite directly because it's already adapter-aware (`atomicWriteFile` on `state.json`); replicating that logic in a sweep helper would duplicate the manifest-format assumptions, while extending `DeviceAdapter` was out of scope for TASK-398.

## Scope

Two cleanest implementations:

**Option A: Adapter method.** Add `MassStorageAdapter.prunePhantomManifest(paths: string[]): Promise<{pruned, errors}>` (no-op for `IpodAdapter`). The pre-flight calls it via an injected callback on `SyncExecuteOptions`. Cleanest if `DeviceAdapter` already exposes a similar surface area; needs an interface review.

**Option B: Closure on `phantomPrune`.** Make `PlanPreliminaries.phantomPrune` a `{paths, prune: () => Promise<...>}` shape. `runPreSyncSweep` constructs the closure with manifest-path knowledge; the executor invokes it. Avoids growing the adapter contract; downside: `PlanPreliminaries` stops being pure data, which complicates JSON serialization for tests (the dry-run JSON already serializes `paths` only, so the closure presence isn't user-visible).

Either choice is fine. Pick when the work lands.

## Acceptance

- Pre-sync sweep actually prunes phantom manifest entries on real-run (not just emits the advisory).
- The current advisory warning is removed or only fires when the auto-prune itself failed.
- Tests pin: phantom rows present pre-sweep → rows absent post-sweep, manifest atomically rewritten, original manifest preserved on prune failure.
- Doctor's `--repair orphan-files` still prunes phantoms (backstop unchanged).
- Architecture doc (`sync/planning.md` §6) updated to mark this open item closed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Pre-flight auto-prunes phantom manifest entries on real-run (no more advisory warning when prune succeeds)
- [ ] #2 Architecture decision recorded for adapter-method vs closure-on-data shape
- [ ] #3 Manifest atomically rewritten; original preserved on prune failure
- [ ] #4 Test pins phantom rows present → sweep → rows absent + manifest valid
- [ ] #5 Doctor `--repair orphan-files` still prunes phantoms (regression test)
- [ ] #6 sync/planning.md §6 updated to mark item closed
<!-- AC:END -->
