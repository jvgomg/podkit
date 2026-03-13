---
id: TASK-133
title: Sound Check (volume normalization) support
status: To Do
assignee: []
created_date: '2026-03-13 23:14'
updated_date: '2026-03-13 23:22'
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
- [ ] #1 libgpod-node exposes `soundcheck` field on Track and TrackInput types
- [ ] #2 During sync, iTunNORM tags are read and converted to soundcheck values
- [ ] #3 During sync, ReplayGain tags are read and converted to soundcheck values (fallback if no iTunNORM)
- [ ] #4 iPod Sound Check toggle works correctly with podkit-synced tracks that have normalization data
- [ ] #5 Tracks without normalization data sync normally (soundcheck left as 0 / no adjustment)
- [ ] #6 Sync summary / dry-run shows count of tracks with vs. without normalization data
- [ ] #7 `podkit device music` indicates whether tracks have Sound Check values set
- [ ] #8 Documentation covers how to add normalization data using common tools (beets, foobar2000, iTunes, loudgain)
- [ ] #9 Integration test verifies soundcheck value is written to iPod database from both iTunNORM and ReplayGain sources
<!-- AC:END -->
