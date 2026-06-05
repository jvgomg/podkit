---
id: DRAFT-010
title: Unify Track to data shape; move all ops to DeviceAdapter (hexagonal)
status: Draft
assignee: []
created_date: '2026-06-05 17:57'
labels:
  - enhancement
  - refactor
  - device-adapter
  - architecture
  - breaking-change
  - hexagonal
dependencies:
  - TASK-385
references:
  - packages/podkit-core/src/device/adapter.ts
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - packages/podkit-core/src/ipod/track.ts
  - packages/podkit-core/src/sync/music/pipeline.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

Today `@podkit/core` has two `DeviceTrack` implementations (`IpodTrack`, `MassStorageTrack`) because storage layers genuinely differ — IpodTrack wraps a libgpod native pointer (lifecycle, finalization, N-API proxies); MassStorageTrack is a plain JS object with metadata + filepath.

The pipeline operates on the `DeviceTrack` interface, so it doesn't know which it has — but the active-record shape (methods on the track) leaks structural complexity into the type and forces dual implementations. The right end-state is hexagonal: `Track` is a data type, `DeviceAdapter` owns all ops.

## Proposed end-state

```ts
interface Track {
  filepath: string
  metadata: TrackMetadata
  artworkSink: ArtworkSink   // introspection only
  syncTag?: string
  // ... other readable state
}

interface DeviceAdapter {
  setTrackArtwork(track: Track, bytes: Buffer): Promise<void>
  removeTrackArtwork(track: Track): Promise<void>
  updateTrackMetadata(track: Track, meta: Partial<TrackMetadata>): Promise<void>
  removeTrack(track: Track): Promise<void>
  // ...every other op that today lives as a method on IpodTrack/MassStorageTrack
}
```

Pipeline holds opaque track handles. iPod adapter manages the pointer table internally (Map<trackId, ItdbTrack*>). Mass-storage adapter does its file thing. **One Track type, two adapters.**

## Scope

1. **Inventory every method on `DeviceTrack`** (set/get/mutate). Categorise:
   - Pure data accessor → keep on Track (becomes a field on the data type)
   - State mutation → move to adapter method
2. **Adapter ownership of libgpod pointer table.** Today `IpodTrack` holds the pointer directly. After refactor: `IpodAdapter` owns `Map<trackId, Itdb_Track*>` keyed by the data-Track's id field. Finalizer / cleanup is adapter-managed.
3. **Pipeline refactor.** Every `track.setX(...)` call site becomes `adapter.setTrackX(track, ...)`. Touches every callsite in `sync/music/pipeline.ts`, `sync/video/`, `engine/`.
4. **Test fixtures.** Every test that mocks `DeviceTrack` becomes a data-Track + adapter-method mock.
5. **Public API.** `@podkit/core` consumers see `Track` as a plain object. Minor bump (or major if consumers were calling methods directly).

## Concerns

- **Scope.** Touches every adapter callsite — pipeline, planner, executor, tests. 1–2 weeks careful work.
- **Pointer lifetime.** Adapter must finalize libgpod handles for tracks no longer referenced. Today TS GC + IpodTrack finalizer handles this. After refactor: adapter needs equivalent — explicit `adapter.dispose(track)` or weak-ref-based cleanup.
- **Concurrency.** Adapter's track table needs to be safe under concurrent reads (pipeline already serialises writes).
- **Backwards compat.** `@podkit/core` exports `DeviceTrack`. Public API break.

## Acceptance criteria

- Single `Track` interface (data shape).
- `IpodTrack` / `MassStorageTrack` classes deleted.
- All track ops live on `DeviceAdapter`.
- Pipeline + planner + executor migrated.
- Test fixtures migrated.
- libgpod pointer table owned by `IpodAdapter`; lifecycle equivalent to today.
- No behaviour change; full test suite green.
- Changeset created.

## Supersedes / related

- TASK-385 (Option Z partial): closes the artwork-method dispatch (`setTrackArtwork`/`removeTrackArtwork` on adapter). This task generalises Z to all track ops.
- TASK-383 (pipeline extract): better to land 383 first if its surface is stable, then sweep both in this refactor.

## Reference

- Decided 2026-06-05 in team-lead session as the right end-state.
- TASK-385 Option Z chosen as the interim step pointing this direction.
<!-- SECTION:DESCRIPTION:END -->
