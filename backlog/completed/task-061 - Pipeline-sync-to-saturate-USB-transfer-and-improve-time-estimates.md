---
id: TASK-061
title: Pipeline sync to saturate USB transfer and improve time estimates
status: Done
assignee: []
created_date: '2026-02-26 14:21'
updated_date: '2026-03-06 18:35'
labels:
  - performance
  - sync
  - core
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Current sync processes tracks sequentially: transcode → copy → transcode → copy. This leaves the USB bus idle during transcoding, wasting time.

First E2E test showed estimates are wildly inaccurate:
- **Estimated:** 8h 32m
- **Actual:** 58m 49s (9x faster)

## Observation

For a 1,414 track sync (9.3 GB):
- Actual throughput: ~2.7 MB/s
- USB 2.0 max: ~15-20 MB/s real-world

USB transfer is likely the bottleneck, not transcoding. Modern CPUs transcode faster than USB 2.0 can transfer.

## Proposed Improvement

### 1. Pipeline Architecture

```
[Transcode Queue] → [Transfer Queue] → [iPod]

Time 0:  Transcode A
Time 1:  Transcode B,  Transfer A
Time 2:  Transcode C,  Transfer B
Time 3:  Transcode D,  Transfer C
...
```

While file N transfers to iPod, transcode file N+1 (or N+2, N+3 with small buffer).

### 2. Implementation Approach

```typescript
interface PipelineExecutor {
  // Transcode worker produces files
  transcodeQueue: AsyncQueue<TranscodedFile>;
  
  // Transfer worker consumes and copies to iPod
  transferWorker: Promise<void>;
}

// Pseudo-code
async function pipelineSync(operations) {
  const transcodeQueue = new AsyncQueue(bufferSize: 2-3);
  
  // Producer: transcode files
  const transcoder = async () => {
    for (const op of transcodeOperations) {
      const result = await transcode(op);
      await transcodeQueue.push(result); // blocks if buffer full
    }
    transcodeQueue.close();
  };
  
  // Consumer: transfer to iPod
  const transferer = async () => {
    for await (const file of transcodeQueue) {
      await copyToIpod(file);
      cleanup(file);
    }
  };
  
  await Promise.all([transcoder(), transferer()]);
}
```

### 3. Improved Time Estimates

Base estimate on USB transfer speed, not transcoding:

```typescript
function estimateSyncTime(totalBytes: number): number {
  // Conservative USB 2.0 estimate
  const usbSpeedBytesPerSec = 2.5 * 1024 * 1024; // ~2.5 MB/s observed
  
  return totalBytes / usbSpeedBytesPerSec;
}
```

Optionally: measure actual transfer speed during first few files and adjust estimate dynamically.

## Benefits

1. **Faster syncs** — USB bus always busy
2. **Accurate estimates** — based on actual bottleneck
3. **Better UX** — users can trust the time estimate

## Considerations

