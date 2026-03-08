---
id: TASK-072.04
title: Unify sync command with music/video subcommands
status: To Do
assignee: []
created_date: '2026-03-08 23:47'
labels:
  - cli
dependencies: []
parent_task_id: TASK-072
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Refactor sync command to handle both music and video:

- `podkit sync` — sync all (music + video defaults)
- `podkit sync music` — sync music only
- `podkit sync video` — sync video only
- Add `-c <collection>` flag (searches both namespaces)
- Add `-d <device>` flag
- Remove separate `video-sync` command (or alias to `sync video`)

Location: `packages/podkit-cli/src/commands/sync.ts`
<!-- SECTION:DESCRIPTION:END -->
