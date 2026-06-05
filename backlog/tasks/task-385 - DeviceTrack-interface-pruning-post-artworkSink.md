---
id: TASK-385
title: DeviceTrack interface pruning + move artwork ops to adapter (Option Z)
status: To Do
assignee: []
created_date: '2026-06-04 08:06'
updated_date: '2026-06-05 17:57'
labels:
  - enhancement
  - refactor
  - device-adapter
  - interface
  - code-quality
  - breaking-change
dependencies:
  - TASK-372
references:
  - packages/podkit-core/src/device/adapter.ts
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - packages/podkit-core/src/ipod/track.ts
priority: low
ordinal: 111000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

TASK-372 added `DeviceTrack.artworkSink` for dispatch but did not remove the legacy artwork methods. The interface now has:

- `setArtwork(imagePath: string): DeviceTrack` — set from file path
- `setArtworkFromData(imageData: Buffer): DeviceTrack` — set from bytes
- `removeArtwork(): DeviceTrack` — clear
- `artworkSink: 'database' | 'embedded' | 'sidecar' | 'noop'` — dispatch hint

After TASK-372 the live pipeline only calls `setArtworkFromData` (for the `'database'` sink → iPod), and `removeArtwork` (for `transferUpgradeToIpod`'s `artwork-removed` upgrade branch). `setArtwork(path)` has zero remaining callers in production code.

The pipeline today branches on `artworkSink` and calls **three different APIs** for "set artwork":
- iPod `'database'` → `track.setArtworkFromData(bytes)` (libgpod, in-memory)
- Mass-storage `'embedded'` → `adapter.updateTrack({embeddedPictureData})` (file rewrite)
- Mass-storage `'sidecar'` → `adapter.writeSidecar(path, bytes)` (cover.jpg sibling)

This is the real leak. Pipeline shouldn't dispatch on storage backend.

## Decision (2026-06-05)

**Option Z — move artwork ops onto the adapter.** Track loses artwork methods entirely. Pipeline calls one unified API. Aligns with the eventual end-state (single `Track` data interface, adapter owns all ops — see TASK-NEW "Unify Track to data shape, adapter owns ops").

Rejected alternatives:
- **Option Y (unify on track):** keeps active-record shape; ~100 LOC of method bodies become throwaway in the bigger refactor.
- **Option X (minimum):** delete dead `setArtwork(path)` only; leaves the three-API dispatch in place.

Z has zero throwaway — it IS a step toward the end-state.

## Scope

1. **Add adapter methods** to `DeviceAdapter`:
   ```ts
   setTrackArtwork(track: DeviceTrack, bytes: Buffer): Promise<void>
   removeTrackArtwork(track: DeviceTrack): Promise<void>
   ```
2. **`IpodAdapter` implementation:** dispatches to the existing `IpodTrack` libgpod call (today's `setArtworkFromData` body, relocated).
3. **`MassStorageAdapter` implementation:** dispatches internally on `track.artworkSink`:
   - `'embedded'` → existing `updateTrack({embeddedPictureData: bytes})` path
   - `'sidecar'` → existing `writeSidecar(...)` path
   - `'noop'` → no-op
4. **Pipeline:** stop branching on `artworkSink` in `transferArtwork`. Single call: `adapter.setTrackArtwork(track, bytes)`. Same for the artwork-removed upgrade branch → `adapter.removeTrackArtwork(track)`.
5. **Remove `setArtwork(imagePath)`, `setArtworkFromData(bytes)`, `removeArtwork()` from the `DeviceTrack` interface** + the IpodTrack/MassStorageTrack implementations + tests.
6. **Keep `artworkSink` on the track** as a readable introspection property — planning + progress reporting still need it.

## Concerns

- Pipeline branching for progress events: `artworkSink` stays exposed so the pipeline can still emit "slow file rewrite" vs "fast in-memory" progress events. Dispatch is what moves, not introspection.
- Commit semantics differ (iPod = in-memory until save, embedded/sidecar = immediate). Not new — already true today.
- Public API breaking change (`@podkit/core` exports the `DeviceTrack` interface). Minor version bump.

## Acceptance criteria

- `DeviceAdapter` exposes `setTrackArtwork` + `removeTrackArtwork`.
- `DeviceTrack` interface loses all three artwork methods (`setArtwork`, `setArtworkFromData`, `removeArtwork`).
- `artworkSink` remains as a readable property.
- Pipeline's `transferArtwork` stops branching on `artworkSink`; one call site for set, one for remove.
- All callers verified; existing tests green; no behaviour change.
- Changeset created with minor bump.

## Notes

- Pairs with TASK-383 (pipeline.ts extract). TASK-383 will touch the same dispatch site — land 385 first so the artwork module extract is cleaner.
- Bigger refactor follow-up: TASK-NEW (single Track data shape, all ops on adapter).

## Reference

- Item 4 from post-team-lead retro (2026-06-04).
- TASK-372 (commit 50a6247f) introduced `artworkSink`.
- Decided 2026-06-05 in team-lead session.
<!-- SECTION:DESCRIPTION:END -->
