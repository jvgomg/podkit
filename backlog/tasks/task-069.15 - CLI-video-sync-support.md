---
id: TASK-069.15
title: CLI video sync support
status: To Do
assignee: []
created_date: '2026-03-08 16:05'
labels:
  - video
  - phase-5
dependencies: []
references:
  - packages/podkit-cli/src/commands/sync.ts
parent_task_id: TASK-069
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add video sync capabilities to the CLI, either as new options on existing commands or as dedicated video commands.

**Depends on:** TASK-069.13 (Sync engine video support)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 podkit sync --type video option (or similar UX)
- [ ] #2 Video source directory configuration
- [ ] #3 Video quality preset selection (max/high/medium/low)
- [ ] #4 Dry-run shows video compatibility analysis
- [ ] #5 Progress output during video transcoding
- [ ] #6 Status command shows video track counts
- [ ] #7 List command can filter/show video content
- [ ] #8 Config file supports video settings
- [ ] #9 Help text documents video options
- [ ] #10 Unit tests for CLI argument parsing
<!-- AC:END -->
