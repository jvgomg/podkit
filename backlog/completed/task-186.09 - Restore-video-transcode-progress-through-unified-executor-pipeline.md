---
id: TASK-186.09
title: Restore video transcode progress through unified executor pipeline
status: Done
assignee: []
created_date: '2026-03-22 09:53'
updated_date: '2026-03-22 12:00'
labels:
  - refactor
  - ux
dependencies: []
references:
  - packages/podkit-core/src/sync/handlers/video-handler.ts
  - packages/podkit-core/src/sync/unified-executor.ts
  - packages/podkit-core/src/sync/content-type.ts (OperationProgress)
  - packages/podkit-core/src/sync/types.ts (ExecutorProgress.transcodeProgress)
  - packages/podkit-cli/src/commands/sync.ts (syncCollection execution loop)
parent_task_id: TASK-186
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

After migrating video execution from `DefaultVideoSyncExecutor` → `VideoHandler` + `UnifiedExecutor`, the video transcode progress bar is lost. Previously users saw a per-percent progress bar during video transcoding (`[████░░░░] 42% 1.2x`). Now they only see text like "Transcoding: movie-name.m4v".

The progress data is lost at **three layers** in the pipeline. All three must be fixed.

## Root Cause Analysis

### Layer 1: VideoHandler doesn't capture transcode progress

**Files:** `packages/podkit-core/src/sync/handlers/video-handler.ts`

The `executeTranscode()` method (~line 342) calls `transcodeVideo()` but does NOT pass an `onProgress` callback:

```typescript
// Current (broken):
await transcodeVideo(source.filePath, tempOutputPath, settings, { signal });

// Needed:
await transcodeVideo(source.filePath, tempOutputPath, settings, {
  signal,
  onProgress: (p) => { /* yield progress */ }
});
```

The `transcodeVideo` function supports an `onProgress` callback that provides `{ percent: number, speed: string }`. This data needs to be captured and yielded as `OperationProgress` events with `phase: 'in-progress'` and the `progress` field set to 0-1.

Same issue in `executeUpgrade()` (~line 520) which also calls `transcodeVideo`.

### Layer 2: UnifiedExecutor batch path drops the `progress` field

**File:** `packages/podkit-core/src/sync/unified-executor.ts` (lines ~219-234)

When mapping `OperationProgress` → `ExecutorProgress` in the batch execution path, the code does NOT forward the `progress` field or the `transcodeProgress` data:

```typescript
// Current mapping (incomplete):
const execProgress: ExecutorProgress = {
  phase: ...,
  operation: progress.operation,
  // ... other fields
  // MISSING: transcodeProgress
};
```

The `ExecutorProgress` type (in `types.ts`) has a `transcodeProgress?: { percent: number; speed?: string }` field. This needs to be populated from the handler's progress events.

### Layer 3: UnifiedExecutor per-operation path also drops progress

**File:** `packages/podkit-core/src/sync/unified-executor.ts` (lines ~333-345)

Same issue in the per-operation execution path — the `progress` field from `OperationProgress` is not forwarded to the yielded `ExecutorProgress`.

## Implementation Plan

### Step 1: Extend OperationProgress (content-type.ts)

Add an optional `transcodeProgress` field to `OperationProgress`:

```typescript
export interface OperationProgress {
  operation: SyncOperation;
  phase: 'starting' | 'in-progress' | 'complete' | 'failed';
  progress?: number;
  error?: Error;
  skipped?: boolean;
  /** Video transcode progress details (percent + speed) */
  transcodeProgress?: { percent: number; speed?: string };
}
```

### Step 2: VideoHandler yields transcode progress (video-handler.ts)

In `executeTranscode()` and `executeUpgrade()`, use an async pattern to capture onProgress callbacks and yield them. Since `transcodeVideo` uses a callback (not async iterator), you'll need a mechanism to bridge callback → yield. Options:

