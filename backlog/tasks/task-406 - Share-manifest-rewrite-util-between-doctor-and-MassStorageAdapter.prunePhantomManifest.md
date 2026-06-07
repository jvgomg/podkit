---
id: TASK-406
title: >-
  Share manifest-rewrite util between doctor and
  MassStorageAdapter.prunePhantomManifest
status: Done
assignee: []
created_date: '2026-06-07 17:57'
updated_date: '2026-06-07 22:21'
labels:
  - refactor
  - tech-debt
  - sync-engine
  - mass-storage
  - follow-up
dependencies:
  - TASK-401
references:
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - packages/podkit-core/src/diagnostics/checks/orphans-mass-storage.ts
priority: low
ordinal: 121000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

TASK-401 added `MassStorageAdapter.prunePhantomManifest(paths)` for the pre-sync sweep to auto-prune phantom manifest entries (rows whose backing files vanished). The doctor's `--repair orphan-files` path in `packages/podkit-core/src/diagnostics/checks/orphans-mass-storage.ts` already had its own inline manifest-rewrite logic — both now produce the same on-disk result (atomic rewrite of `.podkit/state.json` minus the phantom rows) via slightly different code paths.

The doctor can't simply call `MassStorageAdapter.prunePhantomManifest` because it doesn't have an open adapter at the time the repair runs — it operates against a mount point with diagnostic context, not a long-lived adapter handle.

## Scope

**Option B (preferred): extract the on-disk rewrite to a shared util.**

New file: `packages/podkit-core/src/device/mass-storage-manifest.ts` exporting:

```ts
export async function pruneManifestRows(
  stateDir: string,
  pathsToRemove: string[],
): Promise<{ pruned: number; errors: Array<{ path: string; error: Error }> }>;
```

The util does the atomic rewrite (`atomicWriteFile` on `state.json`), nothing else. No in-memory state, no adapter coupling.

- `MassStorageAdapter.prunePhantomManifest` becomes a thin wrapper: call the util, then update in-memory `managedFiles` based on the pruned set so a subsequent `save()` doesn't regress the prune.
- `orphans-mass-storage.ts` doctor path replaces its inline rewrite with a call to the same util.

**Option A (rejected): open a transient adapter in the doctor.** Adds more state, more code, and conceptually wrong — the doctor is supposed to be diagnostic-shaped, not adapter-shaped.

## Acceptance

- New util `pruneManifestRows` in `packages/podkit-core/src/device/mass-storage-manifest.ts`.
- `MassStorageAdapter.prunePhantomManifest` delegates to the util + handles in-memory sync.
- `orphans-mass-storage.ts` doctor repair delegates to the util.
- No behaviour change for either consumer (existing tests must pass without modification).
- Direct unit tests for the util cover: empty list / single row / multiple rows / missing manifest / read-only mount (atomic rollback) / unrecognised manifest shape.

## Why deferred

Both call sites work correctly today. The duplication is small (a few dozen lines) and divergence risk is the only motivation. Worth doing before either path grows more complex, but not urgent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 New util `pruneManifestRows` in packages/podkit-core/src/device/mass-storage-manifest.ts
- [x] #2 MassStorageAdapter.prunePhantomManifest delegates to the util + handles in-memory managedFiles sync
- [x] #3 orphans-mass-storage.ts doctor repair delegates to the util
- [x] #4 No behaviour change for either consumer (existing tests pass unchanged)
- [x] #5 Direct unit tests for the util cover empty / single / multiple / missing-manifest / read-only mount / unrecognised shape
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Extracted `pruneManifestRows(stateDir, paths)` to `packages/podkit-core/src/device/mass-storage-manifest.ts`. Both consumers now delegate:

- `MassStorageAdapter.prunePhantomManifest` keeps the missing-manifest ENOENT pre-check (preserves the adapter-level "in-memory state claims managed files but manifest is gone = surface as errors" expectation) plus the post-prune in-memory `managedFiles` sync.
- `orphans-mass-storage.ts` `--repair orphan-files` path replaces its inline rewrite block with a call to the util.

No behaviour change — existing tests passed without modification. 9 new direct unit tests for the util cover the six required scenarios (empty / single / multiple / missing-manifest / read-only-mount atomic rollback / unrecognised shape) plus a few edge cases.

Net: 2 new files (~290 lines util + tests), -13 lines from consumers (~20 from adapter hot path, ~10 from doctor inline block, minus +17 across both).

Future-worth-noting: the adapter's `this.manifest` field could drift if anything other than `prunePhantomManifest` writes the manifest on disk without updating it. Worth a future audit.
<!-- SECTION:FINAL_SUMMARY:END -->
