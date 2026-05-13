---
id: TASK-329
title: Coalesce ReplayGain + textual tag writes into one taglib roundtrip
status: To Do
assignee: []
created_date: '2026-05-13 08:42'
labels:
  - mass-storage
  - performance
  - refactor
  - follow-up
dependencies: []
references:
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - packages/podkit-core/src/device/mass-storage-tag-writer.ts
  - packages/podkit-core/src/device/mass-storage-tag-writer.integration.test.ts
priority: low
ordinal: 49000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`MassStorageAdapter.save()` currently maintains three independent pending-write maps that each invoke taglib separately for the same file:

- `pendingTagWrites` → `tagWriter.writeTags()`
- `pendingReplayGainWrites` → `tagWriter.writeReplayGain()`
- `pendingPictureWrites` → `tagWriter.writePicture()`

When a single track has both a textual-tag change AND a ReplayGain update (common after a transcode on a `audioNormalization: 'replaygain'` device), taglib opens the file twice in `save()` — two reads, two writes, two saves. For large libraries this doubles the per-track I/O on the affected tracks.

`writePicture` is genuinely separate (binary data, different formats need different embedding paths) but ReplayGain is just more textual tag fields. Folding it into `writeTags(filePath, fields)` would unify the roundtrip.

## Proposed refactor

1. Extend `TagFields` with `replayGain?: { trackGain: number; trackPeak?: number; albumGain?: number; albumPeak?: number }`.
2. `TagLibTagWriter.writeTags` writes ReplayGain fields when present, using the same `file.open + tag.* = ... + file.save()` cycle as textual fields.
3. Remove `writeReplayGain` from the `TagWriter` interface (or keep as a deprecated thin delegate).
4. Adapter folds `pendingReplayGainWrites` into `pendingTagWrites`.

## Risks

- Per-format encoder behaviour for ReplayGain may differ slightly from the dedicated `writeReplayGain` path — needs round-trip tests across FLAC/MP3/M4A/Opus to verify equivalence.
- `audioNormalization === 'replaygain'` is a separate gate from textual tag writes; the queueing condition must still respect it.

## Out of scope

- `writePicture` stays separate. Binary embedding has format-specific quirks (METADATA_BLOCK_PICTURE on OGG, cover atom on M4A) that don't share enough surface with text-tag writes to merge cleanly.

## References

- `packages/podkit-core/src/device/mass-storage-adapter.ts` — pending maps and save() flush
- `packages/podkit-core/src/device/mass-storage-tag-writer.ts` — TagWriter interface, TagFields
- `packages/podkit-core/src/device/mass-storage-tag-writer.integration.test.ts` — round-trip tests to extend

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 TagFields gains optional ReplayGain fields, writeTags writes them when present
- [ ] #2 Adapter no longer queues ReplayGain separately; one save() flush per file
- [ ] #3 Round-trip integration tests cover ReplayGain across FLAC, MP3, M4A, Opus
- [ ] #4 No regression in audio-normalization e2e
<!-- SECTION:DESCRIPTION:END -->
<!-- AC:END -->
