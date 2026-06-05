---
id: TASK-385
title: DeviceTrack interface pruning + move artwork ops to adapter (Option Z)
status: Done
assignee: []
created_date: '2026-06-04 08:06'
updated_date: '2026-06-05 19:17'
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
modified_files:
  - packages/podkit-core/src/device/adapter.ts
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - packages/podkit-core/src/device/mass-storage-adapter.test.ts
  - packages/podkit-core/src/device/ipod-adapter.ts
  - packages/podkit-core/src/ipod/types.ts
  - packages/podkit-core/src/ipod/track.ts
  - packages/podkit-core/src/ipod/track.test.ts
  - packages/podkit-core/src/ipod/database.ts
  - packages/podkit-core/src/ipod/playlist.test.ts
  - packages/podkit-core/src/sync/music/pipeline.ts
  - packages/podkit-core/src/sync/music/pipeline.test.ts
  - packages/podkit-core/src/sync/music/planner.test.ts
  - packages/podkit-core/src/metadata/matching.test.ts
  - packages/podkit-core/src/artwork/repair.test.ts
  - packages/podkit-core/src/artwork/album-cache.ts
  - packages/podkit-core/src/test-utils/tracks.ts
  - packages/demo/src/mock-core.ts
  - .changeset/device-track-artwork-move-to-adapter.md
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation (2026-06-05)

Option Z landed. Track interfaces (`DeviceTrack`, `IpodTrack`) lost `setArtwork`, `setArtworkFromData`, `removeArtwork`. The `DeviceAdapter` interface gained:

```ts
setTrackArtwork(track: T, imageData: Buffer): Promise<void>
removeTrackArtwork(track: T): Promise<void>  // was T, optional
```

Both are now required and async. Adapters own the dispatch — pipeline no longer branches on `artworkSink` to pick a write path.

### Adapter implementations

- **`IpodDeviceAdapter.setTrackArtwork`** delegates to the existing `IpodDatabase.setTrackArtworkFromData`. The libgpod-node `Database.setTrackArtworkFromData(handle, bytes)` call site is identical to before.
- **`MassStorageAdapter.setTrackArtwork`** dispatches internally on `track.artworkSink`:
  - `'embedded'` → `this.updateTrack(track, { embeddedPictureData })` (preserves pending tag-writer pipeline)
  - `'sidecar'` → `this.writeSidecar(track, bytes)` (preserves the per-album dedup queue)
  - `'noop'` → drops bytes (safe — pipeline already early-skips before this point)
- **`removeTrackArtwork`** on both adapters keeps today's behaviour: iPod clears the ArtworkDB entry, mass-storage is a deliberate no-op.

### Pipeline simplification

`MusicPipeline.transferArtwork` is now a single `adapter.setTrackArtwork(track, bytes)` call (was a 4-way switch). The pipeline still:
- Early-skips byte extraction when `artworkSink === 'noop'` (FFmpeg work is wasted; no destination)
- Resizes bytes for `'embedded'`/`'sidecar'` via the album-level cache (`'database'` skips — libgpod owns iPod thumbnail rescale)
- Suppresses the `syncTag.artworkHash` claim when extraction returns undefined (doc-041 §3.6 churn-loop pin)

### Internal cleanup

- `IpodDatabase.setTrackArtwork(track, imagePath)` (path-based) deleted — had zero callers after the track-method removal.
- `IpodDatabaseInternal` interface in `ipod/track.ts` no longer mentions any artwork ops.
- `IpodTrackImpl` lost the three thin delegate methods.
- `MassStorageTrack` lost the three no-op stubs.

### `writeSidecar`

Kept on `MassStorageAdapter` as a public method (used by its own tests) but DROPPED from the `DeviceAdapter` interface. It's now an internal-to-mass-storage helper that `setTrackArtwork` dispatches to. The optional-on-interface dance + the pipeline's `typeof === 'function'` defensive guard are both gone.

### Tests

