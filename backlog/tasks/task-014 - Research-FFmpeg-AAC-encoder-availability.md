---
id: TASK-014
title: Research FFmpeg AAC encoder availability
status: Done
assignee: []
created_date: '2026-02-22 19:23'
updated_date: '2026-02-22 22:19'
labels:
  - research
  - decision
milestone: 'M2: Core Sync (v0.2.0)'
dependencies: []
references:
  - docs/TRANSCODING.md
  - docs/adr/ADR-003-transcoding.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Finalize the FFmpeg/AAC encoder decision for macOS and Linux.

**Key questions:**
- Which AAC encoders are available in standard FFmpeg builds?
- Is libfdk_aac available, or only the native FFmpeg AAC encoder?
- Quality comparison: libfdk_aac vs FFmpeg native AAC vs qaac (macOS only)
- What are the installation requirements on each platform?

**Platforms to verify:**
- macOS (Homebrew FFmpeg)
- Debian/Ubuntu (apt FFmpeg)
- Consider: Docker/CI environments

**Outcome:** 
- Update ADR-003 to Accepted status
- Document recommended encoder settings per platform
- Document installation instructions
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 AAC encoder availability verified on macOS and Linux
- [x] #2 Quality comparison documented
- [x] #3 Installation requirements documented
- [x] #4 ADR-003 updated to Accepted
- [x] #5 Recommended encoder settings defined per platform
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Findings (2026-02-22)

### Encoder Availability

**macOS (Homebrew FFmpeg 8.0.1):**
- `aac` - Native FFmpeg encoder ✓
- `aac_at` - Apple AudioToolbox encoder ✓
- `libfdk_aac` - Not available (licensing)

**Linux (apt/dnf):**
- `aac` - Native FFmpeg encoder ✓
- `libfdk_aac` - Not available (requires custom build)
- `aac_at` - Not available (macOS only)

### Quality Ranking

Per FFmpeg Wiki: `aac_at ≥ libfdk_aac > native aac`

### Decisions Made

1. **Encoder selection:** Prefer `aac_at` (macOS) → `libfdk_aac` (custom) → `aac` (fallback)
2. **Default mode:** VBR (better quality-per-MB, works for seeking on iPods)
3. **Presets:** 6 presets (3 VBR, 3 CBR) from low to high quality
4. **Linux builds:** Created `tools/ffmpeg-linux/` with build scripts for libfdk_aac

### Files Updated

- `docs/TRANSCODING.md` - Added presets, encoder selection, VBR/CBR docs
- `docs/adr/ADR-003-transcoding.md` - Updated to Accepted status
- `tools/ffmpeg-linux/` - New directory with build scripts

### Follow-up

TASK-035 created to test the build scripts with Docker on Debian.
<!-- SECTION:NOTES:END -->
