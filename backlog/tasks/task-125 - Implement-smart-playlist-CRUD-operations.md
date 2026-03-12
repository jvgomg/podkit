---
id: TASK-125
title: Implement smart playlist CRUD operations
status: To Do
assignee: []
created_date: '2026-03-12 10:56'
labels:
  - phase-7
  - smart-playlists
milestone: ipod-db Extended API
dependencies:
  - TASK-121
references:
  - doc-003
documentation:
  - tools/libgpod-macos/build/libgpod-0.8.3/src/itdb_itunesdb.c
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add full smart playlist support to @podkit/ipod-db by parsing the SLst big-endian block and implementing all 8 CRUD methods.

**Prerequisite:** In M1, smart playlist data (MHOD types 50 and 51) is preserved as opaque buffers during round-trip. This task replaces the opaque handling with full parsing and manipulation.

**SLst block parsing (MHOD type 51 — BIG-ENDIAN):**
The SLst block is the ONLY big-endian section in the entire iTunesDB. It contains:
- "SLst" header tag (4 bytes)
- unknown004 (uint32 BE)
- numrules (uint32 BE)
- match_operator (uint32 BE) — AND/OR/ANY
- 120 bytes padding
- Rules array, each rule containing:
  - field (uint32 BE) — ~30 queryable fields (title, artist, album, genre, rating, play count, etc.)
  - action (uint32 BE) — bit flags for match operators (contains, starts with, greater than, in range, etc.)
  - 52 bytes padding
  - For string rules: length (uint32 BE) + UTF-16BE string data
  - For numeric/date rules: 0x44 bytes of from/to values

**SPL Preferences (MHOD type 50):**
14 bytes structured data:
- liveupdate, checkrules, checklimits flags
- limittype enum, limitsort enum (with high-bit trick for reverse sort)
- limitvalue (uint32)
- matchcheckedonly, reverse_limit_sort flags

**Date handling:** Mac timestamps must be converted to/from Unix timestamps.

**limitsort encoding quirk:** High bit (0x80000000) indicates "opposite" sort direction. Extracted and stored separately in SPL preferences byte 13.

**8 methods to implement:**
1. `createSmartPlaylist(name, preferences)` — Create with initial preferences
2. `getSmartPlaylistRules(playlistId)` — Parse SLst block, return rule objects
3. `addSmartPlaylistRule(playlistId, rule)` — Add rule to SLst block
4. `removeSmartPlaylistRule(playlistId, ruleIndex)` — Remove by index
5. `clearSmartPlaylistRules(playlistId)` — Remove all rules
6. `setSmartPlaylistPreferences(playlistId, prefs)` — Update preferences
7. `getSmartPlaylistPreferences(playlistId)` — Read preferences
8. `evaluateSmartPlaylist(playlistId)` — Evaluate rules against track list, return matching tracks

**Types to define:**
- SPLField enum (~30 values: title, artist, album, genre, rating, playcount, etc.)
- SPLAction enum (~20 values: contains, startsWith, greaterThan, inRange, etc.)
- SPLRule interface
- SPLPreferences interface
- SPLLimitType, SPLLimitSort enums
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 SLst big-endian block parsed correctly with all field types
- [ ] #2 All 8 smart playlist methods implemented
- [ ] #3 SPL preferences parsed including limitsort high-bit trick
- [ ] #4 Date values converted between Mac and Unix timestamps
- [ ] #5 String rules handle UTF-16BE encoding
- [ ] #6 Smart playlist golden fixtures round-trip correctly
- [ ] #7 evaluateSmartPlaylist correctly filters tracks against rules
- [ ] #8 Existing smart-playlists.integration.test.ts passes with full assertions (not just opaque preservation)
- [ ] #9 Unit tests cover all SPL field types and action types
<!-- AC:END -->
