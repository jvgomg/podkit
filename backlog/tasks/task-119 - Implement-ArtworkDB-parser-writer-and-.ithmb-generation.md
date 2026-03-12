---
id: TASK-119
title: 'Implement ArtworkDB parser, writer, and .ithmb generation'
status: To Do
assignee: []
created_date: '2026-03-12 10:54'
labels:
  - phase-3
  - artwork
milestone: ipod-db Core (libgpod replacement)
dependencies:
  - TASK-117
references:
  - doc-003
documentation:
  - tools/libgpod-macos/build/libgpod-0.8.3/src/itdb_artwork.c
  - tools/libgpod-macos/build/libgpod-0.8.3/src/db-artwork-parser.c
  - tools/libgpod-macos/build/libgpod-0.8.3/src/db-artwork-writer.c
  - tools/libgpod-macos/build/libgpod-0.8.3/src/ithumb-writer.c
  - tools/libgpod-macos/build/libgpod-0.8.3/src/db-image-parser.h
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the full artwork pipeline: ArtworkDB binary format parsing/writing, .ithmb file generation, image resizing, and all pixel format conversions.

**ArtworkDB format (`iPod_Control/Artwork/ArtworkDB`):**
Similar tagged binary structure to iTunesDB but simpler:
- MHFD (master header) → MHSD sections (3 types: image list, album list, file list)
- MHLI → MHII (image info): image_id, song_id (links to track dbid), artwork_size, timestamps
- MHOD → MHNI (thumbnail info): format_id, ithmb_offset, image_size, dimensions, padding
- Parse and write using existing BufferReader/BufferWriter

**Pixel format conversions (all in `pixel-formats.ts`):**

| Format | Conversion | Bytes/pixel |
|--------|-----------|-------------|
| RGB565 LE/BE | `((r>>3)<<11) \| ((g>>2)<<5) \| (b>>3)` | 2 |
| RGB555 LE/BE | `(alpha<<15) \| ((r>>3)<<10) \| ((g>>3)<<5) \| (b>>3)` | 2 |
| RGB888 LE/BE | `(a<<24) \| (r<<16) \| (g<<8) \| b` | 4 |
| UYVY (YUV 4:2:2) | RGB→YUV BT.601, packed U Y0 V Y1 | 2 (avg) |
| I420 (YUV 4:2:0 planar) | RGB→YUV BT.601, Y plane + U/V quarter-size planes | 1.5 (avg) |
| REC_RGB555 | Recursive/deranged RGB555 for iPod Touch | 2 |

Each format needs both a pack function (RGB→format) and row alignment handling.

**.ithmb file generation:**
- Images stored as concatenated raw pixel data at known offsets
- File naming: `F{format_id}_{index}.ithmb`
- Max 256MB per file; new file created when limit reached
- Padding between images (format-dependent, filled with zeros)

**Image processing with `sharp`:**
- Load JPEG/PNG source images
- EXIF rotation handling (auto-rotate)
- Resize to target dimensions with bilinear interpolation
- Aspect-fit (no crop) or aspect-fill (crop + center) based on format
- Extract raw RGB pixel data for format conversion

**Artwork-to-track association:**
- Legacy: track `dbid` matches artwork `song_id`
- Modern: track `mhii_link` contains artwork `id` directly
- Support both for reading; write using mhii_link for newer devices

**Artwork deduplication:**
- Multiple tracks can share one artwork record
- Track shared artwork by mhii_link value
- Only store unique images in .ithmb files

**Device artwork format table:**
- Map iPod generation → list of supported artwork formats (format_id, width, height, pixel_format)
- Write ALL supported formats for the device (libgpod behavior)
- Table covers all ~200 models
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ArtworkDB binary format parsed correctly (MHFD, MHSD, MHLI, MHII, MHOD, MHNI records)
- [ ] #2 ArtworkDB writer produces valid binary output
- [ ] #3 All 6 pixel format conversions implemented and unit tested
- [ ] #4 RGB565 conversion matches libgpod bit-for-bit (test with known pixel values)
- [ ] #5 Image resizing uses sharp with bilinear interpolation and EXIF rotation
- [ ] #6 .ithmb files generated with correct format-specific naming and offsets
- [ ] #7 .ithmb files respect 256MB size limit with automatic file splitting
- [ ] #8 Row alignment padding applied correctly per format
- [ ] #9 Artwork-to-track association works via both dbid and mhii_link
- [ ] #10 Artwork deduplication: shared images stored once in .ithmb
- [ ] #11 Device artwork format table covers all iPod generations
- [ ] #12 Artwork golden fixtures (TASK-113) round-trip correctly
<!-- AC:END -->
