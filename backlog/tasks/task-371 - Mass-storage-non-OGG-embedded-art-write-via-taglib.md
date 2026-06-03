---
id: TASK-371
title: Mass-storage non-OGG embedded-art write via taglib
status: Done
assignee: []
created_date: '2026-06-02 08:10'
updated_date: '2026-06-03 20:46'
labels:
  - enhancement
  - artwork
  - mass-storage
  - executor
  - taglib
dependencies:
  - TASK-142
references:
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - packages/podkit-core/src/sync/music/pipeline.ts
  - test-packages/e2e-tests/src/matrix/artwork-rules.ts
priority: medium
ordinal: 97000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`MassStorageTrack.setArtworkFromData` is currently a no-op (`mass-storage-adapter.ts:436`): it accepts bytes and returns `this` unchanged. The pipeline still calls it, then writes `syncTag.artworkHash` claiming art was transferred. On the next scan the device file has no embedded picture, `detectUpgrades` fires `artwork-added`, and the second sync re-transcodes/re-copies — a churn loop with `--check-artwork` off.

For OGG/Opus *copies* there is a special-case workaround (`pipeline.ts` calls `updateTrack({ embeddedPictureData })` which routes through the taglib-sharp `METADATA_BLOCK_PICTURE` writer). Other containers (FLAC / MP3 / M4A / AIFF / WAV) have no equivalent, but **taglib-sharp supports embedded picture writes for all of them**.

TASK-142 exposed this latent issue: the new executor adapter-fallback now feeds bytes to `setArtworkFromData` on every C-sidecar / no-embed-format album, and on mass-storage non-OGG-copy outputs those bytes are dropped. The e2e artwork matrix fences ~60 cells with `skipBug` against TASK-370 to keep the suite honest.

## Scope

1. Implement `setArtworkFromData(bytes)` on `MassStorageTrack` (non-OGG containers) via the existing taglib-sharp wrapper, mirroring the OGG branch in `pipeline.ts:1491`. FLAC + MP3 + M4A + AIFF first; WAV is a stretch (needs an `id3 ` RIFF chunk write, taglib-sharp handles it but not all readers).
2. Extend `embeddedPictureData` to all those container types in `MassStorageAdapter.updateTrack`.
3. Lift the corresponding `skipBug('TASK-370')` fences in `test-packages/e2e-tests/src/matrix/artwork-rules.ts:skipArtworkCell` — only truly sidecar-primary devices (rockbox) should remain fenced.
4. Verify the `setArtworkSink` follow-up isn't blocked by this — it's the deeper fix; this task is the narrower one that closes the bigger blast radius.

## Acceptance criteria

- `MassStorageTrack.setArtworkFromData` writes the bytes into the file for FLAC / MP3 / M4A / AIFF; M4A reuses taglib-sharp's COVR atom path, FLAC/MP3 reuse the picture-frame paths.
- `e2e-tests` artwork matrix loses ≥40 of the current 60 skipBug TASK-370 fences (the mass-storage non-OGG-copy C-sidecar cells), leaving only rockbox-sidecar-primary cells fenced.
- No regression on existing mass-storage matrix cells (embedded fixtures still land art the same way; the change is additive for the C-sidecar/no-embed-format cells).
- Doc-012 §"Mass-storage embed write" updated (or new) to document the supported containers.

## Why deferred from TASK-142

TASK-142 scope was "source-side: detect sidecars + fetch from adapter". This is "device-side: write the bytes when the source-side delivers them". The two halves are independent — TASK-142 ships the read; this task ships the write — and TASK-370 (sidecar device-write for sidecar-primary devices) is the third independent half. Splitting keeps each PR reviewable.

## Notes

- The OGG branch's `getResizedArtwork` flow already exists — reuse it. Resize behaviour should match: `artworkMaxResolution`-bounded square.
- Care with M4A: taglib-sharp's M4A picture write rewrites the `udta`/`moov` atoms in place. Tested on iPod (`@podkit/libgpod-node` writes via libgpod, separate path).
- Watch for the album cache → setArtworkFromData → updateTrack pipeline order: today the OGG branch fires `track.setArtworkFromData(cached.data)` first (no-op for mass-storage), THEN `this.device.updateTrack(track, { embeddedPictureData })`. After this change, `setArtworkFromData` writes directly and the `updateTrack` branch becomes redundant — collapse into one path.
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Closed by TASK-372 (commit 50a6247f)

TASK-372's artworkSink primitive collapsed this task's scope. The `'embedded'` sink dispatches through `MusicPipeline.transferArtwork` → `device.updateTrack({ embeddedPictureData })` → `MassStorageTagWriter.writePicture` (node-taglib-sharp), which handles every common container without an `isOggExtension` guard. FLAC / MP3 / M4A / AIFF / WAV / OGG / Opus all work via the same path.

### What landed

- **OGG-only carve-out removed.** The `isOggExtension(track.filePath)` guard inside `pipeline.transferArtwork` (the OG hack for FFmpeg's no-OGG-embed limitation) is gone. All embed-capable containers now use the taglib path.
- **doc-012 § "Embedded Artwork Devices"** updated from "Future" to "TASK-372 landed", with a new "How embed writes are dispatched" subsection.
- **`MassStorageTrack.setArtworkFromData`** remains a no-op on the interface — kept for `DeviceTrack` conformance, but unreachable from the live pipeline (sink dispatch never calls it for `'embedded'`). Could be deleted from the interface when a future cleanup audits unused contract surface.
- **Matrix fences:** `skipArtworkCell` (the TASK-370 fence) narrowed from 28 cells skipped to 0 on the currently-swept device axis. Only sidecar-primary devices (rockbox, not in `ARTWORK_DEVICE_IDS`) would still be fenced.

### What did NOT need a separate change

- The acceptance criterion "Implement `setArtworkFromData(bytes)` on `MassStorageTrack` via taglib" was satisfied by routing through `updateTrack({ embeddedPictureData })` instead. Functionally equivalent — bytes land in the file via taglib — and avoids a parallel implementation.
- The acceptance criterion "Extend `embeddedPictureData` to all container types in `MassStorageAdapter.updateTrack`" was a no-op: the existing path already supports every taglib-handled container; only the pipeline gate was format-restrictive.

### Verification

- Host artwork matrices: 501 pass / 0 skip / 0 fail (all 5 art-matrix files).
- Docker matrices (Navidrome): 96 pass / 0 fail.
- Unit suite: 2879 pass.

### Follow-ups (not in this task)

- TASK-376: atomic on-file writes (doc-041 §3.4/§7.2).
- TASK-377: normalize picture-write flush + typed `PictureWriteError` (doc-041 §3.1).
- TASK-370: sidecar device-write (still open; the `'sidecar'` sink wiring is the remaining piece).
<!-- SECTION:FINAL_SUMMARY:END -->
