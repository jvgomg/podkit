---
id: TASK-026
title: Implement skip-and-continue error handling
status: Done
assignee: []
created_date: '2026-02-22 19:38'
updated_date: '2026-02-23 01:55'
labels: []
milestone: 'M3: Production Ready (v1.0.0)'
dependencies:
  - TASK-021
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement robust error handling that doesn't stop sync on individual failures.

**Behavior:**
- If a track fails (transcode error, copy error, etc.), skip it and continue
- Collect all errors during sync
- Report summary at end: "Synced 95/100 tracks, 5 failures"
- Log detailed error info for debugging

**Optional enhancement:**
- `podkit sync --retry-failed` to retry just the failed tracks from last sync
- Store failed track list in temp file

**Testing requirements:**
- Test with intentionally bad files mixed in
- Verify good files still sync
- Verify error summary is accurate
- Test error logging
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Failed tracks skipped, sync continues
- [x] #2 Errors collected and reported at end
- [x] #3 Detailed error logging available
- [x] #4 Tests with mixed good/bad files
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary (2026-02-23)

### Changes Made

**packages/podkit-core/src/sync/executor.ts:**
- Added `ErrorCategory` type: 'transcode' | 'copy' | 'database' | 'artwork' | 'unknown'
- Added `CategorizedError` interface with error details, category, trackName, retryAttempts, wasRetried
- Added `RetryConfig` interface and `DEFAULT_RETRY_CONFIG` with:
  - transcodeRetries: 1 (retry once for transient FFmpeg failures)
  - copyRetries: 1 (retry once for transient I/O failures)
  - databaseRetries: 0 (no retry, likely persistent)
  - retryDelayMs: 1000
- Updated `ExecutorProgress` to include `categorizedError` and `retryAttempt`
- Updated `ExecuteResult` to include `categorizedErrors` array
- Added `categorizeError()` function that checks error message keywords first, then falls back to operation type
- Added `getRetriesForCategory()` and `createCategorizedError()` helpers
- Updated `execute()` method to implement retry logic per operation type

**packages/podkit-core/src/index.ts:**
- Exported new types and functions: ErrorCategory, CategorizedError, RetryConfig, categorizeError, createCategorizedError, getRetriesForCategory, DEFAULT_RETRY_CONFIG

**packages/podkit-cli/src/commands/sync.ts:**
- Added `CollectedError` interface and `formatErrors()` function
- Verbosity-based error reporting:
  - 0 (normal): "5 tracks failed" summary only
  - 1 (-v): List failed track names with retry info
  - 2 (-vv): Show error category and message for each failure
  - 3 (-vvv): Full error details including stack traces
- Updated sync execution to collect categorized errors
- Enhanced JSON output to include `errors` array with full error info

**packages/podkit-core/src/sync/executor.test.ts:**
- Added tests for `categorizeError()` function
- Added tests for `getRetriesForCategory()` function
- Added retry logic tests:
  - Retry transcode once on transient failure then succeed
  - Retry transcode once on permanent failure
  - Retry copy once on file I/O failure
  - Do NOT retry database errors
  - Track retry attempts in progress events
  - Respect custom retry configuration
- Added test for `executePlan` collecting categorized errors

## Code Review (2026-02-23)

### Verification Results

- **TypeScript typecheck**: PASSED (all 7 tasks successful)
- **Linting**: PASSED (0 warnings, 0 errors)
- **Unit tests**: PASSED (508 tests across 14 files)

### User Requirements Verification

#### 1. Verbosity levels (-v, -vv, -vvv) respected for error output
**VERIFIED** in `/packages/podkit-cli/src/commands/sync.ts` (lines 206-265):
- Level 0 (normal): Summary only ("5 tracks failed")
- Level 1 (-v): List failed track names with retry info
- Level 2 (-vv): Show error category and message for each failure
- Level 3 (-vvv): Full error details including stack traces

#### 2. Retry once for transcode/copy, NO retry for database/artwork
**VERIFIED** in `/packages/podkit-core/src/sync/executor.ts`:
- `DEFAULT_RETRY_CONFIG` (lines 102-107):
  - `transcodeRetries: 1` (retry once)
  - `copyRetries: 1` (retry once)
  - `databaseRetries: 0` (no retry)
- `getRetriesForCategory()` (lines 268-284): Returns 0 for artwork and unknown errors
- Tests verify this behavior (lines 1051-1276)

#### 3. Skip and continue on failure
**VERIFIED** in `/packages/podkit-core/src/sync/executor.ts`:
- `continueOnError` option (line 114) controls behavior
- When true, errors are collected and execution continues (lines 508-512)
- CLI always uses `continueOnError: true` (line 772 in sync.ts)

#### 4. Summary at end with collected errors
**VERIFIED** in `/packages/podkit-cli/src/commands/sync.ts`:
- `collectedErrors` array tracks all failures (line 765)
- Summary shows "Synced X/Y tracks (Z failed)" (lines 862-866)
- JSON output includes full `errors` array (lines 820-854)

### Code Quality Notes

- Error categorization is well-designed with clear priority (specific keywords > operation type fallback)
- Retry logic correctly uses retry delay between attempts
- Tests cover all retry scenarios including success-after-retry and permanent failure
- CLI properly integrates with verbosity levels from global options

### Implementation is complete and correct. All acceptance criteria met.
<!-- SECTION:NOTES:END -->