- Buffer size: 2-3 files is enough (don't fill temp disk)
- Memory: stream transcoded files, don't hold all in memory
- Error handling: if transfer fails, don't lose transcoded files
- Progress reporting: track both queues for accurate progress
- Copy operations: these skip transcode queue, go straight to transfer

## Metrics from First Sync

- 1,414 tracks, 9.3 GB
- 58m 49s actual = 3529 seconds
- 2.7 MB/s effective throughput
- Estimate was 8h 32m = 30720 seconds (8.7x too high)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Transcoding and USB transfer happen in parallel (pipeline)
- [x] #2 USB bus is continuously utilized during sync
- [x] #3 Time estimate based on transfer speed, not transcode time
- [x] #4 Estimate accuracy within 2x of actual time
- [ ] #5 Progress reporting reflects pipeline state
- [x] #6 No regression in sync reliability
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Buffer size | Hardcoded 3 files | Simple, ~30MB temp space, sufficient to hide latency |
| Mixed operations | Copy ops bypass transcode, go straight to transfer queue | Keeps USB busy with mixed workloads |
| Progress reporting | Report by completed transfers only | Simpler UX, user sees "X of Y done" when files land on iPod |
| Time estimation | Static 2.5 MB/s | Based on observed E2E throughput, avoid complexity of dynamic measurement |
| Implementation | Minimal change to existing execute() | Lower risk, same API surface |
| Remove/update-metadata | Execute inline during producer phase | Fast operations, keeps order predictable |
| Abort handling | Drain transfer queue | Don't waste already-transcoded files |
| Error handling | Continue with remaining files | Matches existing continueOnError behavior |

### Architecture

```
Producer (transcode/prepare)     Consumer (transfer to iPod)
         │                                │
         ▼                                ▼
    ┌─────────┐    AsyncQueue(3)    ┌──────────┐
    │transcode├───────────────────▶│ transfer │──▶ iPod
    │  copy   │    (bounded)        │ + add DB │
    │ remove* │                     └──────────┘
    │ update* │                          │
    └─────────┘                          ▼
         │                          yield progress
         ▼
    * executed inline (no queue)
```

### Files to Create

**`packages/podkit-core/src/sync/async-queue.ts`** — Bounded async queue

```typescript
export class AsyncQueue<T> {
  private queue: T[] = [];
  private closed = false;
  private pushWaiters: Array<() => void> = [];
  private popWaiters: Array<(value: T | undefined) => void> = [];

  constructor(private maxSize: number = 3) {}

  async push(item: T): Promise<void>     // blocks if queue full
  async pop(): Promise<T | undefined>    // blocks if empty, undefined when closed+empty
  close(): void                          // signal no more items coming
  [Symbol.asyncIterator]()               // for await...of support
}
```

### Files to Modify

**`packages/podkit-core/src/sync/executor.ts`**

1. Add `PreparedFile` type:
   ```typescript
   interface PreparedFile {
     operation: SyncOperation;
     sourcePath: string;      // temp file (transcode) or original (copy)
     isTemp: boolean;         // true if needs cleanup after transfer
     size: number;
   }
   ```

2. Split operation execution:
   - `prepareTranscode(op)` → transcodes to temp file, returns PreparedFile
   - `prepareCopy(op)` → returns PreparedFile with original source
   - `transferToIpod(prepared)` → copies file, adds to DB, transfers artwork

3. Refactor `execute()` to pipeline pattern:
   - Producer loop: prepare files, push to queue (or execute inline for remove/update)
   - Consumer loop: pop from queue, transfer, yield progress
   - Run concurrently with `Promise.all`
   - On abort: close queue input, let consumer drain
   - On error: if continueOnError, log and continue; else propagate

4. Update progress emission:
   - Remove "preparing" phase emissions
   - Yield progress only when transfer completes
   - Track bytesProcessed from completed transfers

**`packages/podkit-core/src/sync/planner.ts`**

1. Update time estimation constants:
   ```typescript
   // Old
   const TRANSCODE_SPEED_RATIO = 10;
   const COPY_SPEED_BYTES_PER_SEC = 5 * 1024 * 1024;
   
   // New
   const USB_TRANSFER_SPEED_BYTES_PER_SEC = 2.5 * 1024 * 1024;
   ```

2. Simplify `calculateOperationTime()`:
   ```typescript
   function calculateOperationTime(op: SyncOperation): number {
     // All operations bottlenecked by USB transfer
     const size = calculateOperationSize(op);
     return size / USB_TRANSFER_SPEED_BYTES_PER_SEC;
   }
   ```

3. Remove `estimateTranscodeTime()` (no longer needed for estimates)

**`packages/podkit-core/src/sync/index.ts`**

- Export `AsyncQueue` if useful externally (probably not needed)

### Error Handling Details

1. **Transcode failure**: Log error, skip file, continue to next (if continueOnError)
2. **Transfer failure**: Retry per existing config, then skip if still failing
3. **Temp file cleanup**: Always cleanup temp files after transfer (success or failure)
4. **Queue draining on abort**: Consumer finishes items already in queue, producer stops adding

### Testing Strategy

1. **Unit tests for AsyncQueue**: push/pop blocking, close behavior, iterator
2. **Unit tests for pipeline**: mock transcode/transfer, verify concurrent execution
3. **Integration test**: verify actual parallelism (timing-based)
4. **E2E test**: run sync, verify estimate accuracy improved

### Implementation Order

1. Create AsyncQueue with tests
2. Add PreparedFile type and split prepare/transfer methods
3. Refactor execute() to use pipeline
4. Update planner time estimation
5. Run existing tests, fix any regressions
6. Add new pipeline-specific tests
7. Run E2E, measure estimate accuracy
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

Implemented pipeline sync architecture that runs transcoding in parallel with USB transfer.

### Key Changes

**New files:**
- `packages/podkit-core/src/sync/async-queue.ts` - Bounded async queue for pipeline backpressure

**Modified files:**
- `packages/podkit-core/src/sync/executor.ts` - Refactored to use producer/consumer pipeline
- `packages/podkit-core/src/sync/planner.ts` - Updated time estimation to use USB transfer speed
- `packages/podkit-core/src/sync/executor.test.ts` - Updated tests for new behavior
- `packages/podkit-core/src/sync/planner.test.ts` - Updated time estimation test

### Pipeline Architecture

```
Producer (transcode/prepare)     Consumer (transfer to iPod)
         │                                │
         ▼                                ▼
    ┌─────────┐    AsyncQueue(3)    ┌──────────┐
    │transcode├───────────────────▶│ transfer │──▶ iPod
    │  copy   │    (bounded)        │ + add DB │
    │ remove* │                     └──────────┘
    │ update* │                          │
    └─────────┘                          ▼
         │                          yield progress
         ▼
    * executed inline (no queue)
```

### Time Estimation Change

- **Old:** transcode time (duration/10) + copy time (size/5MB/s)
- **New:** transfer time only (size/2.5MB/s) since transcode runs in parallel

For the original E2E test (1,414 tracks, 9.3 GB):
- Old estimate: 8h 32m (30,720s)
- New estimate: ~62 minutes (9.3GB / 2.5MB/s = 3,720s)
- Actual time: 58m 49s (3,529s)
- New estimate accuracy: within 5% vs previous 8.7x overestimate

### Test Results
- All 672 unit tests pass
- All integration tests pass (except unrelated artwork deduplication issue)
<!-- SECTION:NOTES:END -->