**Option A (simplest):** Store latest progress, yield after transcodeVideo completes with final progress. This loses intermediate updates but is safe.

**Option B (recommended):** Use an async queue/channel pattern. The onProgress callback pushes to a queue, and the generator yields from it. This preserves real-time progress updates.

**Option C:** Make the execute generator yield progress before and after transcode, and have the CLI poll separately. Over-engineered.

Option B example pattern:
```typescript
async *executeTranscode(op, ctx): AsyncGenerator<OperationProgress> {
  // ... setup ...
  yield { operation: op, phase: 'in-progress', progress: 0 };

  const progressQueue: Array<{ percent: number; speed?: string }> = [];
  let resolveWaiter: (() => void) | null = null;
  let transcodeComplete = false;

  const transcodePromise = transcodeVideo(source.filePath, tempPath, settings, {
    signal: ctx.signal,
    onProgress: (p) => {
      progressQueue.push(p);
      resolveWaiter?.();
    },
  });

  // Yield progress events as they arrive
  const done = transcodePromise.then(() => { transcodeComplete = true; resolveWaiter?.(); });

  while (!transcodeComplete) {
    if (progressQueue.length === 0) {
      await new Promise<void>(r => { resolveWaiter = r; });
    }
    while (progressQueue.length > 0) {
      const p = progressQueue.shift()!;
      yield {
        operation: op,
        phase: 'in-progress',
        progress: p.percent / 100,
        transcodeProgress: { percent: p.percent, speed: p.speed },
      };
    }
  }

  await transcodePromise; // Ensure it completed (may throw)
  // ... post-transcode steps (add to iPod, etc.) ...
}
```

### Step 3: UnifiedExecutor forwards transcodeProgress

In both the batch path (lines ~219-234) and per-operation path (lines ~333-345), forward the `transcodeProgress` field:

```typescript
// Batch path:
const execProgress: ExecutorProgress = {
  // ... existing fields ...
  transcodeProgress: progress.transcodeProgress,
};

// Per-operation path (in-progress events):
yield {
  // ... existing fields ...
  transcodeProgress: progress.transcodeProgress,
};
```

### Step 4: Verify CLI displays progress bar

In `packages/podkit-cli/src/commands/sync.ts`, the `syncCollection()` execution loop should already handle `progress.transcodeProgress` — verify the `formatCurrentLineWithBar` branch works correctly when `transcodeProgress` is present.

## Testing

- Add test in `video-handler.test.ts` verifying that `executeTranscode` yields `OperationProgress` events with `transcodeProgress` data
- Add test in `unified-executor.test.ts` verifying that `transcodeProgress` flows from handler through to yielded `ExecutorProgress`
- Manual test: run `podkit sync -t video --dry-run` then a real sync to confirm the progress bar displays
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 VideoHandler.executeTranscode() and executeUpgrade() yield OperationProgress events with transcodeProgress data (percent + speed) during video transcoding
- [x] #2 UnifiedExecutor forwards transcodeProgress from handler OperationProgress to yielded ExecutorProgress in both batch and per-operation paths
- [x] #3 CLI video sync displays per-percent progress bar with speed indicator during video transcoding (same UX as before the unified pipeline migration)
- [x] #4 Unit tests verify transcode progress flows from handler through unified executor
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed all 4 layers:\n1. Added `transcodeProgress` field to `OperationProgress` in content-type.ts\n2. VideoHandler `executeTranscode()` and `executeUpgrade()` now use async queue pattern to bridge `transcodeVideo` onProgress callback → yielded OperationProgress events\n3. UnifiedExecutor forwards `transcodeProgress` in both batch and per-operation paths\n4. CLI `syncCollection()` restored `formatCurrentLineWithBar` for transcode progress display\n\nNew test file: video-handler-execution.test.ts (4 tests). 2 new tests in unified-executor.test.ts.">
<!-- SECTION:NOTES:END -->
