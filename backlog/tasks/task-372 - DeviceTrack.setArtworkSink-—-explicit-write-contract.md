---
id: TASK-372
title: DeviceTrack.setArtworkSink() — explicit write contract
status: To Do
assignee: []
created_date: '2026-06-02 08:14'
labels:
  - enhancement
  - architecture
  - artwork
  - executor
  - device-adapter
dependencies:
  - TASK-142
references:
  - packages/podkit-core/src/device/adapter.ts
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - packages/podkit-core/src/sync/music/pipeline.ts
priority: low
ordinal: 98000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

Today `pipeline.transferArtwork` calls `track.setArtworkFromData(bytes)` unconditionally and trusts that bytes land. The implementations vary silently:

| DeviceTrack impl                   | Behaviour                                                                            |
| ---                                | ---                                                                                  |
| `IpodTrack` (libgpod)              | Writes into ArtworkDB; device shows the cover.                                       |
| `MassStorageTrack` (any container) | **No-op** — returns `this` unchanged.                                                |
| OGG/Opus mass-storage (special)    | Pipeline detects the extension and routes through `updateTrack({ embeddedPictureData })` — taglib write. |

The pipeline then writes `syncTag.artworkHash` regardless, claiming success. For mass-storage non-OGG this is misleading: the next scan shows the file has no embedded picture and `detectUpgrades` fires `artwork-added` → churn loop.

TASK-371 fixes one slice (taglib for non-OGG mass-storage containers); TASK-370 fixes another (sidecar device-write for sidecar-primary devices). Both are narrow workarounds. The right primitive is to make every `DeviceTrack` declare WHERE its art lives so the pipeline picks the correct write path and writes a syncTag only when the write actually happened.

## Proposal

Add to `DeviceAdapter`'s track interface (`packages/podkit-core/src/device/adapter.ts`):

```ts
interface DeviceTrack {
  // ...existing fields
  /**
   * Where this device stores artwork for this track. The pipeline uses the
   * answer to pick the correct write path:
   *   - 'database' → setArtworkFromData (e.g. iPod iTunesDB)
   *   - 'embedded' → updateTrack({ embeddedPictureData }) via taglib
   *   - 'sidecar'  → write peer cover.jpg on the device
   *   - 'noop'     → device has no artwork support; skip the write AND the syncTag.artworkHash
   */
  artworkSink: 'database' | 'embedded' | 'sidecar' | 'noop';
}
```

Then the pipeline:

```ts
switch (track.artworkSink) {
  case 'database':  await this.device.setTrackArtwork(track, bytes); break;
  case 'embedded':  await this.device.updateTrack(track, { embeddedPictureData: bytes }); break;
  case 'sidecar':   await this.device.writeSidecar(track, bytes); break;
  case 'noop':      return undefined; // do NOT write a syncTag claiming success
}
```

(`setArtworkFromData` could keep its current name but become the database-only path; or rename to make the intent explicit.)

## Why this matters

- **Honest syncTags.** Today mass-storage non-OGG writes `syncTag.artworkHash` for a write that didn't happen → engine fires `artwork-added` on every sync. After this change the `noop` branch skips the syncTag write, breaking the churn loop *without* relying on the executor knowing about each container.
- **One fix collapses TASK-370 and TASK-371's overlap.** TASK-370 only needs to add the `sidecar` write path on `MassStorageAdapter`; TASK-371 only needs to fix the `embedded` path. The dispatch is no longer in the pipeline; it's in the device track.
- **Future devices plug in.** Adding a new device adapter today requires editing `pipeline.transferArtwork` for the new write path. After this change a new device just declares its sink.

## Scope

1. Add `artworkSink` to `DeviceTrack` and the concrete impls (`IpodTrack` = 'database', `MassStorageTrack` = derive from `artworkSources[0]` of the device capabilities).
2. Refactor `pipeline.transferArtwork` to dispatch on `artworkSink` instead of file extension. The OGG/Opus special case folds into 'embedded'. Remove `isOggExtension` guard from the pipeline (matrix can keep its mirror or rely on `artworkSink`).
3. Suppress `syncTag.artworkHash` writes when `artworkSink === 'noop'`.
4. Drop the TASK-370/TASK-371 skipBug fences from the e2e matrix that hung on the indirect sink detection.

## Acceptance criteria

- `DeviceTrack.artworkSink` populated on every concrete track impl.
- `pipeline.transferArtwork` switches on `artworkSink`; no extension-based branching.
- `noop` writes no `syncTag.artworkHash`. e2e churn loop test passes (synthetic `noop`-only target, no second-sync artwork-added op).
- Existing e2e artwork matrix green; ≥40 TASK-370/TASK-371 skipBug fences lifted.

## Why deferred from TASK-142

TASK-142 scope was "source-side adapter fallback". This is a device-side refactor that the source-side fix made visible — but it's an interface change touching every device adapter, ADR-worthy in its own right.
<!-- SECTION:DESCRIPTION:END -->
