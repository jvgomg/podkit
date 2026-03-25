---
id: doc-022
title: Echo Mini Research Handover
type: other
created_date: '2026-03-24 14:17'
updated_date: '2026-03-24 14:40'
---
# Echo Mini Research Handover

Research findings from TASK-233 and TASK-232 (2026-03-24) combining firsthand device testing, community tool analysis, and user observations. This document is the bridge between research and implementation (TASK-223 MassStorageAdapter).

## Community Tools Analyzed

### ntr0n/echo-mini-file-processor
- **URL:** https://github.com/ntr0n/echo-mini-file-processor
- **What it does:** Python in-place tag fixer and file renamer (~110 lines). Works around 3 specific Echo Mini firmware bugs.
- **Key insight:** Documents that the Echo Mini displays filenames in the library, not title tags. Also documents compound tracknumber and disc number sorting bugs.
- **Limitation:** MP3 and FLAC only. Aggressive filename sanitization strips all non-ASCII characters. No artwork handling.

### Alexeido/deezer2EchoMini
- **URL:** https://github.com/Alexeido/deezer2EchoMini
- **What it does:** Deezer downloader fork tuned for Echo Mini. Downloads FLAC, embeds 750x750 baseline JPEG artwork, uses Vorbis Comments, saves LRC lyrics.
- **Key insights:**
  - Explicitly uses Vorbis Comments for FLAC (not ID3), suggesting ID3 in FLAC containers may not work on the device — **confirmed: ID3 in FLAC is ignored**
  - Forces `progressive=False` on JPEG artwork — **confirmed necessary**
  - Writes many redundant date fields (DATE, YEAR, ORIGINALDATE, RELEASETIME, etc.) for compatibility
  - Has a date randomization hack for year-only dates, suggesting the device sorts by full date
  - Writes genre as both multi-value Vorbis tag and comma-separated GENRETEXT field

## Test Device

- **Firmware:** 3.2.0
- **Hardware:** 1.2.0
- **Storage:** 128GB microSD (exFAT) + 7.5GB internal (FAT32)

## Firsthand Testing Results

### USB Detection
| Field | Value |
|-------|-------|
| Vendor ID | 0x071b |
| Product ID | 0x3203 |
| Manufacturer | "ECHO MINI" |
| Serial | "USBV1.00" |
| Speed | USB 2.0 (480 Mb/s) |
| Current | 400mA |
| LUN 0 | Internal, "ECHO MINI", FAT32, 7.5GB |
| LUN 1 | SD card, "Echo SD", exFAT |

**CORRECTION:** Previous profile assumed vendor ID 0x0b98 (FiiO's registered USB VID). The actual device uses 0x071b.

### Artwork Behavior

| Scenario | Result |
|----------|--------|
| Baseline JPEG 300x300 | Displays, instant |
| Baseline JPEG 600x600 (88KB) | Displays, instant |
| Baseline JPEG 750x750 | Displays, instant |
| Baseline JPEG 1000x1000 | Displays, instant |
| Baseline JPEG 1425x1425 (4.2MB) | Displays, ~4s load |
| Baseline JPEG 3000x3000 (331KB) | Displays, ~2s, red line artifact on top/left |
| Progressive JPEG 600x600 | **Does not display** |
| Progressive JPEG 1000x1000 | **Does not display** |
| Progressive JPEG 1500x1500 (real album art) | **Does not display** |
| Progressive JPEG 1280x1280 (real album art) | **Does not display** |
| No embedded art + cover.jpg sidecar | **Does not display** |
| No embedded art + folder.jpg sidecar | **Does not display** |
| No embedded art + albumart.jpg sidecar | **Does not display** |

**Conclusions:**
- Only baseline JPEG works. Progressive JPEG is silently ignored.
- No sidecar artwork support whatsoever.
- Loading speed correlates with byte size, not pixel count.
- Optimal: 600x600, quality 85-90 (~50-100KB).
- Artifacts possible above ~3000px.

### Audio Format Support

| Format | Library indexed | Folder browser | Plays |
|--------|----------------|----------------|-------|
| FLAC | Yes | Yes | Yes |
| MP3 | Yes | Yes | Yes |
| AAC (.m4a) | Yes | Yes | Yes |
| OGG Vorbis | Yes | Yes | Yes |
| ALAC (.m4a) | Yes | Yes | Yes |
| WAV | **No** | Yes | Yes |
| Opus (.opus) | **No** | **No** | N/A — hidden |

**CORRECTION:** ALAC was previously listed as unsupported with conflicting reports. It works fine.

### Metadata / Library Behavior

| Behavior | Detail |
|----------|--------|
| Track name source | **Filename**, not TITLE tag |
| TRACKNUMBER="3/10" | Not parsed correctly |
| TRACKNUMBER="4 of 10" | Not parsed correctly |
| TRACKNUMBER="1" | Works |
| TRACKNUMBER="02" | Works |
| Disc number ordering | Sorts track-first, disc-second (wrong) |
| Library scan trigger | Automatic on storage mount |
| Vorbis Comments in FLAC | Works |
| ID3v2 in FLAC | **Ignored** — file shows as "Unknown" |
| ID3v2.3 in MP3 | Works |
| ID3v2.4 in MP3 | Works |

### Unicode Support

| Characters | Display |
|-----------|---------|
| Accented Latin (Café, Björk, Résumé) | Correct |
| Japanese (日本語テスト) | Correct |
| Korean (한국어 테스트) | Correct |
| Emoji (🎵🎶🎸) | **Blank space** |

### Filename format recommendation
```
{tracknumber:02d} - {title}.{ext}
```
This is what both community tools use and what works best given the filename-as-title behavior.

## Implementation Implications for podkit

### MassStorageAdapter (TASK-223)

1. **File naming:** Must generate `{track:02d} - {title}.{ext}` filenames. Sanitize for FAT32/exFAT. Avoid emoji in filenames.
2. **Folder structure:** `Music/{artist}/{album}/{track} - {title}.{ext}`
3. **Artwork pipeline:**
   - Detect progressive vs baseline JPEG (check for SOF2 marker 0xFFC2)
   - Convert progressive → baseline if needed
   - Resize to 600x600
   - Save at quality 85-90
   - Embed as FLAC Picture block or ID3 APIC frame
4. **Tag handling:**
   - Use Vorbis Comments for FLAC (ID3 in FLAC is ignored)
   - Use ID3v2.3 or ID3v2.4 for MP3 (both work)
   - Clean TRACKNUMBER to plain integer (strip "/total" suffix)
   - For multi-disc albums: append "(disc N)" to ALBUM tag when disc count > 1
5. **Transcoding:**
   - Opus → FLAC or AAC (only format requiring transcoding)
   - All other common formats play natively
6. **Detection:**
   - USB vendor 0x071b + product 0x3203
   - Manufacturer string "ECHO MINI"
   - Two LUNs — user should choose which (internal vs SD)

### Remaining unknowns (low priority)
- APEv2 tag reading (APE files rare)
- PNG embedded artwork (will use JPEG exclusively)
- Exact artwork render size (community says 136x127)
- Artwork render size on screen (community report of 136x127, unconfirmed)
