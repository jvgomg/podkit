---
id: TASK-072.03
title: Implement backwards compatibility for legacy config
status: To Do
assignee: []
created_date: '2026-03-08 23:47'
labels:
  - config
  - compat
dependencies: []
parent_task_id: TASK-072
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Support existing configs with top-level `source`, `device`, `quality` fields:

- Detect legacy config format
- Migrate to new schema internally (create `music.default`, `devices.default`)
- Log deprecation warning suggesting migration
- Consider adding `podkit config migrate` command

Ensure existing users aren't broken by the upgrade.
<!-- SECTION:DESCRIPTION:END -->
