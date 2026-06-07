---
id: TASK-402
title: >-
  Daemon mode: per-process SESSION_START_MS misses self-interrupted
  transcode-tmp dirs
status: To Do
assignee: []
created_date: '2026-06-07 16:16'
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
- [ ] #1 Daemon's self-interrupted transcode-tmp dirs are reaped on subsequent cycles within the same process lifetime
- [ ] #2 Sibling-process protection preserved: separate live podkit sync invocation's tmp dir is NEVER reaped
- [ ] #3 Architecture decision recorded (option 1/2/3/4) with justification
- [ ] #4 Test pins daemon-loop-with-interruption scenario
- [ ] #5 Test pins concurrent-sibling-process scenario
- [ ] #6 Doc updated: sync/planning.md §6 marks this open item closed
<!-- AC:END -->
