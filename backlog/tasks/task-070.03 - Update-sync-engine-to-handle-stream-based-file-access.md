---
id: TASK-070.03
title: Update sync engine to handle stream-based file access
status: Done
assignee: []
created_date: '2026-03-08 16:15'
updated_date: '2026-03-09 20:06'
labels:
  - core
  - sync
dependencies:
  - TASK-070.01
parent_task_id: TASK-070
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Summary

Modify sync executor to use `getFileAccess()` and handle both path and stream access types.

## Implementation

### 1. Add Stream Utility

Create `packages/podkit-core/src/utils/stream.ts`:

```typescript
import { createWriteStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

export async function streamToTempFile(
  getStream: () => Promise<ReadableStream | Readable>,
  expectedSize?: number
): Promise<string> {
  const tempPath = join(tmpdir(), `podkit-download-${randomUUID()}`);
  const stream = await getStream();
  
  // Handle both Web ReadableStream and Node Readable
  const nodeStream = 'pipe' in stream ? stream : Readable.fromWeb(stream);
  
  await pipeline(nodeStream, createWriteStream(tempPath));
  
  if (expectedSize !== undefined) {
    const stats = await stat(tempPath);
    if (stats.size !== expectedSize) {
      await unlink(tempPath);
      throw new Error(
        `Download verification failed: expected ${expectedSize} bytes, got ${stats.size}`
      );
    }
  }
  
  return tempPath;
}
```

### 2. Update Executor

In `packages/podkit-core/src/sync/executor.ts`, add helper:

```typescript
async function resolveTrackFile(
  adapter: CollectionAdapter,
  track: CollectionTrack
): Promise<{ path: string; cleanup?: () => Promise<void> }> {
  const access = await adapter.getFileAccess(track);
  
  if (access.type === 'path') {
    return { path: access.path };
  }
  
  const tempPath = await streamToTempFile(access.getStream, access.size);
  return {
    path: tempPath,
    cleanup: () => unlink(tempPath),
  };
}
```

### 3. Track Temp Files

Ensure all temp files are cleaned up after sync (success or failure).

## Files to Modify

- `packages/podkit-core/src/utils/stream.ts` (new)
- `packages/podkit-core/src/utils/index.ts` (export)
- `packages/podkit-core/src/sync/executor.ts`

## Testing

- Unit test `streamToTempFile` with mock streams
- Unit test size verification (pass and fail cases)
- Integration test: sync with DirectoryAdapter still works
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 streamToTempFile utility implemented and exported
- [x] #2 Size verification throws on mismatch
- [x] #3 Executor uses getFileAccess() for all file operations
- [x] #4 Temp files cleaned up after sync
- [x] #5 Existing sync tests pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Note:** This task can be developed in parallel with TASK-070.04 once the interface (070.01) is complete.
<!-- SECTION:NOTES:END -->
