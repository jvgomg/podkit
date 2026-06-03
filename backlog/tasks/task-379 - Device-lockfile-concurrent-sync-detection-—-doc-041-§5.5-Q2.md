---
id: TASK-379
title: Device lockfile + concurrent-sync detection — doc-041 §5.5/Q2
status: To Do
assignee: []
created_date: '2026-06-03 09:08'
labels:
  - enhancement
  - save-transaction
  - concurrency
  - reliability
dependencies:
  - TASK-142
references:
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - packages/podkit-core/src/device/ipod-adapter.ts
  - backlog/docs/doc-041 - Save-Transaction-Design-and-State-of-Play.md
priority: low
ordinal: 105000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`doc-041 §5.5`: two `podkit sync` runs against the same device can overlap and corrupt each other's manifest writes. The tmp+rename serializes the LAST writer, but the in-between state is undefined.

## Scope

1. `MassStorageAdapter.open()` writes `.podkit/lock` containing PID + start ISO timestamp + hostname.
2. If `.podkit/lock` exists on open, check whether the PID is alive:
   - Same host, PID alive → throw `DeviceBusyError` with the offending PID and an actionable message.
   - Same host, PID dead → stale lock, log warning, take over.
   - Different host → conservative: throw `DeviceBusyError` (cross-host shared mounts shouldn't sync concurrently). User can force with `--ignore-device-lock`.
3. `close()` removes the lock.
4. Process crash → next run sees stale lock from §2 → takes over.
5. iPod: same pattern, lock at `iPod_Control/.podkit-lock`.

## Open question (also Q2 in doc-041)

Cross-host stale-lock detection is fundamentally hard (NFS time skew, no shared PID space). The proposal above is conservative — should the cross-host case be relaxed to a warning?

## Reference

`doc-041 §5.5`, Q2 in §8.
<!-- SECTION:DESCRIPTION:END -->
