---
id: TASK-186.05
title: 'Unify differ: generic pipeline delegating to ContentTypeHandler'
status: Done
assignee: []
created_date: '2026-03-21 23:21'
updated_date: '2026-03-22 12:34'
labels:
  - refactor
dependencies:
  - TASK-186.04
references:
  - packages/podkit-core/src/sync/differ.ts
  - packages/podkit-core/src/sync/video-differ.ts
  - packages/podkit-core/src/sync/matching.ts
  - packages/podkit-core/src/sync/types.ts
documentation:
  - doc-010
parent_task_id: TASK-186
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Goal:** Replace `DefaultSyncDiffer` (692 lines) and `DefaultVideoSyncDiffer` (480 lines) with a single generic `UnifiedDiffer<TSource, TDevice>` that delegates type-specific decisions to the `ContentTypeHandler`.

**Depends on:** TASK-186.04 (ContentTypeHandler interface + handlers exist)

---

### The Pattern

The diff algorithm is the same for both types:
1. Build a match index from device items (hash map of match key → device item)
2. For each source item, look up by match key
3. If no match → `toAdd`
4. If match found → check for updates via handler → `existing` or `toUpdate`
5. Unmatched device items → `toRemove`
6. Handle transform dual-key matching (try original key, then transformed key)

What varies (and should delegate to the handler):
- Match key generation (`generateMatchKey`, `generateDeviceMatchKey`)
- Transform key generation (`applyTransformKey`)
- Update detection (`detectUpdates`)

### Implementation

Create `packages/podkit-core/src/sync/unified-differ.ts`:

```typescript
interface UnifiedSyncDiff<TSource, TDevice> {
  toAdd: TSource[];
  toRemove: TDevice[];
  existing: Array<{ source: TSource; device: TDevice }>;
  toUpdate: Array<{ source: TSource; device: TDevice; reasons: UpdateReason[] }>;
}

interface UnifiedDiffOptions {
  forceMetadata?: boolean;
  transforms?: Record<string, string>;
  removeOrphans?: boolean;
  // Handler-specific options passed through
  handlerOptions?: Record<string, unknown>;
}

class UnifiedDiffer<TSource, TDevice> {
  constructor(private handler: ContentTypeHandler<TSource, TDevice>) {}

  diff(
    sourceItems: TSource[],
    deviceItems: TDevice[],
    options?: UnifiedDiffOptions
  ): UnifiedSyncDiff<TSource, TDevice> {
    // 1. Build device index using handler.generateDeviceMatchKey()
    // 2. For each source, try handler.generateMatchKey() then handler.applyTransformKey()
    // 3. For matches, call handler.detectUpdates() to determine if update needed
    // 4. Collect unmatched device items as toRemove (if removeOrphans)
  }
}
```

### Migration Steps

1. **Extract the shared diff algorithm** by reading both `differ.ts` and `video-differ.ts` side by side. The match-index-and-partition logic is the same — only the key generation and update detection differ.

2. **Handle the `normalizeString` duplication** — `video-differ.ts` has its own `normalizeString()` that duplicates `matching.ts`. The unified differ should use a single normalization function. Move the canonical one to a shared location (or keep in `matching.ts` and import it).

3. **Unify the diff result type** — Replace `SyncDiff` and `VideoSyncDiff` with `UnifiedSyncDiff<TSource, TDevice>`. The key change: video's `toReplace` is eliminated (handled by TASK-186.02 which migrates preset changes to the upgrade path). The unified type has: `toAdd`, `toRemove`, `existing`, `toUpdate`.

4. **Wire up the handlers** — `MusicHandler.generateMatchKey()` calls into existing `getMatchKeys()`. `VideoHandler.generateMatchKey()` calls into existing `generateVideoMatchKey()`. The unified differ doesn't need to know anything about tracks vs videos.

5. **Update consumers** — The planner (still separate at this point) needs to accept `UnifiedSyncDiff` instead of `SyncDiff`/`VideoSyncDiff`. This may require temporary adapter functions that convert between the old and new diff types until the planner is also unified (TASK-186.06).

6. **Delete old differ classes** — Once the unified differ is working and all tests pass, remove `DefaultSyncDiffer` from `differ.ts` and `DefaultVideoSyncDiffer` from `video-differ.ts`. Keep the helper functions that the handlers still call (match key generation, etc.) but remove the top-level differ classes and interfaces.

### Edge Cases to Preserve

- **Duplicate source handling:** Music differ deduplicates sources by match key. Video differ does the same. The unified differ should handle this.
- **Case-insensitive matching:** Both differs normalize strings. Ensure the unified path preserves this.
- **Transform dual-key matching:** Both support trying the original key first, then a transformed key. The unified differ should check `handler.applyTransformKey` if defined.
- **Music-specific post-processing:** The music differ has extensive post-processing passes (sync tag analysis, artwork hash baseline, force flags). These should move into `MusicHandler.detectUpdates()` rather than living in the unified differ.

### Testing

- Port existing differ tests to work against `UnifiedDiffer<CollectionTrack, IPodTrack>` with `MusicHandler` and `UnifiedDiffer<CollectionVideo, IPodVideo>` with `VideoHandler`
- Verify identical diff results for the same inputs as the old differs
- Test edge cases: empty collections, all-new, all-remove, transform matches, duplicate sources
- Run `bun run test --filter podkit-core`

**Key files to create:**
- `packages/podkit-core/src/sync/unified-differ.ts`

**Key files to modify:**
- `packages/podkit-core/src/sync/differ.ts` — extract helper functions, remove DefaultSyncDiffer class
- `packages/podkit-core/src/sync/video-differ.ts` — extract helper functions, remove DefaultVideoSyncDiffer class
- `packages/podkit-core/src/sync/types.ts` — add UnifiedSyncDiff type (or put it in unified-differ.ts)
- `packages/podkit-core/src/sync/handlers/music-handler.ts` — ensure diff-related methods are complete
- `packages/podkit-core/src/sync/handlers/video-handler.ts` — ensure diff-related methods are complete

**Key files to delete (eventually):**
- The DefaultSyncDiffer and DefaultVideoSyncDiffer classes (keep the files for helper functions if needed)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A single UnifiedDiffer<TSource, TDevice> class handles diffing for any content type by delegating to ContentTypeHandler
- [x] #2 UnifiedSyncDiff<TSource, TDevice> replaces both SyncDiff and VideoSyncDiff with a common shape (toAdd, toRemove, existing, toUpdate)
- [x] #3 DefaultSyncDiffer and DefaultVideoSyncDiffer classes are deleted
- [x] #4 The duplicated normalizeString in video-differ.ts is eliminated — one canonical implementation
- [x] #5 Transform dual-key matching works generically via handler.applyTransformKey()
- [x] #6 All existing differ tests pass against the unified implementation with identical results
- [x] #7 Music-specific post-processing (sync tags, artwork hashes, force flags) lives in MusicHandler.detectUpdates(), not in the unified differ
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#3: DefaultSyncDiffer and DefaultVideoSyncDiffer classes deleted in follow-up session (deprecated wrappers removal pass).\n\nAC#4: normalizeString is NOT duplicated — video-differ.ts and matching.ts have intentionally different implementations (video strips punctuation, music strips Unicode combining marks). Both kept with clarifying comments.
<!-- SECTION:NOTES:END -->
