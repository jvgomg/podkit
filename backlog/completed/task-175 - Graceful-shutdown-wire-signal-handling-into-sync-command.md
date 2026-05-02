---
id: TASK-175
title: 'Graceful shutdown: wire signal handling into sync command'
status: Done
assignee: []
created_date: '2026-03-21 21:18'
updated_date: '2026-03-21 21:31'
labels:
  - graceful-shutdown
dependencies:
  - TASK-165
references:
  - packages/podkit-cli/src/commands/sync.ts
  - packages/podkit-core/src/sync/executor.ts
  - packages/podkit-core/src/sync/video-executor.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Wire the shutdown controller into the sync command so Ctrl+C triggers graceful drain-and-save.

**Changes to sync.ts:**
- Create shutdown controller before sync loops (~line 1934)
- Pass `signal` through to `executor.execute()` for both music and video
- Catch 'Sync aborted' / 'Video sync aborted' errors
- When shutdown requested: call `ipod.save()` to persist completed tracks before `close()`
- Break out of collection loops on abort
- Skip video sync if already aborting
- Ensure adapter.disconnect() runs on abort (via finally)
- Exit code 130 for interrupted sync
- Print "Saving database, please wait..." during abort-save
- Uninstall shutdown handler in finally block

**Key insight:** The executor already drains its transfer queue on abort (finishes already-transcoded files). We just need to catch the thrown error and call save() before close().
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Ctrl+C during music sync stops new work, finishes current operation, saves completed tracks
- [x] #2 Ctrl+C during video sync stops new work, saves completed tracks
- [x] #3 Multiple music collections: abort breaks out of collection loop after saving current
- [x] #4 Video sync skipped if already aborting
- [x] #5 adapter.disconnect() called on abort
- [x] #6 Exit code 130 on graceful abort
- [x] #7 User sees 'Graceful shutdown requested' and 'Saving database' messages
- [x] #8 Shutdown handler uninstalled in finally block
<!-- AC:END -->
