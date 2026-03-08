---
id: TASK-072.05
title: Implement device management command
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
Create `podkit device` command with subcommands:

- `podkit device` — list configured devices (default action)
- `podkit device add <name>` — detect connected iPod, save to config
- `podkit device remove <name>` — remove from config
- `podkit device show <name>` — display device config details

Refactor existing `add-device` command into this structure.

Location: `packages/podkit-cli/src/commands/device.ts`
<!-- SECTION:DESCRIPTION:END -->
