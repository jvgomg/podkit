---
id: TASK-186.03
title: Define generic CollectionAdapter interface and refactor video adapter
status: Done
assignee: []
created_date: '2026-03-21 23:20'
updated_date: '2026-03-22 11:23'
labels:
  - refactor
dependencies: []
references:
  - packages/podkit-core/src/adapters/interface.ts
  - packages/podkit-core/src/adapters/directory.ts
  - packages/podkit-core/src/adapters/subsonic.ts
  - packages/podkit-core/src/video/directory-adapter.ts
  - packages/podkit-core/src/sync/video-executor.ts
  - packages/podkit-cli/src/commands/sync.ts
  - packages/podkit-core/src/index.ts
documentation:
  - doc-010
parent_task_id: TASK-186
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Goal:** Create a single generic `CollectionAdapter<TItem, TFilter>` interface that both music and video adapters implement, replacing the current split where music has a formal `CollectionAdapter` interface and video has a standalone `VideoDirectoryAdapter` class with no shared contract.

**Current state:**
- Music: `CollectionAdapter` interface in `packages/podkit-core/src/adapters/interface.ts` with fields `name`, `adapterType`, `connect()`, `getTracks()`, `getFilteredTracks(filter)`, `getFileAccess(track): FileAccess`, `disconnect()`. Implemented by `DirectoryAdapter` and `SubsonicAdapter`.
- Video: `VideoDirectoryAdapter` class in `packages/podkit-core/src/video/directory-adapter.ts` with `connect()`, `getVideos()`, `getFilteredVideos(filter)`, `getFilePath(video): string`, `disconnect()`. No interface, no `name`/`adapterType`, no `FileAccess` abstraction.

**What to do:**

1. **Define generic interface** in `packages/podkit-core/src/adapters/interface.ts`:
   ```typescript
   interface CollectionAdapter<TItem, TFilter = undefined> {
     readonly name: string;
     readonly adapterType: string;
     connect(): Promise<void>;
     getItems(): Promise<TItem[]>;
     getFilteredItems(filter: TFilter): Promise<TItem[]>;
     getFileAccess(item: TItem): FileAccess | Promise<FileAccess>;
     disconnect(): Promise<void>;
   }
   ```

2. **Create type aliases** for ergonomics:
   ```typescript
   type MusicAdapter = CollectionAdapter<CollectionTrack, TrackFilter>;
   type VideoAdapter = CollectionAdapter<CollectionVideo, VideoFilter>;
   ```

3. **Migrate existing music adapters** — The current `CollectionAdapter` interface uses `getTracks()`/`getFilteredTracks()`. Rename these to `getItems()`/`getFilteredItems()` in the interface. Update `DirectoryAdapter` and `SubsonicAdapter` to match. Update all call sites in `packages/podkit-core/src/sync/` and `packages/podkit-cli/src/commands/sync.ts`.
   
   Alternatively, keep `getTracks()`/`getFilteredTracks()` as additional methods on a `MusicDirectoryAdapter` class and have them delegate to `getItems()`/`getFilteredItems()`. But the cleaner approach is the rename — search for all usages of `getTracks` and `getFilteredTracks` and update them.

4. **Refactor `VideoDirectoryAdapter`** to implement `CollectionAdapter<CollectionVideo, VideoFilter>`:
   - Add `name` and `adapterType` properties
   - Rename `getVideos()` → `getItems()`, `getFilteredVideos()` → `getFilteredItems()`
   - Replace `getFilePath(video): string` with `getFileAccess(video): FileAccess` returning `{ type: 'path', path: string }`. This is the key change — it aligns video with the `FileAccess` abstraction and unblocks future remote video sources.
   - Update all call sites in `video-executor.ts` and `sync.ts` that call `getFilePath()` to use `getFileAccess()` instead.

5. **Update the CLI** (`packages/podkit-cli/src/commands/sync.ts`):
   - The `syncMusicCollection()` function creates adapters and calls `getTracks()`. Update to `getItems()`.
   - The `syncVideoCollection()` function creates `VideoDirectoryAdapter` and calls `getVideos()`. Update to `getItems()`.
   - Both functions should accept `CollectionAdapter<TItem, TFilter>` where possible, though the full orchestration unification happens in a later subtask.

6. **Export the generic interface** from `packages/podkit-core/src/index.ts` so consumers can use it.

**Key files to modify:**
- `packages/podkit-core/src/adapters/interface.ts` — new generic interface
- `packages/podkit-core/src/adapters/directory.ts` — update DirectoryAdapter
- `packages/podkit-core/src/adapters/subsonic.ts` — update SubsonicAdapter
- `packages/podkit-core/src/video/directory-adapter.ts` — refactor to implement generic interface
- `packages/podkit-core/src/sync/executor.ts` — update file access calls if needed
- `packages/podkit-core/src/sync/video-executor.ts` — update from getFilePath to getFileAccess
- `packages/podkit-cli/src/commands/sync.ts` — update adapter usage
- `packages/podkit-core/src/index.ts` — export new types

**Testing:** Run `bun run test --filter podkit-core` and `bun run test --filter podkit-cli`. Adapter tests should be updated to test against the generic interface. Video adapter tests should verify `getFileAccess()` returns proper `FileAccess` objects.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A generic CollectionAdapter<TItem, TFilter> interface exists in adapters/interface.ts
- [x] #2 MusicAdapter and VideoAdapter type aliases are exported
- [x] #3 DirectoryAdapter and SubsonicAdapter implement CollectionAdapter<CollectionTrack, TrackFilter>
- [x] #4 VideoDirectoryAdapter implements CollectionAdapter<CollectionVideo, VideoFilter> with name, adapterType, and FileAccess support
- [x] #5 The getFilePath() method is replaced by getFileAccess() returning FileAccess on the video adapter
- [x] #6 All call sites updated to use the generic method names (getItems, getFilteredItems, getFileAccess)
- [x] #7 All existing tests pass without behavioral changes
<!-- AC:END -->
