---
id: TASK-038
title: Optimize artwork transfer with application-level deduplication
status: To Do
assignee: []
created_date: '2026-02-23 12:28'
labels:
  - optimization
  - artwork
dependencies:
  - TASK-037
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement application-level artwork deduplication in podkit to reduce redundant extraction and temp file overhead before artwork reaches libgpod.

## Background

While libgpod handles deduplication at the iPod storage level (verified in TASK-037), podkit currently:
1. Extracts artwork from every track individually
2. Creates a temp file for each track's artwork
3. Calls `setTrackArtwork()` for each track

This means for an album of 10 tracks with identical artwork, we:
- Extract the same image 10 times
- Create 10 identical temp files
- Make 10 libgpod calls (though libgpod dedupes internally)

## Proposed Optimization

Group tracks by album during sync planning and extract artwork once per unique album:

### Phase 1: Artwork Grouping in Sync Plan
- During diff calculation, group tracks by album
- For each album group, designate one track as the "artwork source"
- Store artwork reference in sync plan metadata

### Phase 2: Single Extraction per Album
- Extract artwork once per album (from the designated source track)
- Store in temp file with album-based naming
- Reuse the same temp file path for all tracks in the album

### Phase 3: Batch Artwork Application
- After tracks are added to iPod, apply artwork in batches by album
- All tracks in an album reference the same temp file
- libgpod's internal deduplication handles the rest

## Implementation Approach

```typescript
interface AlbumArtworkGroup {
  albumKey: string;  // `${artist}/${album}` or similar
  sourceTrackPath: string;  // Track to extract artwork from
  tempArtworkPath?: string;  // Set after extraction
  trackIds: number[];  // iPod track IDs to apply artwork to
}
```

### Key Functions to Modify
- `packages/podkit-core/src/sync/planner.ts` - Group by album in plan
- `packages/podkit-core/src/artwork/extractor.ts` - Add album-aware extraction
- `packages/podkit-core/src/sync/executor.ts` - Batch artwork application

## Expected Benefits

| Metric | Before | After (10-track album) |
|--------|--------|------------------------|
| Extractions | 10 | 1 |
| Temp files | 10 | 1 |
| Disk I/O | 10x read + 10x write | 1x read + 1x write |
| Memory | 10x image in memory | 1x image in memory |

## Edge Cases to Handle
- Tracks without album metadata (use track path as fallback key)
- Albums with intentionally different per-track artwork (rare but valid)
- Partial syncs where some tracks already have artwork on iPod
- Mixed sources (some tracks from files, some from music player DB)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Artwork extraction happens once per unique album during sync
- [ ] #2 Temp file count reduced to one per album (not per track)
- [ ] #3 Sync of 10-track album with same artwork extracts artwork only once
- [ ] #4 Edge case: tracks without album metadata still work correctly
- [ ] #5 Edge case: albums with mixed artwork presence handled correctly
- [ ] #6 Performance improvement measurable in sync logs or metrics
- [ ] #7 Existing artwork transfer tests continue to pass
- [ ] #8 No regression in artwork quality or metadata
<!-- AC:END -->
