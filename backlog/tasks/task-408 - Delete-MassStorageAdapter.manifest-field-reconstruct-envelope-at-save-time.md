---
id: TASK-408
title: Delete MassStorageAdapter.manifest field; reconstruct envelope at save time
status: Done
assignee: []
created_date: '2026-06-07 22:37'
updated_date: '2026-06-07 22:54'
labels:
  - refactor
  - tech-debt
  - sync-engine
  - mass-storage
  - follow-up
dependencies:
  - TASK-406
references:
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - packages/podkit-core/src/device/mass-storage-manifest.ts
priority: low
ordinal: 123000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

The TASK-406 audit (opus, 2026-06-07) inspected `MassStorageAdapter.manifest` and found:

- The only fields on `MassStorageManifest` are `version` (constant), `managedFiles` (kept in `this.managedFiles: Set<string>` separately and authoritatively), and `lastSync` (a timestamp).
- `save()` reconstructs the envelope from `this.managedFiles` + a fresh `lastSync` immediately before writing — `this.manifest` itself is never used as a source of truth after `open()`.
- Drift between `this.manifest` and `this.managedFiles` is therefore **observable nowhere today** — the original "drift" worry the TASK-406 worker flagged is a theoretical surface, not a real bug.

But: anyone adding a future field to `MassStorageManifest` (e.g. schema v2 with a `lastSweepAt` for the DRAFT-015 perf-cache idea) will reasonably assume `this.manifest` is authoritative and get bitten when in-memory mutations don't update it.

## Scope

Delete the field. Keep only:

```ts
private managedFiles: Set<string> = new Set();
private lastSync: string | undefined;
```

- `loadManifest()` reads `state.json`, hydrates `this.managedFiles` (already does this) and sets `this.lastSync = parsed.lastSync`.
- `save()` constructs the envelope fresh: `{ version: 1, managedFiles: [...this.managedFiles].sort(), lastSync: new Date().toISOString() }`. Writes via `atomicWriteFile`.
- `prunePhantomManifest()` no longer re-reads `this.manifest` after util writes — the in-memory `managedFiles` was already updated by the wrapper, and `save()` will reconstruct cleanly. Delete the re-read block (line ~1556).
- Update any internal reads of `this.manifest` (there are none outside `save()` per the audit, but double-check before deleting).

## Acceptance

- `this.manifest` field removed from `MassStorageAdapter`.
- `this.lastSync: string | undefined` added.
- `save()` constructs the envelope on-the-fly.
- `prunePhantomManifest`'s post-util re-read deleted.
- No behaviour change — all existing tests pass without modification.
- Refresh: when a future field is added to `MassStorageManifest`, the maintainer is forced to decide where it lives (load-time field on the adapter? reconstructed at save?) — no implicit "lives in `this.manifest`" path remains.

## Why low priority

Pure preventive refactor. No bug today. Worth doing while the surface is fresh in the team's head, BUT non-urgent. Could sit indefinitely without consequence.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 this.manifest field removed from MassStorageAdapter
- [x] #2 this.lastSync: string | undefined added; loadManifest sets it
- [x] #3 save() constructs the envelope on-the-fly from this.managedFiles + this.lastSync
- [x] #4 prunePhantomManifest no longer re-reads this.manifest after the util write
- [x] #5 No behaviour change — existing tests pass without modification
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`MassStorageAdapter.manifest` field removed. Replaced with `private lastSync: string | undefined`. `loadManifest()` now hydrates `this.managedFiles` (already did) plus `this.lastSync`. `save()` constructs `{ version: 1, managedFiles: [...this.managedFiles].sort(), lastSync: new Date().toISOString() }` fresh on every call. `prunePhantomManifest`'s post-util re-read of `this.manifest` is deleted (the wrapper already updates `this.managedFiles`; `save()` reconstructs cleanly).

No behaviour change — all existing tests pass without modification (204 mass-storage adapter tests, 0 fail).

The future-drift surface the TASK-406 audit flagged is gone: there is no longer any cached "manifest envelope" on the adapter that could disagree with the on-disk file. Adding a new field to `MassStorageManifest` now forces an explicit decision (load-time field on adapter? reconstruct at save?) instead of an implicit "lives in `this.manifest`" path.
<!-- SECTION:FINAL_SUMMARY:END -->
