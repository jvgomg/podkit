---
id: TASK-257
title: Improve dry-run codec and copy display for mass-storage devices
status: Done
assignee: []
created_date: '2026-03-31 12:55'
updated_date: '2026-03-31 13:55'
labels:
  - ux
  - cli
milestone: m-14
dependencies: []
references:
  - packages/podkit-cli/src/commands/music-presenter.ts
  - packages/podkit-cli/src/commands/sync-presenter.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The dry-run sync plan output has misleading codec information for mass-storage devices that support the source format natively. Discovered during Echo Mini E2E validation (TASK-226).

**Issues:**

1. **`Codec: aac` line shown when no transcoding occurs:** The header always shows the resolved lossy codec preference, even when all operations are copies. This makes users think their FLAC files will be converted to AAC. The line should be hidden or de-emphasised when there's nothing to transcode.

2. **Copy count doesn't show format:** `Copy: 5` doesn't tell the user what format the files will be in on the device. Should show something like `Copy (FLAC): 5` to make it clear the source format is preserved.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Codec line is hidden or shows 'n/a' when all operations are copies (no transcoding)
- [x] #2 Copy operations display the format, e.g. 'Copy (FLAC): 5'
- [x] #3 Codec line is shown normally when there are transcode operations
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented in commit `2ce14ac`. Codec line hidden when all operations are copies. Copy count shows format (e.g., `Copy (FLAC): 5`). Quality line kept visible as it's still useful context.
<!-- SECTION:FINAL_SUMMARY:END -->
