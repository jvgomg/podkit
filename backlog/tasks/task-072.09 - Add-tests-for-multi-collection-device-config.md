---
id: TASK-072.09
title: Add tests for multi-collection/device config
status: To Do
assignee: []
created_date: '2026-03-08 23:47'
labels:
  - testing
dependencies: []
parent_task_id: TASK-072
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add comprehensive tests for the new config system:

**Unit tests:**
- Config type validation
- New schema parsing
- Legacy config migration
- Default resolution
- Invalid config error messages

**Integration tests:**
- `device` command subcommands
- `collection` command subcommands
- `sync` with `-c` and `-d` flags
- Device-scoped settings applied correctly

**E2E tests:**
- Full workflow: add device, add collection, sync to specific device
<!-- SECTION:DESCRIPTION:END -->
