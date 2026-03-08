---
id: TASK-070.06
title: Add unit tests for SubsonicAdapter
status: To Do
assignee: []
created_date: '2026-03-08 16:16'
updated_date: '2026-03-08 16:21'
labels:
  - test
  - unit
  - subsonic
dependencies:
  - TASK-070.04
parent_task_id: TASK-070
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Summary

Write comprehensive unit tests for SubsonicAdapter with mocked API responses.

## Test Cases

### Connection Tests
- `connect()` succeeds when ping returns OK
- `connect()` throws when server unreachable
- `connect()` throws on authentication failure

### Catalog Fetching Tests
- `getTracks()` returns empty array for empty library
- `getTracks()` correctly paginates through multiple album pages
- `getTracks()` handles albums with no songs
- `getTracks()` correctly maps all metadata fields
- `getTracks()` converts duration from seconds to milliseconds
- `getTracks()` detects lossless from suffix (flac, wav, aiff)
- `getTracks()` detects lossy from suffix (mp3, m4a, ogg)
- `getTracks()` caches results on second call

### File Access Tests
- `getFileAccess()` returns stream type
- `getFileAccess()` stream fetches from download endpoint
- `getFileAccess()` includes size when available
- `getFilePath()` throws with helpful error message

### Filter Tests
- `getFilteredTracks()` filters by artist
- `getFilteredTracks()` filters by album
- `getFilteredTracks()` filters by genre

## Mocking Strategy

Use `vi.mock('subsonic-api')` to mock the SubsonicAPI class:

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { SubsonicAdapter } from './subsonic.js';

vi.mock('subsonic-api', () => ({
  SubsonicAPI: vi.fn().mockImplementation(() => ({
    ping: vi.fn(),
    getAlbumList2: vi.fn(),
    getAlbum: vi.fn(),
    download: vi.fn(),
  })),
}));
```

## Files to Create

- `packages/podkit-core/src/adapters/subsonic.test.ts`

## Test Fixtures

Create mock response fixtures matching Subsonic API structure.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All connection scenarios tested
- [ ] #2 Pagination logic tested
- [ ] #3 Metadata mapping tested with edge cases
- [ ] #4 Lossless detection tested
- [ ] #5 Filter logic tested
- [ ] #6 Error cases tested
- [ ] #7 Tests pass with mocked API
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Implementation details are suggestions** - developers may choose different approaches as long as acceptance criteria are met.
<!-- SECTION:NOTES:END -->
