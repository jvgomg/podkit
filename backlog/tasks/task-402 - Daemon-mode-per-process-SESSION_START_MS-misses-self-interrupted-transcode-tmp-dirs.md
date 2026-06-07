---
id: TASK-402
title: >-
  Daemon mode: per-process SESSION_START_MS misses self-interrupted
  transcode-tmp dirs
status: Done
assignee: []
created_date: '2026-06-07 16:16'
updated_date: '2026-06-07 17:49'
labels:
  - bug
  - daemon
  - sync-engine
  - follow-up
dependencies:
  - TASK-398
references:
  - packages/podkit-core/src/diagnostics/checks/debris-transcode-tmp.ts
  - packages/podkit-core/src/diagnostics/scanners/transcode-tmp-walker.ts
  - packages/podkit-daemon/
priority: low
ordinal: 118000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

TASK-398's pre-sync sweep uses `SESSION_START_MS = Date.now()` captured at module load. The walker reaps any `podkit-transcode-<uuid>/` directory under `os.tmpdir()` whose mtime is strictly older than `SESSION_START_MS`.

This is correct for one-shot CLI invocations: process starts, sweep runs once, sync runs, exits. The floor catches abandoned dirs from prior process invocations.

**It is wrong for long-running daemon processes** (`@podkit/daemon`):

1. Daemon process loads `@podkit/core`. `SESSION_START_MS` captures at T0.
2. Daemon enters its periodic sync loop. Cycle N starts at T1 > T0. Cycle N creates `podkit-transcode-<uuid>/` with mtime ≈ T1 and reaps it in `finally`.
3. Cycle N is interrupted mid-flight (SIGTERM/SIGKILL from systemd, crash, etc.). The transcode dir is left behind with mtime ≈ T1.
4. Cycle N+1 starts at T2 > T1. Its pre-sync sweep walks `os.tmpdir()` and finds the cycle-N orphan. **mtime T1 is > SESSION_START_MS T0**, so the walker SKIPS the orphan.
5. The orphan never gets reaped within this daemon's lifetime. Only a daemon restart (which re-captures `SESSION_START_MS`) eventually surfaces it.

## Why it's a real bug

The whole point of the pre-sync sweep is to clean up after interrupted prior cycles. In daemon mode the most common interruption case is the daemon's own prior cycle — and that case is exactly the one we miss.

## Possible fixes

**Option 1: Per-cycle session start.** Orchestrator captures `Date.now()` immediately before `runPreSyncSweep` and passes it via the (already-exposed) `sessionStartMsOverride`. Each cycle has its own floor.

- **Risk:** A sibling podkit process that started before this cycle has older tmp dirs — those would now be eligible for reaping even though they're still live. Wrong direction for sibling-protection.

**Option 2: PID-based liveness check.** Each `podkit-transcode-<uuid>/` writes a `.pid` file with the owning process's PID. Walker reaps if (mtime < SESSION_START_MS) OR (pid file present AND pid is dead). Sibling-safe, daemon-safe.

- **Risk:** PID reuse on long-uptime systems (pid wrap-around). Mitigate by writing both PID and start-time tuple.

**Option 3: Lock file.** Each running sync acquires a per-host advisory lock. Sweep skips dirs whose lock is held. Heaviest design but most correct.

**Option 4: Time-based threshold instead of session-anchored floor.** "Reap dirs whose mtime is older than 1 hour" (or 24 hours). Sibling syncs that run longer than the threshold are at risk, but in practice transcode-tmp dirs only live for minutes.

## Acceptance

- Daemon's self-interrupted transcode-tmp dirs are reaped on subsequent cycles within the same process lifetime.
- Sibling-process protection is preserved (a separate live `podkit sync` invocation's tmp dir is never reaped).
- Test pins both: daemon-loop-with-interruption + concurrent-sibling-process.
- Architecture decision recorded (which of options 1–4 + why).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Daemon's self-interrupted transcode-tmp dirs are reaped on subsequent cycles within the same process lifetime
- [x] #2 Sibling-process protection preserved: separate live podkit sync invocation's tmp dir is NEVER reaped (PID-liveness probe)
- [x] #3 SESSION_START_MS floor REMOVED from the walker; replaced wholesale by PID-liveness on `.owner`
- [x] #4 Each transcode-tmp dir writes `.owner` with `{pid, startTimeMs}` BEFORE the first transcode op
- [x] #5 Walker policy: dead PID OR missing `.owner` → reap. Live PID → skip.
- [x] #6 Test pins daemon-loop-with-interruption scenario
- [x] #7 Test pins concurrent-sibling-process scenario
- [x] #8 Architecture doc (sync/planning.md §6 or sibling) records the PID-file primitive; cross-references TASK-404
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Pinned design (decided 2026-06-07)

**Primitive: PID-file with `{pid, startTimeMs}` tuple.** Shared with TASK-404 — single liveness abstraction across both tasks.

Each `podkit-transcode-<uuid>/` dir contains an `.owner` file with `{pid, startTimeMs}` JSON. Walker reads `.owner`, probes `process.kill(pid, 0)` + compares start-time (guards against PID reuse). Live owner → skip dir. Dead owner OR missing `.owner` → reap.

**SESSION_START_MS floor is REMOVED entirely** as part of this work. No dual-mode. Rationale: `podkit-transcode-*` is our own private pattern under `os.tmpdir()`; if a dir lacks `.owner` it's either a crash before `.owner` write (rare, harmless to reap) or pre-PID-file legacy debris (which is exactly what we want reaped). The floor was a proxy for liveness — replacing it with a direct liveness probe makes the proxy redundant.

**Atomicity of `.owner` write:** sync engine writes `.owner` BEFORE the first transcode op inside the dir. Race window between `mkdir` and `.owner` write is sub-millisecond and only matters if a sibling sweep fires in that window — acceptable: worst case is a just-created empty dir gets reaped, which is no-op.

**Why PID-file, not flock(2):** flock semantics on FAT32/exFAT (the iPod filesystem families we target) are platform-dependent and silently degrade. PID-file uses only `open(O_CREAT|O_EXCL)` + `unlink` + `kill(pid, 0)` — all stable across exFAT/FAT32/HFS+/APFS/ext4/NTFS. One primitive, predictable behaviour.

**Start-time source:** `/proc/<pid>/stat` field 22 on Linux; `ps -o lstart= -p <pid>` shell-out on macOS (one-shot, not in hot path). For our own PID at write time: process start derived from `process.uptime()` against `Date.now()`. Belt-and-braces guard against the rare long-uptime PID-reuse edge.

**This replaces** the four-option exploration in the original description (per-cycle floor / PID liveness / lock file / time threshold). Option 2 wins, generalized.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`SESSION_START_MS` floor removed wholesale from `transcode-tmp-walker.ts`. Each `podkit-transcode-<uuid>/` dir now writes `.owner` (`{pid, startTimeMs}`) before the first transcode op (sync/music/pipeline.ts). Walker policy: live PID → skip; dead PID OR missing/malformed `.owner` → reap.

Reuses the PID-file primitive from TASK-404 — single liveness abstraction across both consumers. Daemon's self-interrupted transcode dirs now reap correctly within the same process lifetime; sibling-process protection preserved via PID-liveness probe.

`sessionStartMsOverride` plumbing removed from `pre-sync-sweep.ts` + `ScannerContext.types.ts`. All downstream tests updated to `.owner`-based fixtures.

Architecture decision recorded in `documents/architecture/sync/planning.md` §6, cross-referenced with TASK-404.
<!-- SECTION:FINAL_SUMMARY:END -->
