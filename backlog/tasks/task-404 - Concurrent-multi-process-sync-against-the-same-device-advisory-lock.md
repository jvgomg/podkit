---
id: TASK-404
title: Concurrent multi-process sync against the same device (advisory lock)
status: Done
assignee: []
created_date: '2026-06-07 16:17'
updated_date: '2026-06-07 17:49'
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
- [x] #1 Per-device PID-file lock acquired at sync start (after openDevice); second concurrent process exits with LOCK_HELD
- [x] #2 Lock file at `.podkit/sync.lock` (mass-storage) or `iPod_Control/.podkit-sync.lock` (iPod); contains `{pid, startTimeMs}` JSON
- [x] #3 Crashing podkit leaves a stale lock; next process probes PID liveness + start-time, takes over cleanly
- [x] #4 Daemon respects the lock: cycle is skipped + logged on contention (not retry-spin)
- [x] #5 Test pins parallel-two-processes scenario (one succeeds, one errors LOCK_HELD)
- [x] #6 Test pins stale-lock-takeover scenario (crashed-process PID dead → next sync acquires)
- [x] #7 Read operations (scan, info) do NOT take the lock; documented as writes-only
- [x] #8 Architecture doc (sync/planning.md §6 or sibling) records the PID-file primitive shared with TASK-402
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Pinned design (decided 2026-06-07)

**Primitive: PID-file with `{pid, startTimeMs}` tuple.** Shared with TASK-402 — single liveness abstraction across both tasks.

Per-device lock path: `.podkit/sync.lock` on mass-storage, `iPod_Control/.podkit-sync.lock` on iPod. File contents: JSON `{pid, startTimeMs}`.

**Acquire algorithm:**
```
1. Try fs.open(path, 'wx')  // O_CREAT|O_EXCL — kernel-atomic
2. On success: write {pid, startTimeMs}, return handle
3. On EEXIST: read existing, probe liveness (kill(pid, 0) + start-time compare)
   - Alive → throw LockHeldError(existingPid)
   - Dead → unlink stale, retry (once)
4. On retry EEXIST: another process won the takeover race → re-probe, error if alive
```

**Release:** unlink in `finally`. Crash leaks file; next process detects via stale-PID probe and self-heals.

**Why PID-file, not flock(2):** flock semantics on FAT32/exFAT (common iPod filesystem families) are platform-dependent. PID-file uses only `open(O_CREAT|O_EXCL)` + `unlink` + `kill(pid, 0)` — stable across all target filesystems (exFAT/FAT32/HFS+/APFS/ext4/NTFS). See sibling decision in TASK-402.

**Scope clarifications:**
- Writes only — daemon scan/info read operations do NOT take the lock.
- `.podkit/` dir created if absent during acquire (virgin mass-storage device).
- Cross-host (network-mounted iPod) explicitly out-of-scope; document as known limitation.

**Daemon integration (AC #3):** daemon catches `LockHeldError`, logs `cycle skipped: lock held by pid N`, returns from cycle. No retry-spin within the cycle.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
PID-file primitive landed in `packages/podkit-core/src/lib/pid-file.ts` with `{pid, startTimeMs}` ownership tuple, `acquireLock`/`LockHandle`/`LockHeldError`/`LockContestedError`, and platform-specific start-time probes (Linux `/proc/<pid>/stat`, macOS `ps -o etime=` — etime over lstart to dodge TZ ambiguity).

CLI sync command takes the lock at `.podkit/sync.lock` (mass-storage) or `iPod_Control/.podkit-sync.lock` (iPod) after `openDevice`, releases in `finally` with pre-unlink ownership verification (prevents late-A unlinking B's lock after takeover). `LOCK_HELD` exit code 4. Dry-run skips the lock — documented in arch §6.

Daemon detects LOCK_HELD via subprocess exit code with a one-line caveat comment for if/when it switches to in-process `runSync`.

Architecture doc `documents/architecture/sync/planning.md` §6 added covering primitive shape, acquire algorithm, `waitForOwnership` 3×5ms read-backoff (defends the open(wx)→writeFile race discovered in 8-parallel testing), dry-run policy, and known limitations. §8 References include `lib/pid-file.ts` + test.

Tests: pid-file.test.ts covers identity, round-trip, liveness, acquire/contention/stale-takeover, release idempotency + foreign-takeover protection, 8-parallel acquire (exactly-one-wins), deterministic `LockContestedError` via test-seam hooks. Two coverage gaps annotated in-code: ENOSPC mid-write (kernel fault-injection not portable) and HZ≠100 kernels (failure mode is contention, not corruption).
<!-- SECTION:FINAL_SUMMARY:END -->
