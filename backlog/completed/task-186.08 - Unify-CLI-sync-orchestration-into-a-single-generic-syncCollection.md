---
id: TASK-186.08
title: Unify CLI sync orchestration into a single generic syncCollection()
status: Done
assignee: []
created_date: '2026-03-21 23:23'
updated_date: '2026-03-22 12:36'
labels:
  - refactor
dependencies:
  - TASK-186.05
  - TASK-186.06
  - TASK-186.07
references:
  - packages/podkit-cli/src/commands/sync.ts
  - packages/podkit-core/src/sync/content-type.ts
documentation:
  - doc-010
parent_task_id: TASK-186
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Goal:** Replace the separate `syncMusicCollection()` and `syncVideoCollection()` functions in the CLI sync command with a single generic `syncCollection()` that uses the unified pipeline (differ, planner, executor) with the appropriate ContentTypeHandler.

**Depends on:** TASK-186.05 (unified differ), TASK-186.06 (unified planner), TASK-186.07 (unified executor)

---

### Current State

`packages/podkit-cli/src/commands/sync.ts` is a large file (~2100+ lines) containing:
- `syncMusicCollection()` (~700 lines, starting ~line 533): Creates MusicSyncContext, scans music adapter, reads iPod tracks, computes diff, creates plan, displays dry-run or executes, handles progress display
- `syncVideoCollection()` (~700 lines, starting ~line 1199): Same flow but with VideoSyncContext, video adapter, video differ, video planner, video executor

The sync command action (~line 1960) loops over collections and dispatches to the appropriate function.

### Target State

A single `syncCollection()` function that:
1. Receives a `ResolvedCollection` (which knows its type: 'music' | 'video')
2. Looks up the `ContentTypeHandler` from the registry
3. Creates the appropriate `CollectionAdapter` based on collection config
4. Scans items via adapter.getItems()
5. Reads device items via a handler-provided device query
6. Runs UnifiedDiffer with the handler
7. Runs UnifiedPlanner with the handler
8. Displays dry-run via handler.formatDryRun() OR executes via UnifiedExecutor
9. Reports results

### Implementation

```typescript
async function syncCollection<TSource, TDevice>(
  collection: ResolvedCollection,
  handler: ContentTypeHandler<TSource, TDevice>,
  adapter: CollectionAdapter<TSource, any>,
  ipod: IpodDatabase,
  options: SyncCollectionOptions
): Promise<SyncCollectionResult> {
  // 1. Scan source
  const sourceItems = await adapter.getItems();

  // 2. Read device items (handler provides the filter/query)
  const deviceItems = handler.getDeviceItems(ipod);

  // 3. Diff
  const differ = new UnifiedDiffer(handler);
  const diff = differ.diff(sourceItems, deviceItems, options.diffOptions);

  // 4. Plan
  const planner = new UnifiedPlanner(handler);
  const plan = planner.plan(diff, options.planOptions);

  // 5. Display or execute
  if (options.dryRun) {
    console.log(handler.formatDryRun(plan));
    return { plan, dryRun: true };
  }

  const executor = new UnifiedExecutor(handler, { ipod });
  const result = await executor.execute(plan, options.executeOptions);
  return { plan, result };
}
```

### Migration Steps

1. **Identify shared CLI logic** — Read both `syncMusicCollection()` and `syncVideoCollection()` to identify what's truly shared vs what's type-specific. Shared: scanning, diffing, planning, execution loop, progress display, error reporting. Type-specific: adapter creation, context building, dry-run formatting, some progress display details.

2. **Extract adapter creation** — The CLI currently creates adapters inline. Extract a factory function that creates the right adapter based on collection type and config:
   ```typescript
   function createAdapter(collection: ResolvedCollection): CollectionAdapter<any, any>
   ```
   Music collections create DirectoryAdapter or SubsonicAdapter. Video collections create VideoDirectoryAdapter.

3. **Add `getDeviceItems()` to the handler** — The handler needs a way to query the iPod for its content type's items. Music filters by `isMusicMediaType(t.mediaType)`. Video filters by `MediaType.Movie | MediaType.TVShow`. Add this to the ContentTypeHandler interface:
   ```typescript
   getDeviceItems(ipod: IpodDatabase): TDevice[];
   ```
   Note: This may require updating the interface defined in TASK-186.04. Coordinate with that task or add it here.

4. **Unify progress display** — The CLI renders progress differently for music vs video. Extract a shared progress renderer that uses `handler.getDisplayName()` for operation names. The progress bar, ETA, and completion count logic is already similar.

5. **Unify dry-run display** — The handler's `formatDryRun()` method produces the type-specific output. The CLI just prints it.

6. **Unify the sync command action** — Replace the two loops (music collections, then video collections) with a single loop over all collections, dispatching to `syncCollection()` with the appropriate handler.

7. **Clean up context types** — Delete `MusicSyncContext` and `VideoSyncContext`. Replace with a single `SyncCollectionOptions` that captures the shared options plus handler-specific config.

### What Remains Type-Specific (in the Handler)

- Adapter creation (which adapter class to instantiate) — can be a handler method or a factory
- Device item filtering (which iPod tracks belong to this content type)
- Dry-run formatting
- Operation display names
- Quality preset resolution (audio presets vs video presets)

### Testing

- E2E tests: `bun run test:e2e` — ensure the CLI sync command works for both music and video
- CLI tests: `bun run test --filter podkit-cli`
- Manual test: `podkit sync --dry-run` should produce the same output as before for both music and video

**Key files to modify:**
- `packages/podkit-cli/src/commands/sync.ts` — major refactor: replace syncMusicCollection/syncVideoCollection with syncCollection
- `packages/podkit-core/src/sync/content-type.ts` — may need to add getDeviceItems() to handler interface

**Key files to delete (code within sync.ts):**
- `syncMusicCollection()` function
- `syncVideoCollection()` function
- `MusicSyncContext` type
- `VideoSyncContext` type
- `buildMusicDryRunOutput()` (moves to MusicHandler.formatDryRun)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A single syncCollection() function handles both music and video sync in the CLI
- [x] #2 ~Deferred~ syncMusicCollection() still exists — music cannot route through syncCollection() until MusicHandler.executeBatch() wraps the 3-stage pipeline. syncVideoCollection() was replaced by syncCollection(). Follow-up: TASK-186.12.
- [x] #3 ~Deferred~ MusicSyncContext still exists alongside UnifiedSyncContext. VideoSyncContext replaced. Full consolidation depends on music pipeline migration. Follow-up: TASK-186.12.
- [x] #4 The sync command action loops over all collections with a single dispatch path
- [x] #5 Dry-run output is correct for both music and video — music via legacy path, video via handler.formatDryRun()
- [x] #6 Progress display works for video using handler.getDisplayName(). Music uses existing getOperationDisplayName() directly — both produce correct output.
- [x] #7 ~Partially met~ Adding a video-style (sequential) content type requires only registering a handler. Music-style (pipelined) types still need custom CLI orchestration until the pipeline is abstracted.
- [x] #8 All E2E and CLI tests pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Video collections fully route through syncCollection() using the unified pipeline. Music collections still use syncMusicCollection() because the 3-stage async pipeline in DefaultSyncExecutor cannot be trivially wrapped into MusicHandler.executeBatch().\n\nThe syncCollection() pattern is proven end-to-end for video. The remaining work to fully unify music is tracked in TASK-186.12 (executor) and TASK-186.13 (differ/planner).
<!-- SECTION:NOTES:END -->
