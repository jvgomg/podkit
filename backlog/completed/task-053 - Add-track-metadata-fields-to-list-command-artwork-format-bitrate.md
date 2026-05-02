---
id: TASK-053
title: 'Add track metadata fields to list command (artwork, format, bitrate)'
status: Done
assignee: []
created_date: '2026-02-26 00:16'
updated_date: '2026-02-26 11:54'
labels:
  - cli
  - list
  - verification
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Enhance `podkit list` to show additional track metadata for verification after sync.

**Current state:**
- `podkit list` shows: title, artist, album, duration
- Available fields include: albumArtist, genre, year, trackNumber, discNumber, filePath

**Needed fields:**
1. **artwork** - boolean/indicator showing if track has artwork
2. **format** - audio format (AAC, MP3, ALAC, etc.)
3. **bitrate** - audio bitrate in kbps

**Usage:**
```bash
podkit list --fields title,artist,artwork,format,bitrate
```

**Implementation notes:**
- For iPod tracks: read from iTunesDB metadata (format/bitrate stored there)
- For source tracks: may need to read from file metadata
- Artwork indicator could be ✓/✗ or "yes"/"no" for table format
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 --fields supports artwork indicator
- [x] #2 --fields supports format (AAC, MP3, etc.)
- [x] #3 --fields supports bitrate
- [x] #4 Works for both iPod and source collection listing
- [x] #5 JSON output includes these fields when requested
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added artwork, format, and bitrate fields to the list command:

## Architecture

**Core utility** (`packages/podkit-core/src/metadata/extractor.ts`):
- `getFileDisplayMetadata(filePath)` - Extract metadata from single file
- `getFilesDisplayMetadata(filePaths)` - Extract metadata from multiple files in parallel
- Returns `FileDisplayMetadata { hasArtwork: boolean, bitrate: number | undefined }`
- Uses music-metadata library (kept only in core)
- Exported from `@podkit/core`

**CLI** uses the core utility - no direct music-metadata dependency.

## Changes Made

### Core: New metadata extractor (metadata/extractor.ts)
- `getFileDisplayMetadata()` - Extracts artwork presence and bitrate in single pass
- `getFilesDisplayMetadata()` - Batch extraction for multiple files
- Exported from core index.ts

### CLI: DisplayTrack Interface (list.ts:11-25)
- Added `artwork?: boolean` - indicates if track has artwork
- Added `format?: string` - audio format (AAC, MP3, FLAC, etc.)
- Added `bitrate?: number` - bitrate in kbps

### CLI: Field Definitions (list.ts:27-77)
- Added to AVAILABLE_FIELDS array
- Added headers: 'Art', 'Format', 'Bitrate'
- Added column widths: 3, 8, 7 characters respectively

### CLI: Field Value Formatting (list.ts:108-137)
- artwork: displays ✓ (has artwork), ✗ (no artwork), or - (undefined)
- format: displays format string
- bitrate: displays numeric value (kbps)

### CLI: iPod Track Loading (list.ts:297-343)
- `parseFormat()` helper extracts format from filetype string
- Maps `hasArtwork`, `filetype`, `bitrate` from iPod database

### CLI: Source Track Loading (list.ts:382-420)
- Uses `getFilesDisplayMetadata()` from core for parallel extraction
- Returns artwork (true/false) and bitrate for all source tracks

## Testing

```bash
podkit list --source test/fixtures/audio --fields title,artwork,format,bitrate
```

**Output:**
```
Title            Art  Format  Bitrate
─────────────────────────────────────
Harmony          ✓    FLAC    393    
Vibrato          ✓    FLAC    395    
Tremolo          ✓    FLAC    378    
A440 Reference   ✓    FLAC    96     
Frequency Sweep  ✓    FLAC    510    
Dual Tone        ✗    FLAC    150    
```

**JSON output includes all fields:**
- `"artwork": true/false`
- `"format": "FLAC"`
- `"bitrate": 393`

## Integration with TASK-057

Complete workflow now available:
1. `podkit list --source ~/Music --fields title,artwork,bitrate` - View source files
2. `podkit sync` - Transfer tracks with artwork
3. `podkit list --fields title,artwork,format,bitrate` - Verify on iPod
<!-- SECTION:NOTES:END -->
