---
id: TASK-034
title: Implement podkit list command
status: Done
assignee: []
created_date: '2026-02-22 22:16'
updated_date: '2026-02-23 12:17'
labels: []
milestone: 'M2: Core Sync (v0.2.0)'
dependencies:
  - TASK-006
  - TASK-009
  - TASK-015
  - TASK-032
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the `podkit list` command that lists tracks on iPod or in a collection.

**Default behavior (no options):**
- Lists tracks from connected iPod
- Uses `--device` global option or auto-detects

**Options:**
- `--source <path>` - list from collection directory instead of iPod
- `--format <fmt>` - output format: table (default), json, csv
- `--fields <list>` - comma-separated fields to show (title, artist, album, duration, etc.)

**Output formats:**
- `table` - human-readable columns
- `json` - array of track objects
- `csv` - comma-separated with header row

**Example output (table):**
```
Title                Artist              Album               Duration
────────────────────────────────────────────────────────────────────────
Bohemian Rhapsody    Queen               A Night at...       5:55
Another One...       Queen               The Game            3:36
```

**Dependencies:**
- Needs libgpod-node for reading iPod tracks
- Needs collection adapter for reading source directory
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Lists tracks from iPod by default
- [x] #2 Lists tracks from --source directory
- [x] #3 Table format is readable and aligned
- [x] #4 JSON format outputs valid JSON array
- [x] #5 CSV format includes header row
- [x] #6 --fields filters displayed columns
- [x] #7 Global --device option is respected
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

Implemented the `podkit list` command with full functionality:

### Features
- **Default behavior**: Lists tracks from connected iPod using libgpod-node
- **Source mode**: `--source <path>` lists tracks from a collection directory
- **Output formats**: `--format table|json|csv` with table as default
- **Field filtering**: `--fields title,artist,album,duration,...` to select columns

### Output Formats
- **Table**: Human-readable columns with proper alignment, Unicode separator, truncation with ellipsis
- **JSON**: Array of track objects with both raw duration (ms) and formatted duration
- **CSV**: Comma-separated with header row and proper escaping

### Available Fields
title, artist, album, duration, albumArtist, genre, year, trackNumber, discNumber, filePath

### Error Handling
- No iPod device specified
- iPod not found at path
- Source directory not found
- Graceful JSON error output when --json flag is used

### Files Modified
- `/packages/podkit-cli/src/commands/list.ts` - Full implementation
- `/packages/podkit-cli/src/commands/list.test.ts` - Unit tests (56 tests)

### Verification
- typecheck: PASS
- lint: PASS
- test:unit: PASS (388 tests)

## Review (2026-02-23)

Reviewed implementation and tests. All acceptance criteria met:

1. **Lists from iPod by default**: Uses `loadIpodTracks()` with `@podkit/libgpod-node`, respects `--device` global option
2. **Lists from --source**: Uses `loadSourceTracks()` with `@podkit/core` directory adapter
3. **Output formats work**: All three formats (table/json/csv) implemented with proper formatting
4. **Field filtering works**: `parseFields()` handles comma-separated, case-insensitive field selection

**Verification:**
- typecheck: PASS
- lint: PASS (0 warnings, 0 errors)
- test:unit: PASS (388 tests)

**Test Coverage:**
56 tests in `list.test.ts` covering:
- Duration formatting edge cases
- String truncation
- Field value extraction
- Field parsing (case-insensitive, whitespace handling)
- Column width calculation
- Table, JSON, and CSV formatting
- CSV escaping for special characters

**Code Quality:**
- Clean separation of concerns (formatting functions, loaders, command)
- Proper error handling with JSON-aware error output
- Dynamic imports to avoid loading unused dependencies
- Well-documented with TypeScript types
<!-- SECTION:NOTES:END -->
