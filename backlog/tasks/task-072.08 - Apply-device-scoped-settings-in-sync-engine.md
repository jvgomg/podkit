---
id: TASK-072.08
title: Apply device-scoped settings in sync engine
status: To Do
assignee: []
created_date: '2026-03-08 23:47'
labels:
  - core
  - sync
dependencies: []
parent_task_id: TASK-072
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update sync engine to apply device-specific settings:

- Read quality/videoQuality from device config
- Read artwork setting from device config
- Read transforms config from device
- Pass these settings to transcoding and metadata pipelines

Ensure CLI flag overrides (e.g., `--quality`) still take precedence over device config.
<!-- SECTION:DESCRIPTION:END -->
