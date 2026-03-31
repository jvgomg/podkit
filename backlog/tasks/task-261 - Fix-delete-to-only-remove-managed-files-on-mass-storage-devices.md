---
id: TASK-261
title: Fix --delete to only remove managed files on mass-storage devices
status: To Do
assignee: []
created_date: '2026-03-31 14:23'
updated_date: '2026-03-31 14:30'
labels:
  - mass-storage
  - bug
dependencies: []
references:
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - packages/podkit-core/src/sync/engine/differ.ts
  - packages/podkit-core/src/sync/engine/planner.ts
  - packages/e2e-tests/src/features/mass-storage-sync.e2e.test.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Bug:** `--delete` on mass-storage devices removes ALL unmatched device tracks, including unmanaged files the user placed on the device manually. The `managed` flag on `MassStorageTrack` is set from the `.podkit/state.json` manifest but is never consulted during diffing or planning.

**Expected behavior (matching iPod):** `--delete` should only remove tracks that podkit manages. On iPod, this happens naturally because `IpodDeviceAdapter.getTracks()` only returns iTunesDB tracks. On mass-storage, the adapter returns all scanned files regardless of `managed` status.

**Root cause:** `MassStorageAdapter.getTracks()` returns all tracks. The differ puts any unmatched device track into `toRemove`. Neither the differ nor the planner checks the `managed` flag.

**Fix approach:** Filter the track list provided to the sync engine so that only managed tracks are candidates for `--delete` removal. Unmanaged files should be invisible to `--delete` — they are the concern of `podkit doctor` (see TASK-254).

Also: drop pretty-printing from state.json writes (`JSON.stringify` without indent args) — no need to bloat the file on device storage.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 --delete only removes tracks where managed === true
- [ ] #2 Unmanaged files in content directories are preserved when --delete is used
- [ ] #3 E2E test: sync with --delete preserves user-placed files in content directories
- [ ] #4 E2E test: sync with --delete removes managed tracks not in source collection
- [ ] #5 state.json written without pretty-printing (no indent/whitespace)
- [ ] #6 Collision detection: sync errors (before writing) if a planned file path conflicts with an existing unmanaged file
- [ ] #7 Collision detection works in both normal sync and --dry-run mode
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Design decisions (2026-03-31)

**Unmanaged files are invisible to the sync engine.** They do not participate in source-device matching. This mirrors iPod behavior where only DB tracks are visible. If an unmanaged file coincidentally matches a source track's metadata, podkit will attempt to create its own managed copy — which leads to the collision check.

**Collision detection before writes.** Since path allocation is deterministic (artist/album/title → file path), an unmanaged file could occupy the exact path podkit wants to write to. Rather than silently overwriting, sync should error with a clear message. This check runs pre-sync (and during --dry-run) so the user can resolve it (move/delete the file, or let `podkit doctor` handle it after TASK-254).
<!-- SECTION:NOTES:END -->
