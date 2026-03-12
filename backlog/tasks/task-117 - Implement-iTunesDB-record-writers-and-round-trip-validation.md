---
id: TASK-117
title: Implement iTunesDB record writers and round-trip validation
status: To Do
assignee: []
created_date: '2026-03-12 10:53'
labels:
  - phase-2
  - writer
milestone: ipod-db Core (libgpod replacement)
dependencies:
  - TASK-116
references:
  - doc-003
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement write functions for all iTunesDB record types using BufferWriter. Each record module gets a `writeXxx(writer, record)` function alongside its `parseXxx`.

**Write path requirements:**

1. **Size backpatching:** Write header_len and total_len as placeholders (0), write content, then patch with actual sizes using `writer.patchUInt32()`.

2. **MHSD section ordering:** Must match libgpod's order exactly:
   Type 1 (Tracks) → Type 3 (Podcasts) → Type 2 (Playlists) → Type 4 (Albums) → Type 8 (Artists) → Type 6 (Reserved) → Type 10 (Reserved) → Type 5 (Smart Playlists) → Type 9 (Genius CUID, optional)

3. **Track ID reassignment:** Before writing, renumber all track IDs starting from 52 (FIRST_IPOD_ID), matching libgpod behavior.

4. **MHOD ordering within tracks:** Fixed order matching libgpod: Title, Artist, Album, Filetype, Comment, Path, Genre, Category, Composer, Grouping, Description, Subtitle, TVShow, TVEpisode, TVNetwork, AlbumArtist, Keywords, PodcastURL, PodcastRSS, SortArtist, SortTitle, SortAlbum, SortAlbumArtist, SortComposer, SortTVShow, then binary types.

5. **Unknown preservation:** Write back unknownHeaderBytes verbatim. Write back UnknownMhodRecords with their rawData.

6. **Atomic writes:** Write to temp file, then atomic rename.

7. **Database version:** Write version 0x30 (iTunes 9.2).

**Writer orchestration (`writer.ts`):** Top-level `writeDatabase(db: iTunesDatabase): Buffer` that writes MHBD and all children.

**Round-trip validation:** For every golden fixture:
```
original_bytes → parse → write → parse again → compare structures
```
The two parsed structures must be semantically identical.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All 11 record types have write functions
- [ ] #2 Size backpatching produces correct header_len and total_len values
- [ ] #3 MHSD sections written in correct order matching libgpod
- [ ] #4 Track IDs renumbered starting from 52 before write
- [ ] #5 MHOD records within tracks written in documented order
- [ ] #6 Unknown header bytes preserved through round-trip
- [ ] #7 Unknown MHOD types preserved through round-trip
- [ ] #8 Round-trip test passes for all 10 golden fixtures: parse(write(parse(fixture))) === parse(fixture)
- [ ] #9 Atomic write: writes to temp file then renames
<!-- AC:END -->
