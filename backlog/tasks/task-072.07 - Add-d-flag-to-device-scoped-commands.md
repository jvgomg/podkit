---
id: TASK-072.07
title: Add -d flag to device-scoped commands
status: To Do
assignee: []
created_date: '2026-03-08 23:47'
labels:
  - cli
dependencies: []
parent_task_id: TASK-072
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add `-d <device>` flag to all commands that interact with a device:

- `podkit status [-d <device>]`
- `podkit list [-d <device>]`
- `podkit clear music|video [-d <device>]`
- `podkit reset [-d <device>]`
- `podkit mount [-d <device>]`
- `podkit eject [-d <device>]`

When omitted, use default device from config. Resolve device name to volumeUuid for auto-detection.
<!-- SECTION:DESCRIPTION:END -->
