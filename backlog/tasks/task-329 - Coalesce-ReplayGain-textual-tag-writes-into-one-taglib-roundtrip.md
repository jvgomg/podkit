---
id: TASK-329
title: Coalesce ReplayGain + textual tag writes into one taglib roundtrip
status: Done
assignee: []
created_date: '2026-05-13 08:42'
updated_date: '2026-06-01 07:21'
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
- [x] #1 TagFields gains optional ReplayGain fields, writeTags writes them when present
- [x] #2 Adapter no longer queues ReplayGain separately; one save() flush per file
- [x] #3 Round-trip integration tests cover ReplayGain across FLAC, MP3, M4A, Opus
- [x] #4 No regression in audio-normalization e2e
<!-- SECTION:DESCRIPTION:END -->

<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Folded ReplayGain into the `writeTags` pipeline so taglib opens each file at most once per `save()` flush — was twice (textual + RG) when both kinds of update collided, common after a transcode on a `audioNormalization: 'replaygain'` device.

**Surface changes**
- `TagFields` gains optional `replayGain?: { trackGain; trackPeak?; albumGain?; albumPeak? }`. New named `ReplayGainFields` interface.
- `TagLibTagWriter.writeTags` applies the four RG accessors inside the existing `file.open + tag.* = ... + file.save()` cycle.
- `writeReplayGain` removed from the `TagWriter` interface AND `TagLibTagWriter`; not kept as a thin delegate (callers in tree are tests + the adapter).
- `MassStorageAdapter` drops `pendingReplayGainWrites` Map. `updateTrack` queues RG via `queueTagWrite(filePath, { replayGain: rg })`; the dedicated flush, relocate, and rename branches all go.
- `queueTagWrite` deep-merges `replayGain` rather than spread-replacing, so a future partial RG update can't clobber peak/album fields queued earlier (no caller does this today; future-proof guard).

**Tests** (2834 unit + 12 integration suites pass)
- 5 formats × 3 cases each = 15 ReplayGain round-trip integration tests (FLAC / MP3 / M4A / OGG / Opus; all-fields, trackGain-only, coalesced-with-textual) + a sanity case proving omitted-replayGain doesn't clobber prior writes.
- 3 adapter-level tests pinning the queueing predicate: `writeReplayGainTags + normalization` queues a RG-bearing writeTags call on a replaygain device, textual + RG ride on ONE writeTags call (the core refactor claim), non-replaygain device refuses to queue RG at all.

Sonnet review caught 4 real findings pre-commit (M4A doc-comment wrong about iTunNORM, shallow-merge RG loss risk, missing adapter-level RG coverage, missing OGG in test matrix); all addressed. Two findings explicitly skipped: pre-existing `normalizationToSoundcheck` integer-rounding precision loss (not introduced here) and one parametrised sanity case for "leave-untouched" across all formats (low value).

**Files**: `device/mass-storage-tag-writer.ts`, `device/mass-storage-adapter.ts`, tests in `device/{mass-storage-tag-writer.integration,mass-storage-adapter,ipod-adapter.integration}.test.ts`.
<!-- SECTION:FINAL_SUMMARY:END -->
