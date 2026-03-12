---
id: TASK-126
title: Implement chapter/audiobook CRUD operations
status: To Do
assignee: []
created_date: '2026-03-12 10:56'
labels:
  - phase-8
  - chapters
milestone: ipod-db Extended API
dependencies:
  - TASK-121
references:
  - doc-003
documentation:
  - tools/libgpod-macos/build/libgpod-0.8.3/src/itdb_chapterdata.c
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add full chapter data support to @podkit/ipod-db by parsing MHOD type 17 (M4A atom structure) and implementing all 4 CRUD methods.

**Prerequisite:** In M1, chapter data (MHOD type 17) is preserved as an opaque buffer. This task replaces it with full parsing and manipulation.

**Chapter data format (MHOD type 17):**
Uses M4A-style atom structure (NOT the standard iTunesDB binary format):
- Each atom: 4-byte length (big-endian) + 4-byte tag + data
- Top-level "sean" atom contains:
  - "chap" atoms (one per chapter), each containing:
    - "name" child atom with UTF-16BE chapter title
    - Timestamp data (chapter start time)
  - Trailing "hedr" atom

**4 methods to implement:**
1. `getTrackChapters(handle)` — Parse atom tree, return array of Chapter objects
2. `setTrackChapters(handle, chapters)` — Replace all chapters (build atom tree from Chapter array)
3. `addTrackChapter(handle, chapter)` — Append a chapter
4. `clearTrackChapters(handle)` — Remove all chapters (create empty chapterdata — behavioral deviation #4, NOT null)

**Types:**
```typescript
interface Chapter {
  title: string;
  startTime: number; // milliseconds
}
```

**Behavioral deviation #4:** `clearTrackChapters` must create an empty chapterdata structure rather than setting to null. libgpod's `itdb_chapterdata_free()` crashes on NULL. Our implementation handles this correctly by design.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 M4A atom parser correctly reads sean/chap/name/hedr atoms
- [ ] #2 All 4 chapter methods implemented
- [ ] #3 Chapter titles decoded from UTF-16BE
- [ ] #4 clearTrackChapters creates empty chapterdata (not null)
- [ ] #5 Chapters golden fixture round-trips correctly
- [ ] #6 Existing chapters.integration.test.ts passes with full assertions
- [ ] #7 Unit tests cover empty chapters, single chapter, many chapters
<!-- AC:END -->
