---
id: TASK-186.06
title: 'Unify planner: generic pipeline delegating to ContentTypeHandler'
status: Done
assignee: []
created_date: '2026-03-21 23:22'
updated_date: '2026-03-22 12:34'
labels:
  - refactor
dependencies:
  - TASK-186.04
  - TASK-186.05
references:
  - packages/podkit-core/src/sync/planner.ts
  - packages/podkit-core/src/sync/video-planner.ts
  - packages/podkit-core/src/sync/types.ts
documentation:
  - doc-010
parent_task_id: TASK-186
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Goal:** Replace `DefaultSyncPlanner` (871 lines) and `DefaultVideoSyncPlanner` (681 lines) with a single generic `UnifiedPlanner<TSource, TDevice>` that delegates type-specific operation creation to the `ContentTypeHandler`.

**Depends on:** TASK-186.04 (handlers), TASK-186.05 (unified differ produces UnifiedSyncDiff)

---

### The Pattern

The planning algorithm is the same for both types:
1. Take a diff result (toAdd, toRemove, existing, toUpdate)
2. Create remove operations for toRemove items (if removeOrphans enabled)
3. Create add operations for toAdd items (transcode or copy, depending on format)
4. Create update operations for toUpdate items
5. Order operations: removes first, then updates, then adds (transcodes last)
6. Calculate total estimated size and time
7. Check against maxSize constraint, warn if it won't fit
8. Return SyncPlan with operations, estimatedTime, estimatedSize, warnings

What varies (and delegates to the handler):
- How to create add/remove/update operations (`planAdd`, `planRemove`, `planUpdate`)
- Size and time estimation per operation (`estimateSize`, `estimateTime`)

### Implementation

Create `packages/podkit-core/src/sync/unified-planner.ts`:

```typescript
class UnifiedPlanner<TSource, TDevice> {
  constructor(private handler: ContentTypeHandler<TSource, TDevice>) {}

  plan(
    diff: UnifiedSyncDiff<TSource, TDevice>,
    options?: UnifiedPlanOptions
  ): SyncPlan {
    const operations: SyncOperation[] = [];

    // 1. Removes (if removeOrphans)
    if (options?.removeOrphans !== false) {
      for (const device of diff.toRemove) {
        operations.push(this.handler.planRemove(device));
      }
    }

    // 2. Updates
    for (const { source, device, reasons } of diff.toUpdate) {
      operations.push(...this.handler.planUpdate(source, device, reasons));
    }

    // 3. Adds
    for (const source of diff.toAdd) {
      operations.push(this.handler.planAdd(source, options));
    }

    // 4. Calculate estimates
    const estimatedSize = operations.reduce((sum, op) => sum + this.handler.estimateSize(op), 0);
    const estimatedTime = operations.reduce((sum, op) => sum + this.handler.estimateTime(op), 0);

    // 5. Check space + generate warnings
    const warnings = this.checkConstraints(operations, estimatedSize, options);

    return { operations, estimatedSize, estimatedTime, warnings };
  }
}
```

### Migration Steps

1. **Read both planners side by side** — Identify the shared flow vs type-specific logic. The music planner has more complex source categorization (lossless/compatible-lossy/incompatible-lossy) but this is all inside what becomes `MusicHandler.planAdd()`. The video planner has compatibility checking (passthrough vs transcode) which becomes `VideoHandler.planAdd()`.

2. **Extract operation ordering logic** — Both planners order operations. The unified planner should have a single ordering function. Current order in both: removes → metadata updates → copies → transcodes. The exact ordering may differ slightly between music and video — verify and unify.

3. **Unify warning generation** — Both planners generate `SyncWarning[]`. The warning types may differ (music warns about incompatible lossy formats, video warns about unsupported codecs). The handler's `planAdd` can return warnings alongside operations, or warnings can be a handler method.

4. **Unify space checking** — `willFitInSpace()` and `willVideoPlanFit()` were already merged in TASK-186.01. The unified planner uses the single version.

5. **Unify estimation** — `calculateOperationSize()` and `calculateOperationTime()` in the music planner already handle video operation types (they delegate to video-planner functions). In the unified planner, these are replaced by `handler.estimateSize()` and `handler.estimateTime()`.

6. **Update consumers** — The CLI's `syncMusicCollection()` and `syncVideoCollection()` create planners. Update them to create `UnifiedPlanner` with the appropriate handler. This is a temporary step — full CLI unification is TASK-186.08.

7. **Delete old planner classes** — Remove `DefaultSyncPlanner` and `DefaultVideoSyncPlanner` once the unified planner works.

### Edge Cases to Preserve

- **Music source categorization** — The music planner categorizes sources as lossless, compatible lossy, or incompatible lossy to decide transcode vs copy. This logic must live in `MusicHandler.planAdd()`, not the unified planner.
- **ALAC device support** — Music planning checks if the device supports ALAC. This is a handler concern (part of `MusicHandler`'s plan options).
- **Video device profiles** — Video planning uses `VideoDeviceProfile` to determine compatibility. This is a handler concern (part of `VideoHandler`'s plan options).
- **Artwork operations** — Music planning may include artwork-related operations. These come from `MusicHandler.planUpdate()`.
- **Max size truncation** — If the plan exceeds maxSize, operations should be truncated. The order of truncation matters (remove transcodes first, then copies). The unified planner handles this generically by truncating from the end of the operations list (adds are last, which is correct).

### Testing

- Port existing planner tests to work against UnifiedPlanner with MusicHandler/VideoHandler
- Verify identical plans for the same diff inputs
- Test: empty diff, all-add, all-remove, mixed, over-size truncation
- Run `bun run test --filter podkit-core`

**Key files to create:**
- `packages/podkit-core/src/sync/unified-planner.ts`

**Key files to modify/delete:**
- `packages/podkit-core/src/sync/planner.ts` — extract handler logic, delete DefaultSyncPlanner
- `packages/podkit-core/src/sync/video-planner.ts` — extract handler logic, delete DefaultVideoSyncPlanner
- `packages/podkit-core/src/sync/handlers/music-handler.ts` — complete planAdd/planRemove/planUpdate
- `packages/podkit-core/src/sync/handlers/video-handler.ts` — complete planAdd/planRemove/planUpdate
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A single UnifiedPlanner<TSource, TDevice> class handles planning for any content type
- [x] #2 Operation creation delegates to handler.planAdd(), planRemove(), planUpdate()
- [x] #3 Size and time estimation delegates to handler.estimateSize() and handler.estimateTime()
- [x] #4 Operation ordering is shared (removes → updates → copies → transcodes)
- [x] #5 Space checking and warning generation are shared
- [x] #6 DefaultSyncPlanner and DefaultVideoSyncPlanner classes are deleted
- [x] #7 All existing planner tests pass against the unified implementation with identical plans
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#6: DefaultSyncPlanner and DefaultVideoSyncPlanner classes deleted in follow-up session (deprecated wrappers removal pass).
<!-- SECTION:NOTES:END -->
