---
id: TASK-183
title: 'Graceful shutdown: daemon abort-on-SIGTERM with drain-and-save'
status: Done
assignee: []
created_date: '2026-03-21 21:48'
updated_date: '2026-03-21 22:19'
labels:
  - graceful-shutdown
  - docker
dependencies: []
references:
  - packages/podkit-daemon/src/main.ts
  - packages/podkit-daemon/src/sync-orchestrator.ts
  - packages/podkit-cli/src/shutdown.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The daemon currently waits for an in-progress sync to fully complete on SIGTERM. Docker sends SIGTERM with a 10s timeout before SIGKILL. If a sync takes longer than 10s (common for large libraries), Docker SIGKILLs the process — which can corrupt the iPod database.

Now that the CLI supports graceful abort with save-on-abort (TASK-175) and incremental saves (TASK-178), the daemon should pass an abort signal to the sync orchestrator on SIGTERM so it drains the current operation and saves, rather than trying to complete the entire sync.

**Current flow (daemon main.ts:45-64):**
1. SIGTERM → stop polling
2. Wait for in-progress sync to fully complete (`orchestrator.waitForIdle()`)
3. Exit 0

**Proposed flow:**
1. SIGTERM → stop polling + signal abort to the sync orchestrator
2. Sync drains current operation, saves completed tracks (should complete in <10s)
3. Exit 0

**Changes needed:**
- `SyncOrchestrator` needs an `abort()` method that signals its internal sync to stop
- The orchestrator spawns `podkit sync` as a child process — it would need to forward SIGINT to that child process
- OR: refactor the orchestrator to use the core library directly (with AbortController) instead of spawning a CLI subprocess

**Note:** The incremental saves (every 50 tracks) already mitigate the worst case — even if SIGKILL hits, at most 50 tracks of work is lost and the DB is consistent. This task is about doing better: clean exit within Docker's timeout.

Check how the orchestrator runs sync — subprocess vs library call — to determine the right approach.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Daemon signals abort to in-progress sync on SIGTERM
- [x] #2 Sync drains and saves within Docker's 10s timeout
- [x] #3 Daemon exits cleanly with saved database
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Extracted `spawnCli()` from `runCli()` to expose `ChildProcess` reference. Added `spawnSync()` helper. Orchestrator stores `_activeSyncChild` and exposes `abort()` method that sends SIGINT. Daemon shutdown handler calls `abort()` before `waitForIdle()`. Exit code 130 treated as graceful abort (info log, no error notification). 3 new unit tests for abort flow, no-op when idle, and exit-130 handling.
<!-- SECTION:NOTES:END -->
