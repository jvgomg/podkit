---
id: TASK-186.07
title: 'Unify executor: generic pipeline delegating to ContentTypeHandler'
status: Done
assignee: []
created_date: '2026-03-21 23:22'
updated_date: '2026-03-22 12:35'
labels:
  - refactor
dependencies:
  - TASK-186.04
  - TASK-186.06
references:
  - packages/podkit-core/src/sync/executor.ts
  - packages/podkit-core/src/sync/video-executor.ts
  - packages/podkit-core/src/sync/types.ts
documentation:
  - doc-010
parent_task_id: TASK-186
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Goal:** Replace `DefaultSyncExecutor` (1872 lines) and `DefaultVideoSyncExecutor` (841 lines) with a single `UnifiedExecutor` that delegates per-operation execution to the `ContentTypeHandler`. This is the most complex unification step because the two executors have the greatest divergence.

**Depends on:** TASK-186.04 (handlers with execute() method), TASK-186.06 (unified planner produces SyncPlan)

---

### Design: Handler Owns Execution Strategy

The key insight: the handler's `execute()` method returns an `AsyncGenerator<OperationProgress>`. This means:

- **MusicHandler** can internally use its pipeline/queue architecture (download → prepare → transfer) and yield progress events as operations complete. The pipeline batching is an internal concern of the handler.
- **VideoHandler** executes sequentially (one video at a time, they're large) and yields progress events inline.

The unified executor doesn't need to know about pipelines vs sequential execution. It just iterates operations, calls `handler.execute()`, and collects results.

### Implementation

Create `packages/podkit-core/src/sync/unified-executor.ts`:

```typescript
interface UnifiedExecuteOptions {
  signal?: AbortSignal;
  continueOnError?: boolean;
  retryConfig?: RetryConfig;
  checkpointInterval?: number;
  onProgress?: (progress: ExecutorProgress) => void;
  onCheckpoint?: () => Promise<void>;
}

class UnifiedExecutor<TSource, TDevice> {
  constructor(
    private handler: ContentTypeHandler<TSource, TDevice>,
    private deps: ExecutorDependencies
  ) {}

  async *execute(
    plan: SyncPlan,
    options?: UnifiedExecuteOptions
  ): AsyncGenerator<ExecutorProgress, ExecuteResult> {
    let completed = 0;
    let failed = 0;
    let skipped = 0;
    const errors: CategorizedError[] = [];
    const warnings: ExecutionWarning[] = [];

    for (let i = 0; i < plan.operations.length; i++) {
      // Check abort signal
      if (options?.signal?.aborted) {
        return { completed, failed, skipped, errors, warnings, aborted: true };
      }

      const op = plan.operations[i];

      try {
        // Delegate to handler — yields progress events
        for await (const progress of this.handler.execute(op, {
          ipod: this.deps.ipod,
          signal: options?.signal,
          continueOnError: options?.continueOnError,
          retryConfig: options?.retryConfig,
          onCheckpoint: options?.onCheckpoint,
        })) {
          yield { ...progress, index: i, total: plan.operations.length };
        }
        completed++;
      } catch (error) {
        // Use shared error categorization (from TASK-186.02)
        const categorized = categorizeError(error, op);
        errors.push(categorized);
        failed++;

        yield {
          phase: 'error',
          operation: op,
          index: i,
          error,
          categorizedError: categorized,
        };

        if (!options?.continueOnError) break;
      }

      // Checkpoint
      if (options?.onCheckpoint && (completed + failed) % (options.checkpointInterval ?? 10) === 0) {
        await options.onCheckpoint();
      }
    }

    return { completed, failed, skipped, errors, warnings, aborted: false };
  }
}
```

### Migration: The Hard Parts

**1. Music pipeline architecture**

The music executor uses a three-stage pipeline with `AsyncQueue`:
- Stage 1 (Downloader): resolves FileAccess, downloads remote files
- Stage 2 (Preparer): transcodes files (CPU-bound)
- Stage 3 (Consumer): transfers to iPod (USB I/O)

This parallelism is critical for performance — while one file transcodes, another transfers to the iPod. In the unified model, this pipeline lives **inside `MusicHandler.execute()`**. The handler's execute method is called per-operation, but the handler can internally batch operations using its pipeline.

**Option A (simpler):** `MusicHandler.execute()` runs the full pipeline for each operation individually (no cross-operation parallelism). This is simpler but slower.

**Option B (preserve performance):** The MusicHandler maintains an internal pipeline. When `execute()` is called, it queues the operation and yields progress when it completes. The unified executor calls `execute()` for each operation sequentially, but the handler's internal pipeline processes them with overlap.

**Option C (recommended):** Add an optional `executeBatch()` method to ContentTypeHandler that receives the full operation list. The unified executor checks if the handler implements `executeBatch()` — if so, it delegates the entire operation list. If not, it falls back to per-operation `execute()`. This gives MusicHandler full control over its pipeline without forcing video to implement batching.

```typescript
interface ContentTypeHandler<TSource, TDevice> {
  // ... existing methods ...
  
  /** Optional: execute all operations with handler-controlled batching/pipelining */
  executeBatch?(
    operations: SyncOperation[],
    ctx: ExecutionContext
  ): AsyncGenerator<OperationProgress>;
}
```

**2. Retry logic placement**

After TASK-186.02, retry logic is in a shared module. The unified executor should apply retries at the operation level:
- Call `handler.execute(op)` 
- If it throws, categorize the error
- If retries remain for that category, re-call `handler.execute(op)`
- The retry loop wraps the handler call, not lives inside the handler

However, if using `executeBatch()` (Option C), the handler owns retries internally. The unified executor's retry logic is the fallback for per-operation execution.

**3. Checkpoint saves**

Both executors save the iPod database periodically (every N operations). The unified executor handles this — it calls `onCheckpoint` (which triggers `ipod.save()`) at the configured interval. This is already shared logic.

**4. Dry-run / placeholder executor**

The video executor has a `PlaceholderVideoSyncExecutor` for dry-run without an iPod. The unified executor should support this: if `dryRun` is set, skip `handler.execute()` and yield a `{ skipped: true }` progress event for each operation.

### Migration Steps

1. Create `unified-executor.ts` with the unified executor class
2. Implement the `executeBatch` path for MusicHandler, wrapping the existing pipeline logic
3. Implement the per-operation `execute` path for VideoHandler, wrapping existing sequential logic
4. Wire up the shared retry logic from TASK-186.02
5. Update CLI to create UnifiedExecutor with the appropriate handler
6. Verify all tests pass
7. Delete `DefaultSyncExecutor` and `DefaultVideoSyncExecutor`

### Testing

- Port existing executor tests to the unified implementation
- Verify: operations execute in correct order, progress events are yielded, errors are categorized, retries work, abort signal is respected, checkpoints fire at the right interval
- Performance test: verify music pipeline parallelism is preserved (if using executeBatch)
- Run `bun run test --filter podkit-core`

**Key files to create:**
- `packages/podkit-core/src/sync/unified-executor.ts`

**Key files to modify:**
- `packages/podkit-core/src/sync/handlers/music-handler.ts` — implement execute/executeBatch
- `packages/podkit-core/src/sync/handlers/video-handler.ts` — implement execute
- `packages/podkit-core/src/sync/executor.ts` — extract pipeline logic into handler, delete DefaultSyncExecutor
- `packages/podkit-core/src/sync/video-executor.ts` — extract operation logic into handler, delete DefaultVideoSyncExecutor
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A single UnifiedExecutor class handles execution for any content type by delegating to ContentTypeHandler
- [x] #2 ~Deferred~ MusicHandler.executeBatch() is a sequential stub — wrapping the 3-stage pipeline is deferred to a follow-up task. Music execution still goes through DefaultSyncExecutor which preserves the pipeline.
- [x] #3 VideoHandler executes operations sequentially
- [x] #4 Shared retry logic wraps handler execution at the operation level
- [x] #5 Abort signal is checked between operations and respected by handlers
- [x] #6 Checkpoint saves fire at configurable intervals
- [x] #7 Dry-run mode skips execution and yields skipped progress events
- [x] #8 DefaultVideoSyncExecutor deleted. DefaultSyncExecutor kept and un-deprecated — still the active music executor. Full removal deferred to music pipeline migration.
- [x] #9 All existing executor tests pass against the unified implementation
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#2: MusicHandler.executeBatch() is a sequential stub. The 3-stage async pipeline (download → prepare → transfer) lives in DefaultSyncExecutor and is too tightly coupled to extract without risk. Music execution still routes through DefaultSyncExecutor in the CLI, preserving performance. Follow-up: TASK-186.12.\n\nAC#8: DefaultVideoSyncExecutor deleted in deprecated wrappers removal pass. DefaultSyncExecutor kept and un-deprecated because music still uses it. Follow-up: TASK-186.12.
<!-- SECTION:NOTES:END -->
