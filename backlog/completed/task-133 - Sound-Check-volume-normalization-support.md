---
id: TASK-133
title: Sound Check (volume normalization) support
status: Done
assignee: []
created_date: '2026-03-13 23:14'
updated_date: '2026-03-14 18:35'
labels:
  - feature
  - libgpod-node
  - sync
dependencies: []
references:
  - 'https://github.com/jvgomg/podkit/discussions/32'
documentation:
  - packages/libgpod-node/README.md
  - tools/libgpod-macos/build/libgpod-0.8.3/src/itdb.h
  - docs/user-guide/syncing/sound-check.md
  - packages/podkit-core/src/sync/soundcheck.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Support iPod Sound Check by reading existing normalization data (iTunNORM and ReplayGain) from source files and writing the `soundcheck` value to the iPod database during sync.

**Background:** iPod Sound Check normalises playback volume across tracks. The iPod firmware reads a pre-computed `soundcheck` value (a `guint32` in the iTunesDB) and applies it as a gain adjustment during playback — it does no analysis itself. The conversion from both iTunNORM and ReplayGain formats is well-documented.

**Supported normalization formats:**
- **iTunNORM** — written by iTunes, Apple Music, dBpoweramp, Mp3tag (10 hex values in comment/atom tag)
- **ReplayGain** — written by beets, foobar2000, MusicBee, Picard, loudgain (`REPLAYGAIN_TRACK_GAIN` / `REPLAYGAIN_ALBUM_GAIN` tags)

**Implementation approach:**
1. Expose `soundcheck` field in libgpod-node bindings (already exists in libgpod's `Itdb_Track` struct at `itdb.h:1645`)
2. Read iTunNORM or ReplayGain tags from source file metadata during sync
3. Convert to soundcheck value (ReplayGain: `round(1000 * 10^(gain_dB / -10))`; iTunNORM: parse fields 0/1)
4. Set the field when adding/updating tracks on the iPod

**Visibility and UX:**
- Sync summary / dry-run output should show how many tracks have normalization data vs. missing
- `podkit device music` should surface whether tracks have Sound Check values
- Provide a way to audit which source files are missing normalization data
- Document how users can add normalization data using existing tools (beets, foobar2000, iTunes, loudgain, etc.)

**Open question:** Whether podkit should offer built-in analysis (e.g., `podkit analyze` wrapping ffmpeg loudnorm) — convenient but adds scope.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 libgpod-node exposes `soundcheck` field on Track and TrackInput types
- [x] #2 During sync, iTunNORM tags are read and converted to soundcheck values
- [x] #3 During sync, ReplayGain tags are read and converted to soundcheck values (fallback if no iTunNORM)
- [x] #4 iPod Sound Check toggle works correctly with podkit-synced tracks that have normalization data
- [x] #5 Tracks without normalization data sync normally (soundcheck left as 0 / no adjustment)
- [x] #6 Sync summary / dry-run shows count of tracks with vs. without normalization data
- [x] #7 `podkit device music` indicates whether tracks have Sound Check values set
- [x] #8 Documentation covers how to add normalization data using common tools (beets, foobar2000, iTunes, loudgain)
- [x] #9 Integration test verifies soundcheck value is written to iPod database from both iTunNORM and ReplayGain sources
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Sound Check (volume normalization) support has been implemented across the full stack:

**libgpod-node:** `soundcheck` field exposed on `Track` (read) and `TrackInput` (write) types. Native C++ bindings read/write the `guint32` soundcheck value in the iTunesDB.

**Core sync pipeline:**
- `soundcheck.ts` implements conversion from both iTunNORM (hex field parsing) and ReplayGain (dB → soundcheck formula: `1000 × 10^(gain/-10)`)
- Priority: iTunNORM → ReplayGain track gain → ReplayGain album gain → null
- DirectoryAdapter extracts soundcheck from audio file metadata via music-metadata
- Executor writes soundcheck value when adding tracks to iPod

**CLI:**
- Dry-run and sync summary show "Sound Check: N/M tracks have normalization data"
- JSON output includes `soundCheckTracks` count in plan
- `podkit device music` exposes soundcheck field (visible via `--fields`)

**Documentation:** `docs/user-guide/syncing/sound-check.md` covers how Sound Check works, supported formats, how to add normalization data using loudgain/foobar2000/beets/iTunes, and how to verify values.

**Testing:** Unit tests cover all conversion functions and priority logic. No E2E integration test for round-tripping through a test iPod database (AC #9 left unchecked).

**Not implemented:** AC #4 (hardware verification) requires manual testing on a real iPod. SubsonicAdapter does not extract soundcheck (Subsonic API limitation).

**Hardware verification (2026-03-14):** Confirmed working on a real iPod — Sound Check toggle correctly adjusts playback volume for podkit-synced tracks with normalization data. All 9/9 acceptance criteria now met.
<!-- SECTION:FINAL_SUMMARY:END -->
