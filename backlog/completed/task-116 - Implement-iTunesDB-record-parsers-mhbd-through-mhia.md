---
id: TASK-116
title: Implement iTunesDB record parsers (mhbd through mhia)
status: Done
assignee: []
created_date: '2026-03-12 10:53'
updated_date: '2026-04-03 20:42'
labels:
  - phase-1
  - parser
milestone: ipod-db Core (libgpod replacement)
dependencies:
  - TASK-115
references:
  - doc-003
documentation:
  - tools/libgpod-macos/build/libgpod-0.8.3/src/itdb_itunesdb.c
  - tools/libgpod-macos/build/libgpod-0.8.3/src/db-itunes-parser.h
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement parse functions for all iTunesDB record types using BufferReader. Each record type gets its own module in `src/itunesdb/records/`.

**Records to implement (in dependency order):**

1. **mhod.ts** — Metadata object (most complex, many subtypes):
   - String MHODs (types 1-6, 8-9, 12-14, 18-24, 27-31, 200-202, 300): UTF-16LE/BE strings with encoding detection
   - Podcast URLs (types 15-16): UTF-8, NO length prefix (length = total_len - header_len)
   - Chapter data (type 17): Preserve as opaque Buffer (parsed in M2)
   - SPL preferences (type 50): Preserve as opaque Buffer (parsed in M2)
   - SPL rules (type 51): Preserve as opaque Buffer — note this is BIG-ENDIAN
   - Playlist index (types 52-53): Preserve as opaque Buffer
   - Playlist position (type 100): uint32 value
   - Unknown types: Preserve as `UnknownMhodRecord { type, rawData: Buffer }`

2. **mhit.ts** — Track item:
   - Variable header size (0x9c to 0x184+ bytes depending on version)
   - 40+ known fields: trackId, visible, filetype, type, compilation, rating, dateAdded, size, length, trackNumber, year, bitrate, sampleRate, volume, startTime, stopTime, playCount, skipCount, dbid, dbid2, mhii_link, etc.
   - `unknownHeaderBytes: Buffer` for bytes between last known field and header_len
   - Child MHODs parsed from remaining bytes up to total_len

3. **mhlt.ts** — Track list: header + child MHITs
4. **mhip.ts** — Playlist item: trackId reference + child MHODs
5. **mhyp.ts** — Playlist: id, name (from child MHOD), type, child MHIPs
6. **mhlp.ts** — Playlist list: header + child MHYPs
7. **mhla.ts** — Album list: header + child MHBAs
8. **mhba.ts** — Album entry: album metadata + child MHODs + MHIAs
9. **mhia.ts** — Image album item
10. **mhsd.ts** — Section descriptor: type field (1-10) determines child list type
11. **mhbd.ts** — Database header: version, platform, language, db_id, hashing_scheme, hash58/72/AB fields, child MHSDs

**Auto-detect endianness:** When parsing MHBD, check if tag reads as "mhbd". If not, retry with reversed byte order.

**Types file (`types.ts`):** TypeScript interfaces for every record type, including the `unknownHeaderBytes` preservation field.

**Parser orchestration (`parser.ts`):** Top-level `parseDatabase(buffer: Buffer): iTunesDatabase` that reads MHBD and all children.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All 11 record types have parse functions
- [x] #2 MHOD parser handles all 32+ known string types correctly
- [x] #3 Unknown MHOD types preserved as opaque UnknownMhodRecord
- [x] #4 MHIT parser reads all known fields up to 0x184 header size
- [x] #5 unknownHeaderBytes preserved for every record type
- [x] #6 Endianness auto-detected from MHBD header
- [x] #7 Podcast URL MHODs (types 15-16) parsed as UTF-8 without length prefix
- [x] #8 SPL and chapter MHODs preserved as opaque buffers
- [x] #9 Each golden fixture (TASK-113) parses without errors
- [x] #10 Parsed structure matches expected.json snapshot for each fixture
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
All 11 record types implemented. 35+ MHOD types handled (string, UTF-8 podcast URLs, position, opaque). MHIT reads 40+ fields across three header size tiers. Discovered libgpod uses "mhia" tags for album entries in iTunesDB (not "mhba") — parser accepts both. Prefers mhsd type 3 over type 2 for playlists (matches libgpod). Unknown header bytes preserved. All 7 golden fixtures parse correctly with full metadata validation. 32 tests.
<!-- SECTION:NOTES:END -->
