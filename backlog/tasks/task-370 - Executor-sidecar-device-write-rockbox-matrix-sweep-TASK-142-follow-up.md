---
id: TASK-370
title: Executor sidecar device-write + rockbox matrix sweep (TASK-142 follow-up)
status: Done
assignee: []
created_date: '2026-06-01 22:10'
updated_date: '2026-06-03 21:36'
labels:
  - enhancement
  - artwork
  - rockbox
  - sidecar
  - executor
  - testing
dependencies:
  - TASK-142
references:
  - packages/podkit-core/src/sync/music/pipeline.ts
  - test-packages/e2e-tests/src/matrix/reference-model.ts
  - test-packages/e2e-tests/src/features/art-matrix-transfer.test.ts
  - test-packages/e2e-tests/src/features/art-matrix-resize.test.ts
  - backlog/docs/doc-012 - Spec-Transfer-Mode-Behavior-Matrix.md
priority: low
ordinal: 96000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

TASK-142 landed the **read** side of sidecar artwork:
- `DirectoryAdapter` detects `cover.jpg`/`folder.jpg`/`front.png`/`album.jpeg` peer of audio files and reports `hasArtwork=true`.
- `CollectionAdapter.getArtwork(item)` returns sidecar bytes (directory) or `getCoverArt` bytes (Subsonic) so the executor can use them as fallback artwork when the audio body carries no embedded picture.

The **write** side — producing a peer `cover.jpg` on a sidecar-primary device (rockbox) — is NOT in TASK-142. Today's executor calls `track.setArtworkFromData(...)` which embeds into the file regardless of `capabilities.artworkSources`. For rockbox (`artworkSources = ['sidecar','embedded']`) this is wrong per doc-012 §"Sidecar Artwork Devices (Future)" — the file body should be art-free and a device-resolution sidecar should be written.

## What this task does

1. Production: extend the executor with a sidecar-write path keyed off `artworkPrimary(capabilities) === 'sidecar'`. Strip embedded art on transcode+copy and emit a `cover.jpg` at `artworkMaxResolution` peer of the audio file. Both directory and Subsonic sources route bytes through the album cache as today.

2. E2E matrix: add `ms-rockbox` to the device axis on `art-matrix-transfer.test.ts` and `art-matrix-resize.test.ts`, asserting `fileArtworkSurvives === false` AND a new `sidecarPresent` / `sidecarSize` signal probed from the device directory. The reference-model branches (`artworkPrimary`, `fileArtworkSurvives` sidecar = false, `expectedSidecarSize`) were added in TASK-142 and are ready to consume.

3. doc-012 §"Sidecar Artwork Devices" moves from "Future" to "Implemented" with the cell table.

## Why deferred from TASK-142

TASK-142 scope was "executor adapter fallback + directory sidecar detection". Adding sidecar device-write would have doubled the change size and is unrelated to the source-side adapter work that motivated the original task (Subsonic art served only via API; directories with cover.jpg sitting next to audio files). The reference-model branch is in place; the matrix sweep blocks on production landing.

## Notes

- `expectedSidecarSize(sourceSize, capabilities)` in `reference-model.ts` already documents the spec.
- TASK-356.06 (Navidrome C-sidecar matrix cells) pairs this on the source side: directory sidecar read + Navidrome `getCoverArt` both produce adapter bytes; rockbox device-write decides their on-device shape.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 #1 Executor writes a peer cover.jpg at artworkMaxResolution when capabilities.artworkSources[0] === 'sidecar', strips embedded art on both transcode and copy paths
- [x] #2 #2 ms-rockbox added to art-matrix-transfer.test.ts; cells assert fileHasArt=false AND sidecarPresent=true cell-for-cell
- [x] #3 #3 ms-rockbox added to art-matrix-resize.test.ts; cells assert sidecar size = min(source, artworkMaxResolution) under every transfer mode
- [x] #4 #4 doc-012 §'Sidecar Artwork Devices' updated from Future to Implemented
- [x] #5 #5 Full e2e suite green on host
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Landed in commit 9465faf9 — `feat(core): sidecar device-write for sidecar-primary devices (TASK-370)`.

**AC #1** Executor writes peer cover.jpg at artworkMaxResolution: ✔ via `MassStorageAdapter.writeSidecar` → `writeSidecarAtomically` (tmp + fsync + rename). MusicPipeline's 'sidecar' sink branch dispatches it.

**AC #2** ms-rockbox added to art-matrix-transfer: ✔ 24 → 48 cells; assert `sidecarPresent` + `sidecarSize` cell-for-cell.

**AC #3** ms-rockbox added to art-matrix-resize: ✔ 45 → 60 cells; assert `sidecar size = min(source, artworkMaxResolution)` under every transfer mode.

**AC #4** doc-012 § Sidecar Artwork Devices updated to "landed": ✔ promoted from "Future" + structured to mirror the embedded-section.

**AC #5** Full host e2e suite green: ✔ 540 host artwork cells (5 files), 0 fail.

Sonnet review found three P2s, all applied before commit:
- fsync added before rename in writeSidecarAtomically (atomicity claim was overstated)
- Stage 4 comment corrected (collect-and-aggregate, not fail-fast)
- fileArtworkSurvives sidecar branch JSDoc flagged as observational, not spec

Pre-existing test failures the worker noted (codec-preference × 2, echo-mini yuvj) verified unrelated via git stash by both worker and reviewer.

Follow-ups (out of scope for this task):
- TASK-374 — Device-profile sidecar filename preset (cover.jpg hardcoded today)
- TASK-375 — podkit doctor orphan sidecar image cleanup
- TASK-376 — Atomic on-file writes (apply same tmp+fsync+rename to picture writes)
- TASK-377 — Normalise picture-write flush to match the sidecar collect-and-aggregate shape
<!-- SECTION:FINAL_SUMMARY:END -->
