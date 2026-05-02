---
id: TASK-070.02
title: Update DirectoryAdapter to implement getFileAccess()
status: Done
assignee: []
created_date: '2026-03-08 16:15'
updated_date: '2026-03-09 20:01'
labels:
  - core
  - adapter
dependencies:
  - TASK-070.01
parent_task_id: TASK-070
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Summary

Update DirectoryAdapter to implement the new `getFileAccess()` method, returning path-based access.

## Implementation

In `packages/podkit-core/src/adapters/directory.ts`:

```typescript
getFileAccess(track: CollectionTrack): FileAccess {
  return {
    type: 'path',
    path: this.getFilePath(track),
  };
}
```

## Files to Modify

- `packages/podkit-core/src/adapters/directory.ts`

## Testing

- Add test verifying getFileAccess() returns `{ type: 'path' }`
- Existing DirectoryAdapter tests continue to pass
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 DirectoryAdapter implements getFileAccess()
- [x] #2 Returns { type: 'path', path: string }
- [x] #3 Unit test verifies return type
- [x] #4 Existing tests pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Implementation details are suggestions** - developers may choose different approaches as long as acceptance criteria are met.
<!-- SECTION:NOTES:END -->
