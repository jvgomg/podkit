---
id: TASK-188
title: Consolidate duplicate utility functions across music and video executors
status: Done
assignee: []
created_date: '2026-03-22 21:03'
updated_date: '2026-03-22 21:21'
labels:
  - tech-debt
  - refactor
dependencies: []
references:
  - packages/podkit-core/src/sync/music-executor.ts
  - packages/podkit-core/src/sync/video-executor.ts
  - packages/podkit-core/src/sync/error-handling.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Several utility functions are duplicated between music and video execution paths:

1. **Display name functions**: `getMusicOperationDisplayName()` (music-executor.ts) vs `getVideoOperationDisplayName()` (video-executor.ts) — parallel implementations that format operation descriptions for CLI output
2. **Size/time estimation**: Parallel estimation logic in music-planner.ts and video-planner.ts
3. **Error handling**: Duplicate error categorization between music-executor.ts and error-handling.ts

## Context

Identified during TASK-186.14 (naming symmetry) and deferred because DRY consolidation wasn't part of the rename scope. Now that both music and video flow through the ContentTypeHandler pattern, these utilities could be consolidated into handler methods or shared helpers.

## What to do

Evaluate each duplication and consolidate where the handler pattern makes it natural:
- Display name → could become a required `getDisplayName()` method on ContentTypeHandler (already exists)
- Estimation → could be handler methods that the planner calls
- Error handling → already partially consolidated in error-handling.ts; finish the job
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Duplicate display name functions consolidated or justified
- [x] #2 Duplicate error handling consolidated into error-handling.ts
- [x] #3 No unnecessary parallel implementations between music and video paths
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Closed: No action needed

Investigation found no true duplication — all apparent duplicates are intentionally different:

- **Display names**: Music (`Artist - Title`) vs Video (`Show - S01E02`) — different formats by design
- **Error handling**: Already consolidated in `error-handling.ts`; music-executor wrappers are thin adapters for legacy config naming (`transcodeRetries` vs `transcode`)
- **Size estimation**: Different signatures — audio uses single bitrate, video uses video+audio bitrate. Already sharing `estimateTransferTime()` utility.

The ContentTypeHandler interface correctly abstracts these differences. No consolidation warranted.
<!-- SECTION:FINAL_SUMMARY:END -->
