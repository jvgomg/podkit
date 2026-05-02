---
id: TASK-264
title: Read-only ArtworkDB parser and .ithmb thumbnail extractor
status: Done
assignee: []
created_date: '2026-04-03 19:45'
updated_date: '2026-04-03 20:48'
labels:
  - parser
  - artwork
milestone: m-17
dependencies:
  - TASK-115
references:
  - doc-003
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement a read-only parser for ArtworkDB and .ithmb files so the virtual iPod can display album artwork.

**ArtworkDB parser (`artworkdb/parser.ts`):**
- Parse the ArtworkDB binary file (same mh-record structure as iTunesDB but different record types)
- Extract artwork metadata: image IDs, dimensions, pixel format, byte offsets into .ithmb files
- Map artwork IDs to tracks via `mhii_link` field in track records

**ithmb extractor (`artworkdb/ithmb.ts`):**
- Read raw pixel data from .ithmb cache files at the offsets specified in ArtworkDB
- Decode pixel formats to standard RGBA for browser display: RGB565, RGB555, RGB888 (the most common ones)
- Return as `Uint8Array` or `ImageData`-compatible format that can be drawn to a Canvas or converted to a blob URL

**Scope limitations (read-only phase):**
- No writing ArtworkDB or .ithmb files
- No image resizing or format conversion for write
- UYVY and I420 pixel formats can be deferred (uncommon, video-related)
- Focus on the 2-3 artwork sizes most commonly used for album art display

**Browser compatibility:**
- Must work with `Uint8Array` (no Node.js Buffer dependency)
- Pixel format decoding should use typed arrays for performance
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ArtworkDB binary file parsed into structured metadata
- [x] #2 Artwork-to-track mapping resolved via mhii_link
- [x] #3 .ithmb raw pixel data extracted at correct offsets
- [x] #4 RGB565 and RGB555 pixel formats decoded to RGBA
- [x] #5 Works with Uint8Array (browser-compatible, no Node.js Buffer)
- [ ] #6 Artwork from golden fixtures (TASK-113) displays correctly
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
ArtworkDB parser handles mhfd, mhsd (16-bit type), mhli/mhii, mhod type 2/3, mhni, mhla/mhba/mhia, mhlf/mhif. Pixel decoders: RGB565, RGB555, RGB888. extractThumbnail returns null for unknown formats (graceful). ArtworkDB mhsd/mhod use 16-bit fields (not 32-bit like iTunesDB). All 7 fixtures parse without errors. ipod-nano-4 fixture has 6 file info records. AC #6 not checkable — fixtures don't have artwork image data (artwork was skipped in fixture generation).
<!-- SECTION:NOTES:END -->
