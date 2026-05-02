---
id: TASK-248.08
title: SourceCategory rework and planner update
status: Done
assignee: []
created_date: '2026-03-27 10:43'
updated_date: '2026-03-28 12:49'
labels:
  - feature
  - transcoding
dependencies:
  - TASK-248.03
  - TASK-248.02
  - TASK-248.07
documentation:
  - doc-024
parent_task_id: TASK-248
priority: high
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make `categorizeSource()` device-aware, replace hardcoded AAC/ALAC planner logic with codec preference resolution, and implement lossless stack walking. This is the largest task — it integrates the resolver, sync tags, and executor changes into the planner.

See PRD: doc-024, sections "SourceCategory rework," "Planner hardcoded format sets," "`source` keyword codec matching," and "Lossless behavior."

**SourceCategory rework:** Make `categorizeSource()` device-aware by adding `supportedAudioCodecs` parameter. Opus on Rockbox becomes `compatible-lossy` (not `incompatible-lossy`). Hardcoded `INCOMPATIBLE_LOSSY_FORMATS`/`DEFAULT_COMPATIBLE_FORMATS` become fallback when device capabilities unavailable.

**Planner update:**
- Wire codec preferences through `MusicSyncConfig` → `resolveMusicConfig()` → `ResolvedMusicConfig` → `ClassifierContext`
- Replace hardcoded AAC/ALAC decision logic with codec preference resolution
- Detect codec changes via sync tag codec field (primary) and file extension (fallback), using `UpgradeReason: 'codec-changed'`

**Lossless stack:**
- Replace special-case ALAC logic with lossless stack walking for `max` preset
- `source` keyword resolved per-track using `fileTypeToAudioCodec()` — skip for WAV/AIFF (not in metadata table)
- Fallthrough to lossy at `high` tier when no lossless codec is device-supported
- Update size estimation for per-codec sample rates (48kHz Opus) and lossless bitrates (~700 kbps FLAC vs ~900 kbps ALAC)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `categorizeSource()` takes `supportedAudioCodecs` parameter and classifies Opus as `compatible-lossy` on devices that support it
- [x] #2 Hardcoded format sets used as fallback only when device capabilities unavailable
- [x] #3 Codec preferences wired through MusicSyncConfig → ResolvedMusicConfig → ClassifierContext
- [x] #4 Plans with default stack + iPod capabilities resolves to AAC
- [x] #5 Plans with default stack + Rockbox capabilities resolves to Opus
- [x] #6 Plans with Opus preference but no libopus falls through to AAC
- [x] #7 Codec change detected via sync tag codec field triggers re-transcode with `UpgradeReason: 'codec-changed'`
- [x] #8 `max` preset + FLAC-capable device copies FLAC source files via lossless stack
- [x] #9 `max` preset + ALAC-only lossless support transcodes to ALAC
- [x] #10 `max` preset + no lossless support falls through to lossy at high quality
- [x] #11 WAV source with `source` in lossless stack: `source` skipped, falls through to FLAC/ALAC
- [x] #12 Opus source on Rockbox classified as compatible (no lossy-to-lossy warning)
- [x] #13 Size estimation accounts for 48kHz Opus and ~700 kbps FLAC
- [x] #14 Integration tests cover all resolution paths
<!-- AC:END -->
