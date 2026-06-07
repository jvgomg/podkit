---
id: TASK-404
title: Concurrent multi-process sync against the same device (advisory lock)
status: To Do
assignee: []
created_date: '2026-06-07 16:17'
labels:
  - bug
  - reliability
  - sync-engine
  - daemon
  - follow-up
dependencies:
  - TASK-398
references:
  - packages/podkit-cli/src/commands/sync.ts
  - packages/podkit-core/src/sync/engine/pre-sync-sweep.ts
priority: low
ordinal: 120000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

Two podkit processes can target the same device simultaneously — most plausibly a `@podkit/daemon` running a periodic cycle while the user kicks off a manual `podkit sync` against the same iPod. Today's behaviour is undefined:

- Both processes call `runPreSyncSweep` against the same device. Both walk the same content surface; both see the same debris; both try to `rm` the same paths. ENOENT-tolerance in `rm({force: true})` handles the file-level race, but the order is non-deterministic and the warning messages will conflict.
- Both processes then enter the executor's track-transfer loop against the same `iPod_Control/Music/F**` (or mass-storage content dirs). The mass-storage adapter writes track files + the manifest; concurrent writes can corrupt the manifest. The iPod adapter writes the iTunesDB on `save()`; concurrent writes can corrupt the DB.

The atomic-write contract protects against torn target files within ONE process. It does NOT protect against two processes both attempting writes to the same file.

## Scope

1. **Acquire a per-device advisory lock** at the start of `runSyncAction` (after `openDevice` succeeds). Common patterns:
   - `flock(2)` on a sentinel file under `.podkit/` (mass-storage) or `iPod_Control/` (iPod). POSIX file-system level, works across processes on the same host.
   - PID-file with TTL + liveness check (more code, no kernel support needed).
2. **On lock contention**: error out with a clear message — `"Another podkit process is already syncing /Volumes/TERAPOD (pid 12345). Wait for it to finish or kill it."` Exit code maps to a new `LOCK_HELD` code.
3. **Cleanup on exit**: lock released in `finally` so a crashing podkit doesn't permanently block the device. `flock` releases automatically on process exit.
4. **Daemon-aware**: the daemon should ALSO acquire the lock for each cycle. The daemon catching `LOCK_HELD` from a manual sync should skip the cycle (not retry-spin) and log it.
5. **Tests**: spawn two `podkit sync` processes against the same fixture in parallel; assert exactly one succeeds and one gets `LOCK_HELD`.

## Why deferred

Rare in practice today — most users don't run the daemon and a manual sync simultaneously. But the failure mode is silent data corruption (concurrent iTunesDB writes), which is the worst kind of bug. Worth filing now so it doesn't ambush future debugging.

## Open design questions

- Lock granularity: per-device-path or per-mount-point? (Paths can be symlinked; mounts can be re-mounted.)
- Should the lock include the daemon's READ operations (scan, info)? Probably not — only writes need protection.
- Cross-host: if two hosts share a network-mounted iPod (rare), advisory file locks may not be honoured by the FS. Document as out-of-scope.

## Acceptance

- A second `podkit sync` against an already-syncing device fails fast with `LOCK_HELD`.
- Crashing podkit releases the lock automatically.
- Daemon respects the lock (skips cycle on contention).
- Test pins the parallel-two-processes case.
- Architecture decision recorded (flock vs PID file).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Per-device advisory lock acquired at sync start; second concurrent process exits with LOCK_HELD
- [ ] #2 Crashing podkit releases the lock automatically (flock auto-release or PID-liveness)
- [ ] #3 Daemon respects the lock: cycle is skipped + logged on contention (not retry-spin)
- [ ] #4 Test pins parallel-two-processes scenario
- [ ] #5 Architecture decision recorded (flock vs PID file vs other)
- [ ] #6 Doc updated: sync/planning.md §6 marks this open item closed
<!-- AC:END -->