- Deleted 3 describe blocks from `ipod/track.test.ts` (`setArtwork`, `setArtworkFromData`, `removeArtwork`) + 3 TRACK_REMOVED checks. The libgpod-thin-delegate tests had no value after the methods moved off the track.
- Deleted 3 "is a no-op" tests from `mass-storage-adapter.test.ts` (track-level methods that no longer exist).
- Rewrote 4 dispatch tests in `pipeline.test.ts` to assert against `db.setTrackArtwork` instead of per-track `setArtworkFromData` mocks. The "missing writeSidecar defensive fallback" test deleted — that defensive guard is gone with the optional-on-interface model.
- Mock factories in `test-utils/tracks.ts`, `pipeline.test.ts`, `playlist.test.ts`, `planner.test.ts`, `matching.test.ts`, `repair.test.ts`, and `demo/mock-core.ts` all dropped the three deleted methods. MockDeviceAdapter gained `setTrackArtwork`.
- JSDoc examples in `album-cache.ts`, `ipod/types.ts`, `ipod/track.ts`, `ipod/database.ts` updated to the new shape.

### Counts

- Before: 2911 pass / 0 fail in `@podkit/core` unit suite
- After:  2898 pass / 0 fail (13 deleted: 6 track-level setArtwork tests, 3 mass-storage no-op tests, 3 TRACK_REMOVED checks, plus 1 net from "missing writeSidecar fallback" deletion)
- Integration: 12 pass / 0 fail (unchanged)
- `bun run typecheck` clean across all 34 packages
- Grep audit clean (only comment refs remain)

### Changeset

`.changeset/device-track-artwork-move-to-adapter.md` — `@podkit/core` minor bump.

### Files touched (16)

- `packages/podkit-core/src/device/adapter.ts`
- `packages/podkit-core/src/device/mass-storage-adapter.ts`
- `packages/podkit-core/src/device/mass-storage-adapter.test.ts`
- `packages/podkit-core/src/device/ipod-adapter.ts`
- `packages/podkit-core/src/ipod/types.ts`
- `packages/podkit-core/src/ipod/track.ts`
- `packages/podkit-core/src/ipod/track.test.ts`
- `packages/podkit-core/src/ipod/database.ts`
- `packages/podkit-core/src/ipod/playlist.test.ts`
- `packages/podkit-core/src/sync/music/pipeline.ts`
- `packages/podkit-core/src/sync/music/pipeline.test.ts`
- `packages/podkit-core/src/sync/music/planner.test.ts`
- `packages/podkit-core/src/metadata/matching.test.ts`
- `packages/podkit-core/src/artwork/repair.test.ts`
- `packages/podkit-core/src/artwork/album-cache.ts`
- `packages/podkit-core/src/test-utils/tracks.ts`
- `packages/demo/src/mock-core.ts`
- `.changeset/device-track-artwork-move-to-adapter.md` (new)

Post-Sonnet-review (2026-06-05): 2 flagged BLOCKERs investigated and rejected as safe-by-construction. Both concerned `IpodTrackImpl` snapshot immutability vs libgpod handle mutation — reviewer worried that after `setTrackArtwork`/`removeTrackArtwork` the in-flight `track.hasArtwork` would be stale.

Trace verdict: the C-side handle IS mutated in place (`IpodDatabase.setTrackArtworkFromData` and `removeTrackArtwork` at database.ts:613-614, 635 call the native binding then `createTrackFromHandle(handle)` re-reads from the mutated handle to return a fresh snapshot). The new void-returning adapter methods discard that snapshot — but no in-execution code reads `track.hasArtwork` after the call:

- After successful `setTrackArtwork`: pipeline's `else if (!artHash && track.hasArtwork)` defensive branch only fires on FAILURE (artHash null), never on success.
- After `removeTrackArtwork`: downstream `writeSyncTag` reads `syncTag`, not `hasArtwork` (documented at pipeline.ts:2336-2339).
- Next sync: `getTracks()` re-reads fresh handles, sees correct values.

The API contract leaks the immutability detail (caller might expect the track reference to reflect the post-op state). That's a real concern for the eventual `Track-as-data` end-state in DRAFT-010 — not for this task. Option Z is behaviour-preserving, and behaviour today is already structured around this exact pattern.

1 SUGGESTION applied: clarified JSDoc on `DeviceAdapter.setTrackArtwork` to explicitly note deferral-to-save() for mass-storage embedded + sidecar sinks (was clear for iPod database, fuzzy for mass-storage). One NIT (no `default` in the MassStorageAdapter switch) acknowledged as TypeScript-exhaustive at the type level.

Final quality gate: 2903 pass / 0 fail.
<!-- SECTION:NOTES:END -->
