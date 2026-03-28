---
id: TASK-248.10
title: Doctor codec encoder checks
status: Done
assignee: []
created_date: '2026-03-27 10:43'
updated_date: '2026-03-28 12:49'
labels:
  - feature
  - transcoding
dependencies:
  - TASK-248.01
  - TASK-248.05
documentation:
  - doc-024
parent_task_id: TASK-248
priority: medium
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add FFmpeg encoder availability checks to `podkit doctor` for all codecs in the user's configured preference list.

See PRD: doc-024, section "Doctor integration."

Use generalized `TranscoderCapabilities` to check encoder availability for each codec in the resolved preference list. Show warning-level diagnostic if a preferred codec's encoder is missing (e.g., libopus not compiled into FFmpeg). Repair command offers platform-specific advice on installing the missing encoder.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `podkit doctor` checks encoder availability for all codecs in the user's configured preference list
- [x] #2 Warning shown when a preferred codec's encoder is missing (e.g., libopus)
- [x] #3 Repair command offers platform-specific installation advice (macOS/Debian/Alpine)
- [x] #4 No warning for codecs not in the user's preference list
- [x] #5 Works correctly with default and custom codec preferences
<!-- AC:END -->
