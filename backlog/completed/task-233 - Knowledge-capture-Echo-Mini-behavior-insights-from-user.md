---
id: TASK-233
title: 'Knowledge capture: Echo Mini behavior insights from user'
status: Done
assignee: []
created_date: '2026-03-23 21:04'
updated_date: '2026-03-24 14:16'
labels:
  - research
  - device
  - hitl
milestone: 'Additional Device Support: Echo Mini'
dependencies: []
references:
  - devices/echo-mini.md
  - 'https://github.com/ntr0n/echo-mini-file-processor'
  - 'https://github.com/Alexeido/deezer2EchoMini'
documentation:
  - devices/echo-mini.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Interactive session to capture James's hands-on knowledge and observations about the Echo Mini before we build the validation test fixtures. The device profile (`devices/echo-mini.md`) is based on community research, but James has the actual device and likely has observations that aren't captured yet.

**Topics to cover:**

- Anything observed about how the device organizes/scans music
- Folder structure preferences or requirements noticed
- Artwork behavior observed in practice (what works, what doesn't)
- Any quirks, bugs, or surprises encountered
- How the device appears when plugged in (mount point, volume name, filesystem)
- USB identification details if already captured
- Tag reading behavior — any encoding issues or metadata that didn't show up
- What other tools/workflows have been used to load music onto it
- Any firmware-specific behavior worth noting

**Format:** Conversational — an agent interviews James, asks follow-up questions, and captures findings into `devices/echo-mini.md` and any relevant backlog task notes.

**This should happen before TASK-232** (validation test fixtures) so the test data is informed by real observations, not just community research.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Interactive session completed with James sharing Echo Mini observations
- [x] #2 devices/echo-mini.md updated with confirmed firsthand findings
- [x] #3 Any corrections to community-sourced data noted
- [x] #4 Findings inform TASK-232 test fixture design
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Session Summary (2026-03-24)

### Sources investigated
- **ntr0n/echo-mini-file-processor** — Python tag fixer documenting 3 firmware bugs (filename-as-title, compound tracknumber, disc sort)
- **Alexeido/deezer2EchoMini** — Deezer downloader fork with Echo Mini-specific artwork (750x750 baseline JPEG) and Vorbis Comment tagging
- **Firsthand testing** — test fixture files created and validated on James's Echo Mini with SD card

### Key findings

**USB Detection (NEW — corrects community data):**
- Vendor ID: 0x071b (NOT 0x0b98 as assumed from FiiO's registered VID)
- Product ID: 0x3203
- Manufacturer string: "ECHO MINI"
- Two LUNs: internal (FAT32, "ECHO MINI", 7.5GB) + SD (exFAT, "Echo SD")

**Artwork (several findings NEW):**
- Progressive JPEG does NOT display — baseline only (confirmed firsthand, aligns with deezer2EchoMini)
- No sidecar artwork — tested cover.jpg, folder.jpg, albumart.jpg (confirmed firsthand)
- Loading speed = f(byte size), not pixel dimensions: 88KB instant, 331KB ~2s, 4.2MB ~4s
- 3000x3000 artwork causes red line rendering artifact on top/left edge
- 600x600 at quality 85-90 is optimal (~50-100KB, instant load)

**Metadata (confirmed via ntr0n + firsthand):**
- Library browser shows FILENAMES, not TITLE tags — must use meaningful filenames
- Compound TRACKNUMBER ("3/10") not parsed correctly
- Disc number sorting inverted (sorts track-first, disc-second)

**Audio Formats (firsthand):**
- ALAC works — plays in both library and folder browser (resolves conflicting reports)
- WAV not indexed by library scanner (folder browser only)
- Opus completely hidden from device (library and folder browser)
- OGG Vorbis works fine

**Corrections to community data:**
- USB vendor ID was wrong (0x0b98 → 0x071b)
- ALAC was listed as unsupported — actually works
- 1000x1000 is not a hard artwork limit, just a speed recommendation
- deezer2EchoMini's progressive=False was validated as necessary, not just precautionary

### Handover document
See DOC created alongside this task for full details for future implementation work.
<!-- SECTION:NOTES:END -->
