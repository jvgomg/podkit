---
id: TASK-072.06
title: Implement collection management command
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
Create `podkit collection` command with subcommands:

- `podkit collection` — list all collections (default action)
- `podkit collection music` — list music collections
- `podkit collection video` — list video collections
- `podkit collection add music <name> <path>`
- `podkit collection add video <name> <path>`
- `podkit collection add music <name> --subsonic` — interactive setup
- `podkit collection remove <name>` — remove (searches both namespaces)
- `podkit collection show <name>` — display collection details

Location: `packages/podkit-cli/src/commands/collection.ts`
<!-- SECTION:DESCRIPTION:END -->
