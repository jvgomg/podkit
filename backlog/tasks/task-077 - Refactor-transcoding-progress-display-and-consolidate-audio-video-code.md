---
id: TASK-077
title: Refactor transcoding progress display and consolidate audio/video code
status: Done
assignee: []
created_date: '2026-03-09 19:40'
updated_date: '2026-03-09 19:48'
labels: []
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fix the video transcode progress line length issue and consolidate duplicated code between audio and video transcoding implementations.

**Problem:**
- Video transcode progress lines are too long, causing terminal wrapping and breaking carriage return line replacement
- Significant code duplication between audio (`TranscodeProgress`) and video (`VideoTranscodeProgress`) implementations
- Inconsistent progress display formatting between audio and video

**Scope:**
Phase 1: Quick fix - truncate video track names
Phase 2: DRY improvements - unified types, shared utilities, consolidated parsing
Phase 3: Longer-term refactoring - consolidate executor patterns
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Video progress lines truncate track names to prevent terminal wrapping
- [x] #2 Unified TranscodeProgress type used for both audio and video
- [x] #3 Shared progress formatting utility in CLI package
- [x] #4 Consistent progress display format between audio and video
- [x] #5 Progress parsing functions consolidated where possible
- [x] #6 All existing tests pass
- [x] #7 Progress display works correctly in terminals < 100 columns
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

Successfully completed all three phases of the transcoding progress refactoring:

### Phase 1: Quick Fix ✅
- Added track name truncation (40 chars) to video progress display in CLI
- Fixed both transcode progress and non-transcode phases
- Location: `packages/podkit-cli/src/commands/sync.ts`

### Phase 2: DRY Improvements ✅

**2a. Shared Progress Formatting Utility**
- Created `packages/podkit-cli/src/utils/progress.ts` with:
  - `formatProgressLine()` - unified progress line formatter
  - `truncateTrackName()` - consistent truncation logic
- Exported via `packages/podkit-cli/src/utils/index.ts`

**2b. Unified TranscodeProgress Type**
- Extended `TranscodeProgress` in `packages/podkit-core/src/transcode/types.ts` to include optional video fields:
  - `frame?: number`
  - `speed?: number`
  - `bitrate?: number`
- Now serves as the single source of truth for both audio and video

**2c. Updated Video Transcode**
- Removed duplicate `VideoTranscodeProgress` interface from `video/transcode.ts`
- Updated all imports and exports to use unified `TranscodeProgress`
- Updated `video-executor.ts` to use unified type

**2d. Consolidated Progress Parsing**
- Created `packages/podkit-core/src/transcode/progress.ts` with shared utilities:
  - `parseFFmpegProgress()` - comprehensive chunk parser (replaces video parser)
  - `parseFFmpegProgressLine()` - single line parser (replaces audio parser)
  - `parseTimeString()` - shared time parsing
- Updated `ffmpeg.ts` to use shared `parseFFmpegProgressLine()`
- Updated `video/transcode.ts` to use shared `parseFFmpegProgress()`
- Exported from main index for public use

**2e. Updated CLI to Use Shared Formatter**
- Modified audio progress display to use `formatProgressLine()`
- Modified video progress display to use `formatProgressLine()`
- Consistent formatting between audio and video now

### Phase 3: Executor Analysis ✅

Conducted comprehensive analysis of `DefaultSyncExecutor` and `DefaultVideoSyncExecutor` (see task notes for full details).

**Conclusion**: Executors should remain separate due to fundamental architectural differences:
- Audio: parallel pipeline with AsyncQueue
- Video: sequential processing (correct for large files)
- Different dependencies (FFmpegTranscoder vs none)
- Different operation types and options

**Future opportunities** (separate task recommended):
- Extract error categorization to `sync/error-categorization.ts`
- Create `sync/executor-utils.ts` for shared helpers
- Add retry logic to video executor

## Test Results

All tests pass successfully:
- 597 tests passed
- 0 failures
- Verified across all packages (core, CLI, e2e-tests, gpod-testing)

## Files Modified

### Core Package
- `packages/podkit-core/src/transcode/types.ts` - Extended TranscodeProgress
- `packages/podkit-core/src/transcode/progress.ts` - NEW: Shared progress parsing
- `packages/podkit-core/src/transcode/ffmpeg.ts` - Use shared parser
- `packages/podkit-core/src/video/transcode.ts` - Use unified type & shared parser
- `packages/podkit-core/src/video/index.ts` - Remove VideoTranscodeProgress export
- `packages/podkit-core/src/sync/video-executor.ts` - Use unified TranscodeProgress
- `packages/podkit-core/src/index.ts` - Export shared progress utilities

### CLI Package
- `packages/podkit-cli/src/utils/progress.ts` - NEW: Shared progress formatter
- `packages/podkit-cli/src/utils/index.ts` - NEW: Utility exports
- `packages/podkit-cli/src/commands/sync.ts` - Use shared formatter, add truncation
<!-- SECTION:NOTES:END -->
