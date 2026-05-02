---
id: TASK-063
title: Fix scan output formatting ("tracks in source4 files")
status: Done
assignee: []
created_date: '2026-02-26 14:26'
updated_date: '2026-03-04 21:35'
labels:
  - bug
  - cli
  - cosmetic
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Bug

Sync output shows malformed text:
```
Found 1,414 tracks in source4 files
```

Should probably be:
```
Found 1,414 tracks in source
```
or:
```
Found 1,414 tracks (1,414 files)
```

## Cause

Likely a missing newline or string concatenation issue in the sync command output. The "4 files" appears to be remnant text from another message.

## Location

`packages/podkit-cli/src/commands/sync.ts` — look for the "Found X tracks" output line.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Scan output displays correctly
- [x] #2 No remnant text in output
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Root Cause

The `Spinner` class in `sync.ts` used `\r` (carriage return) to return to the beginning of the line, but didn't clear the remaining characters. When a shorter message replaced a longer one, leftover characters remained visible.

For example:
- Spinner showed: `| Parsing metadata: 1414/1414 files` (37 chars)
- Stop message: `Found 1,414 tracks in source` (28 chars)
- Result: `Found 1,414 tracks in source4 files` (leftover `4 files` visible)

## Fix

Added ANSI escape sequence `\x1b[K` (clear from cursor to end of line) in three places:

1. `Spinner.start()` - Clears line when updating spinner animation
2. `Spinner.stop()` - Clears line when displaying final message
3. Progress bar rendering during sync execution - Replaced space padding workaround with proper escape sequence

## Files Changed

- `packages/podkit-cli/src/commands/sync.ts`
<!-- SECTION:FINAL_SUMMARY:END -->
