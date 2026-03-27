---
id: TASK-248.07
title: TranscodePresetRef and executor generalization
status: To Do
assignee: []
created_date: '2026-03-27 10:42'
labels:
  - feature
  - transcoding
dependencies:
  - TASK-248.03
  - TASK-248.06
documentation:
  - doc-024
parent_task_id: TASK-248
priority: high
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add `targetCodec` to `TranscodePresetRef` and update all hardcoded AAC assumptions in the executor and mass-storage adapter.

See PRD: doc-024, sections "TranscodePresetRef codec field," "Executor generalization," and "Mass-storage adapter: codec change rename."

**TranscodePresetRef:** Add `targetCodec` field so every pipeline stage knows the resolved codec. Replaces implicit AAC/ALAC inference from preset name.

**Executor updates (6+ hardcoded locations):**
- Two `prepareTranscode()` call sites: replace `.m4a` output path with codec-derived extension
- Temp file path in pipeline.ts: also hardcodes `.m4a`
- Two filetype string locations: replace `'AAC audio file'` with codec-derived label
- `getFileTypeLabel()`: for transcodes, derive from target codec; for copies, derive from source extension. Add `.opus`, `.flac` cases.
- `getOptimizedCopyFormat()`: widen return type

**Mass-storage `replaceTrackFile()` codec-change rename — this is the primary risk:**
1. Allocate new path with correct extension
2. Copy file to new path
3. Delete old file
4. Update `allocatedPaths`, `managedFiles`, track `filePath`, `pendingCommentWrites`

This changes the method's contract from "replace in-place" to "replace with possible relocation."
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `TranscodePresetRef` has a `targetCodec` field
- [ ] #2 All `prepareTranscode()` call sites use codec-derived extension instead of `.m4a`
- [ ] #3 Temp file path construction uses codec-derived extension
- [ ] #4 Filetype strings use codec-derived labels from metadata table instead of hardcoded `'AAC audio file'`
- [ ] #5 `getFileTypeLabel()` returns correct label for `.opus`, `.flac` extensions and derives from target codec for transcodes
- [ ] #6 `getOptimizedCopyFormat()` return type includes opus and flac
- [ ] #7 Mass-storage `replaceTrackFile()` handles codec-change renames: new path with correct extension, old file removed, allocatedPaths/managedFiles/filePath/pendingCommentWrites updated
- [ ] #8 Manifest and playlist references remain correct after codec-change rename
- [ ] #9 Existing test expectations updated for new extension/filetype behavior
- [ ] #10 Integration test: codec-change rename on mass-storage produces correct file path and cleans up old file
<!-- AC:END -->
