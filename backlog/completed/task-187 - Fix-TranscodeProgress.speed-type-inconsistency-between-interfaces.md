---
id: TASK-187
title: Fix TranscodeProgress.speed type inconsistency between interfaces
status: Done
assignee: []
created_date: '2026-03-22 21:03'
updated_date: '2026-03-22 21:21'
labels:
  - tech-debt
  - cleanup
dependencies: []
references:
  - packages/podkit-core/src/sync/content-type.ts
  - packages/podkit-core/src/sync/executor.ts
  - packages/podkit-core/src/transcode/types.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`TranscodeProgress.speed` is `number` but `OperationProgress.transcodeProgress.speed` is `string`. This causes unnecessary string-to-number round-trips in `VideoHandler.executeTranscode` and `buildExecutorProgress` in `executor.ts`.

## Context

Identified during TASK-186.20 code review (2026-03-22) and deferred because changing the type would require updating tests and all conversion callsites. The current string→number round-trip works correctly, so this is a quality-of-life improvement, not a bug fix.

## What to do

1. Decide which type is canonical (`number` or `string`) — likely `number` since it represents a speed multiplier
2. Update `OperationProgress.transcodeProgress.speed` in `content-type.ts` to match
3. Remove string↔number conversions in VideoHandler.executeTranscode and buildExecutorProgress
4. Update any tests that assert on the string form
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 TranscodeProgress.speed and OperationProgress.transcodeProgress.speed use the same type
- [x] #2 No unnecessary string↔number conversions in executor or handler code
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Changed `OperationProgress.transcodeProgress.speed` from `string` to `number` to match `TranscodeProgress.speed`. Removed 3 unnecessary conversions (2x `String()`, 1x `parseFloat()`) in video-handler.ts, music-handler.ts, and executor.ts. Updated 3 test assertions. Build and all 1945 tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
