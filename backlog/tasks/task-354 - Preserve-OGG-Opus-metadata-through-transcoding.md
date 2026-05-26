---
id: TASK-354
title: Preserve OGG/Opus metadata through transcoding
status: To Do
assignee: []
created_date: '2026-05-26 09:00'
updated_date: '2026-05-26 09:01'
labels: []
dependencies: []
references:
  - packages/podkit-core/src/transcode/ffmpeg.ts
  - packages/podkit-core/src/transcode/ffmpeg.integration.test.ts
priority: medium
ordinal: 59000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FFmpeg's `-map_metadata 0` flag in the transcoder copies only format-level tags from the source. OGG and Opus containers store metadata in stream tags, so transcoding from OGG/Opus to AAC currently drops title, artist, album, etc. This was previously documented as a "known limitation" and the relevant integration test (`packages/podkit-core/src/transcode/ffmpeg.integration.test.ts:577`) was permanently skipped.

Empirically verified workaround (FFmpeg 8.1.1, 2026-05-26): chaining `-map_metadata 0 -map_metadata 0:s:0` preserves tags across all source formats podkit supports — FLAC, OGG, MP3, M4A/AAC, ALAC, Opus, WAV, AIFF — without regressing format-tag sources. The second invocation merges stream-tag metadata when present; otherwise it is a no-op.

## Scope

Apply the chained `-map_metadata` flags to every codec argument builder in `packages/podkit-core/src/transcode/ffmpeg.ts`:

- `buildTranscodeArgs` (AAC path)
- `buildOpusArgs`
- `buildMp3Args`
- `buildFlacArgs`
- `buildAlacArgs`
- `buildOptimizedCopyArgs`

Un-skip the existing OGG test and add an equivalent assertion for Opus (same root cause).</description>
<parameter name="acceptanceCriteria">["Transcoder builders in packages/podkit-core/src/transcode/ffmpeg.ts emit `-map_metadata 0 -map_metadata 0:s:0` (or equivalent) so stream-tag-only sources have their metadata preserved", "The OGG metadata test at packages/podkit-core/src/transcode/ffmpeg.integration.test.ts:577 is no longer skipped and asserts title/artist/album are preserved through transcode", "An equivalent Opus metadata preservation test exists alongside the OGG one and passes", "Existing FLAC, MP3, M4A/AAC, ALAC, WAV, AIFF metadata preservation tests continue to pass (no regressions for format-tag sources)", "The 'known limitation' comment above the previously-skipped test is removed"]
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Transcoder builders in packages/podkit-core/src/transcode/ffmpeg.ts emit `-map_metadata 0 -map_metadata 0:s:0` (or equivalent) so stream-tag-only sources have their metadata preserved
- [ ] #2 The OGG metadata test at packages/podkit-core/src/transcode/ffmpeg.integration.test.ts:577 is no longer skipped and asserts title/artist/album are preserved through transcode
- [ ] #3 An equivalent Opus metadata preservation test exists alongside the OGG one and passes
- [ ] #4 Existing FLAC, MP3, M4A/AAC, ALAC, WAV, AIFF metadata preservation tests continue to pass (no regressions for format-tag sources)
- [ ] #5 The 'known limitation' comment above the previously-skipped test is removed
<!-- AC:END -->
