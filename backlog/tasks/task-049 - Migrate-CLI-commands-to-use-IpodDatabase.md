---
id: TASK-049
title: Migrate CLI commands to use IpodDatabase
status: Done
assignee: []
created_date: '2026-02-25 21:23'
updated_date: '2026-02-25 23:17'
labels:
  - podkit-cli
  - implementation
dependencies:
  - TASK-047
  - TASK-048
documentation:
  - doc-001
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Update CLI commands to use `IpodDatabase` from `@podkit/core` instead of directly importing `@podkit/libgpod-node`.

## Files to Modify

- `packages/podkit-cli/src/commands/status.ts`
- `packages/podkit-cli/src/commands/list.ts`
- `packages/podkit-cli/src/commands/sync.ts`

## Changes

### status.ts

```typescript
// Before
import { Database, LibgpodError } from '@podkit/libgpod-node';
const db = await Database.open(devicePath);
const info = db.getInfo();

// After
import { IpodDatabase, IpodError } from '@podkit/core';
const ipod = await IpodDatabase.open(devicePath);
const info = ipod.getInfo();
```

### list.ts

```typescript
// Before
const { Database } = await import('@podkit/libgpod-node');
const db = await Database.open(device);
const tracks = db.getTracks();
return tracks.map((t) => ({ ... }));

// After
const { IpodDatabase } = await import('@podkit/core');
const ipod = await IpodDatabase.open(device);
const tracks = ipod.getTracks();
// tracks are already IPodTrack with correct types
```

### sync.ts

```typescript
// Before
let libgpod: typeof import('@podkit/libgpod-node');
libgpod = await import('@podkit/libgpod-node');
db = await libgpod.Database.open(devicePath);
const ipodTracks = db.getTracks();
// Manual conversion to IPodTrackForDiff...
const executor = new core.DefaultSyncExecutor({ database: db, transcoder });

// After
const ipod = await IpodDatabase.open(devicePath);
const ipodTracks = ipod.getTracks();  // Already correct type
const executor = new core.DefaultSyncExecutor({ ipod, transcoder });
// Handle save warnings
const result = await ipod.save();
if (result.warnings.length > 0) { ... }
```

## Remove Direct libgpod-node Dependency

After migration, `podkit-cli` should NOT import from `@podkit/libgpod-node` directly.

## Tests

- Update CLI tests to work with new API
- Integration tests still pass
- E2E tests still pass

## Dependencies

- TASK-047 (IpodDatabase)
- TASK-048 (Executor update)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 status.ts uses IpodDatabase
- [x] #2 list.ts uses IpodDatabase
- [x] #3 sync.ts uses IpodDatabase
- [x] #4 No direct @podkit/libgpod-node imports in CLI
- [x] #5 All CLI tests pass
- [x] #6 Integration tests pass
- [x] #7 E2E tests pass
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Migrated all CLI commands to use `IpodDatabase` from `@podkit/core` instead of directly importing `@podkit/libgpod-node`. This completes the abstraction layer adoption in the CLI.

## Changes Made

### Commands Updated

1. **status.ts**
   - Replaced `Database`/`LibgpodError` imports with `IpodDatabase`/`IpodError` from `@podkit/core`
   - Changed `db` variable to `ipod`
   - Updated info access: `info.mountpoint` -> `info.mountPoint`

2. **list.ts**
   - Replaced dynamic `@podkit/libgpod-node` import with `@podkit/core`
   - Changed `Database` to `IpodDatabase`
   - Track property access: `t.ipodPath` -> `t.filePath`

3. **sync.ts**
   - Removed `libgpod` import entirely
   - Uses `IpodDatabase.open()` from core
   - Removed manual track type conversion (IPodTrack from IpodDatabase already correct)
   - Updated executor constructor: `{ database: db }` -> `{ ipod }`
   - Added `IpodError` handling for better error messages

### Test Files Updated

4. **sync.integration.test.ts**
   - Replaced all `Database` usage with `IpodDatabase`
   - Removed manual IPodTrack conversion (simplified tests significantly)
   - Updated imports

5. **status.integration.test.ts**
   - Replaced `Database` with `IpodDatabase`
   - Updated property access: `mountpoint` -> `mountPoint`
   - Error handling now checks for `IpodError`

### Dependency Cleanup

6. **package.json**
   - Removed direct `@podkit/libgpod-node` dependency from CLI
   - CLI now only depends on `@podkit/core` (which transitively depends on libgpod-node)

## Test Results

- Typecheck: Passes
- CLI unit tests: 185 passing
- E2E tests: 37 passing
- Lint: No new warnings

## Benefits

- CLI no longer has direct dependency on native bindings
- Track type conversion is now automatic
- Error handling is more consistent with IpodError
- Code is simpler and easier to maintain
<!-- SECTION:FINAL_SUMMARY:END -->
