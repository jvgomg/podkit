---
id: TASK-379
title: Device lockfile + concurrent-sync detection — doc-041 §5.5/Q2
status: Done
assignee: []
created_date: '2026-06-03 09:08'
updated_date: '2026-06-08 07:32'
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

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Superseded by TASK-404 (PID-file primitive + sync executor lock), TASK-407 (doctor repair lock), TASK-409 (dry-run carve-out). All three closed 2026-06-07.

**Delivered design vs TASK-379 proposal:**

| TASK-379 asked | Built | Rationale |
|---|---|---|
| `.podkit/lock` with PID + ISO + hostname | `.podkit/sync.lock` / `iPod_Control/.podkit-sync.lock` with `{pid, startTimeMs}` JSON | hostname only useful for cross-host; cross-host punted (NFS/SMB advisory locks unreliable, podkit deployment is laptop-local). startTimeMs (not ISO) chosen for direct comparability with `/proc/<pid>/stat` + macOS `ps -o etime=`. |
| Stale-PID detection | `kill(pid,0)` + start-time read with ±2s tolerance; Linux `/proc/<pid>/stat[22]` + `btime`, macOS `etime` (TZ-immune). Unsupported platforms → null → fail-safe takeover. | |
| `--ignore-device-lock` override | Not built | YAGNI. `rm <lockfile>` is escape hatch; auto-takeover already handles dead PIDs + unsupported platforms. File a new task if a user ever hits the niche case. |
| Cross-host stale-lock relaxation (Q2) | Explicitly out-of-scope, documented in planning.md §6 | Correct call for actual deployment. |

**Files of record:**
- Primitive: `packages/podkit-core/src/lib/pid-file.ts`
- Path resolver: `packages/podkit-core/src/lib/sync-lock-path.ts`
- Sync wiring: `packages/podkit-cli/src/commands/sync.ts:990-1033`
- Doctor wiring: `packages/podkit-cli/src/commands/doctor.ts:1479` (`withDeviceWriteLock`)
- Daemon LOCK_HELD branch: `packages/podkit-daemon/src/sync-orchestrator.ts:244`
- Architecture doc: `documents/architecture/sync/planning.md` §6 (complete writer inventory + acquire algorithm + dry-run policy + cross-host out-of-scope)
- Tests: `pid-file.test.ts` (355L), `sync-lock-path.test.ts` (230L), `doctor-lock.test.ts` (303L), daemon LOCK_HELD test at `sync-orchestrator.test.ts:578`.

**doc-041 updates (this close):** §5.5 marked RESOLVED, §8 Q2 marked RESOLVED, §9 moved TASK-379 from "Open tasks anchored here" to "Recently closed" with pointers to TASK-404/407/409 + planning.md §6.
<!-- SECTION:FINAL_SUMMARY:END -->
