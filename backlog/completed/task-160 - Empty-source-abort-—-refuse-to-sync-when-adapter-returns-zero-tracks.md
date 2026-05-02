---
id: TASK-160
title: Empty source abort — refuse to sync when adapter returns zero tracks
status: Done
assignee: []
created_date: '2026-03-18 23:55'
updated_date: '2026-03-19 13:25'
labels:
  - cli
  - safety
dependencies: []
references:
  - packages/podkit-cli/src/commands/sync.ts
  - packages/podkit-core/src/adapters/
documentation:
  - backlog/documents/doc-004.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When a collection adapter (Directory, Subsonic, or Video) returns zero tracks, the CLI should refuse to sync that collection and exit with an error rather than treating it as "remove everything." This protects against source bugs (misconfigured path, Subsonic server down, etc.) that would otherwise trigger mass deletion when `--delete` is enabled.

This is a safety guardrail for all users, not just daemon mode. It should be unconditional — not configurable.

See PRD doc-004 (Docker Daemon Mode) for broader context, but this task is independently valuable and has no dependencies on daemon work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 When a music collection adapter returns zero tracks, the sync command logs an error for that collection and skips it (does not proceed to diff/plan/execute)
- [x] #2 When a video collection adapter returns zero tracks, the video sync is skipped with an error
- [x] #3 The error message clearly states the collection name and that zero tracks were found
- [x] #4 If all collections return zero tracks, the command exits with a non-zero exit code
- [x] #5 JSON output (--output json) includes the error in a structured format
- [x] #6 Collections with tracks still sync normally even if another collection returned zero
- [x] #7 Unit or integration tests verify the zero-track abort behavior
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation

Added zero-track guards to both `syncMusicCollection` and `syncVideoCollection` in `packages/podkit-cli/src/commands/sync.ts`. The check happens after `adapter.getTracks()`/`getVideos()` returns but before the diff/plan phase.

**Behavior:**
- Text mode: logs error with collection name, skips collection
- JSON mode: returns `{ success: false, error: \"...\" }` in SyncOutput
- Adapter `disconnect()` called before returning
- `anyError` flag propagates → `process.exitCode = 1` when all collections fail

**Review findings fixed:**
- Bug: video JSON output wasn't being emitted in the caller loop (added `out.json(result.jsonOutput)`)
- Video error message now says \"zero videos\" instead of \"zero tracks\"

**Test file:** `packages/podkit-cli/src/commands/sync-empty-source.test.ts` (7 tests covering video path)
<!-- SECTION:NOTES:END -->
