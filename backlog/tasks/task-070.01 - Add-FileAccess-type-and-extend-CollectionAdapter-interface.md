---
id: TASK-070.01
title: Add FileAccess type and extend CollectionAdapter interface
status: To Do
assignee: []
created_date: '2026-03-08 16:15'
updated_date: '2026-03-08 16:21'
labels:
  - core
  - interface
dependencies: []
parent_task_id: TASK-070
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Summary

Add unified `FileAccess` type to support both local paths and remote streams. This is the foundational interface change for remote source support.

## Implementation

### 1. Add FileAccess Type

In `packages/podkit-core/src/adapters/interface.ts`:

```typescript
/**
 * Unified file access - supports both local and remote sources
 */
export type FileAccess =
  | { type: 'path'; path: string }
  | { type: 'stream'; getStream: () => Promise<ReadableStream>; size?: number };
```

### 2. Add getFileAccess() to CollectionAdapter

```typescript
export interface CollectionAdapter {
  // ... existing methods unchanged

  /**
   * Get file access for a track
   * Local adapters: { type: 'path', path: '/absolute/path.flac' }
   * Remote adapters: { type: 'stream', getStream: () => ..., size: 12345 }
   */
  getFileAccess(track: CollectionTrack): FileAccess | Promise<FileAccess>;
}
```

### 3. Deprecate getFilePath()

Add JSDoc deprecation notice but keep for backward compatibility.

## Files to Modify

- `packages/podkit-core/src/adapters/interface.ts`
- `packages/podkit-core/src/index.ts` (export new type)

## Testing

- TypeScript compilation validates interface
- Type tests if using vitest type testing
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FileAccess type defined and exported
- [ ] #2 getFileAccess() added to CollectionAdapter interface
- [ ] #3 getFilePath() has @deprecated JSDoc tag
- [ ] #4 TypeScript compiles without errors
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Implementation details are suggestions** - developers may choose different approaches as long as acceptance criteria are met.
<!-- SECTION:NOTES:END -->
