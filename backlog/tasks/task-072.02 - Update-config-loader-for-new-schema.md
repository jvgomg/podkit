---
id: TASK-072.02
title: Update config loader for new schema
status: To Do
assignee: []
created_date: '2026-03-08 23:47'
labels:
  - config
dependencies: []
parent_task_id: TASK-072
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update the config loader to parse the new multi-collection/device schema:

- Parse `[music.*]` sections into music collections map
- Parse `[video.*]` sections into video collections map
- Parse `[devices.*]` sections with nested transforms
- Parse `[defaults]` section
- Validate collection/device references in defaults

Location: `packages/podkit-cli/src/config/loader.ts`
<!-- SECTION:DESCRIPTION:END -->
