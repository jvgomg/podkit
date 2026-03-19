---
id: TASK-160
title: Empty source abort — refuse to sync when adapter returns zero tracks
status: To Do
assignee: []
created_date: '2026-03-18 23:55'
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
- [ ] #1 When a music collection adapter returns zero tracks, the sync command logs an error for that collection and skips it (does not proceed to diff/plan/execute)
- [ ] #2 When a video collection adapter returns zero tracks, the video sync is skipped with an error
- [ ] #3 The error message clearly states the collection name and that zero tracks were found
- [ ] #4 If all collections return zero tracks, the command exits with a non-zero exit code
- [ ] #5 JSON output (--output json) includes the error in a structured format
- [ ] #6 Collections with tracks still sync normally even if another collection returned zero
- [ ] #7 Unit or integration tests verify the zero-track abort behavior
<!-- AC:END -->
