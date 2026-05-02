---
id: TASK-248.09
title: Device info and dry-run codec display
status: Done
assignee: []
created_date: '2026-03-27 10:43'
updated_date: '2026-03-28 12:49'
labels:
  - feature
  - transcoding
dependencies:
  - TASK-248.08
documentation:
  - doc-024
parent_task_id: TASK-248
priority: medium
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surface codec preference information in `podkit device info` and `podkit sync --dry-run` output.

See PRD: doc-024, sections "Display" and "Error handling."

**`podkit device info`:** Show the full preference list with ✓/✗ per codec based on device support. First supported codec is visually obvious from left-to-right reading. Show incompatibility message when no codec in preference list is supported.

**`podkit sync --dry-run`:** Show resolved codec in summary (e.g., `Codec: aac (first supported from preference: opus → aac → mp3)`). Show codec change summary when detected (e.g., `Codec change: 12 tracks need re-transcoding (opus → aac)`). Error and exit when no codec matches, with helpful message listing supported codecs.

**Example config:** Ensure default codec stacks are documented with explanations in the generated example config.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `podkit device info` shows codec preference list with ✓/✗ per codec based on device support
- [x] #2 `podkit device info` shows incompatibility message when no codec in preference list is supported
- [x] #3 `podkit sync --dry-run` shows resolved codec with preference chain in summary
- [x] #4 `podkit sync --dry-run` shows codec change count and direction when codec changes detected
- [x] #5 `podkit sync` and `podkit sync --dry-run` error and exit with helpful message when no codec matches, listing device-supported codecs
<!-- AC:END -->
