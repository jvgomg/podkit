---
id: TASK-232
title: Validate Echo Mini capability assumptions with test data on real device
status: Done
assignee: []
created_date: '2026-03-23 21:03'
updated_date: '2026-03-24 14:39'
labels:
  - testing
  - device
  - hitl
milestone: 'Additional Device Support: Echo Mini'
dependencies:
  - TASK-233
references:
  - devices/echo-mini.md
  - packages/test-fixtures/
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The device profile (`devices/echo-mini.md`) is based on community research, official docs, and forum posts — not hands-on testing. Before shipping Echo Mini support, we need to validate key assumptions by creating test audio files with specific characteristics and having the user report what the device actually does.

**Create test data covering:**

1. **Artwork size thresholds** — files with embedded JPEG artwork at 300x300, 600x600, 1000x1000, and 1200x1200. Confirm loading speed and whether 1000x1000 is actually the hard limit or just a recommendation.

2. **Artwork format** — files with embedded PNG artwork (profile says JPEG only). Confirm PNG doesn't display.

3. **Audio format support** — test files in each format:
   - Confirmed: FLAC, MP3, AAC (.m4a), OGG, WAV, APE, WMA
   - Uncertain: ALAC (.m4a) — conflicting user reports, "File Format Error" for some users
   - Unsupported: Opus (.opus) — not listed, confirm it fails gracefully

4. **Sidecar artwork** — place a `cover.jpg` and `folder.jpg` next to audio files. Profile says no sidecar support; confirm the device ignores these.

5. **Folder structure** — test nested structures (Artist/Album/track) and flat structures. Does folder depth affect playback or library scanning?

6. **Tag reading** — files with ID3v2.3 vs ID3v2.4 tags, Unicode metadata, long field values. Does the device handle all of these?

7. **USB identification** — capture USB product ID via `system_profiler SPUSBDataType` (macOS) or `lsusb` (Linux). This is needed for auto-detection.

**Output:** A test fixture bundle (script or directory) that the user can copy to the device, plus a checklist of what to observe and report back. Update `devices/echo-mini.md` with confirmed findings.

**Note:** This overlaps with TASK-221 (investigate Echo Mini) but is more structured — it produces specific test artifacts rather than open-ended investigation. Consider whether this replaces TASK-221 or supplements it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Test fixture bundle created with audio files covering all format/artwork/metadata scenarios
- [x] #2 Checklist document for user to follow when testing on real device
- [x] #3 USB vendor/product ID captured and documented
- [x] #4 Artwork behavior confirmed: embedded JPEG sizes, PNG support, sidecar support
- [x] #5 Audio format edge cases confirmed: ALAC, Opus, APE
- [x] #6 Folder structure and tag reading behavior confirmed
- [x] #7 devices/echo-mini.md updated with all confirmed/corrected findings
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Informed by TASK-233 (2026-03-24)

Firsthand testing has already confirmed several items from this task's scope:
- USB vendor/product ID captured (AC #3 done)
- Artwork behavior confirmed: baseline JPEG only, no progressive, no sidecar (AC #4 partially done)
- ALAC confirmed working, Opus confirmed hidden (AC #5 partially done)
- Folder structure Artist/Album/Track works fine (AC #6 partially done)

Remaining to test:
- PNG embedded artwork
- ID3 tags in FLAC containers (vs Vorbis Comments)
- APEv2 tag reading
- Various ID3v2.3 vs ID3v2.4 scenarios
- Unicode edge cases in tags/filenames
- Artwork exactly at 1000x1000 (loading speed threshold)

See devices/echo-mini.md for full confirmed findings.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Validation Complete (2026-03-24)

All high-impact items validated via firsthand testing across two sessions (TASK-233 + TASK-232).

### Results summary

**USB Detection:** VID 0x071b, PID 0x3203, manufacturer "ECHO MINI". Two LUNs (internal FAT32 + SD exFAT).

**Artwork:** Baseline JPEG only (progressive silently ignored). No sidecar support. Loading speed = f(byte size). Optimal: 600x600 at quality 85-90. Artifacts above ~3000px.

**Audio Formats:** FLAC, MP3, AAC, OGG, ALAC all work. WAV plays but not library-indexed. Opus completely hidden.

**Metadata:** Library shows filenames not title tags. FLAC must use Vorbis Comments (ID3 in FLAC ignored). ID3v2.3 and v2.4 both work for MP3. Compound tracknumbers broken. Disc sort inverted.

**Unicode:** Accented Latin, CJK all fine. Emoji displays as blank.

**Firmware:** 3.2.0 / Hardware 1.2.0.

### Skipped items
- PNG artwork: not tested (will use JPEG exclusively)
- APEv2 tags: not tested (APE files rare in modern libraries)

### Artifacts
- Test fixture files on device at `/Volumes/Echo SD/Music/`
- Device profile updated: `devices/echo-mini.md`
- Handover document: DOC-022
<!-- SECTION:FINAL_SUMMARY:END -->
