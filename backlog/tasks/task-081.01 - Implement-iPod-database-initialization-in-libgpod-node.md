---
id: TASK-081.01
title: Implement iPod database initialization in libgpod-node
status: Done
assignee: []
created_date: '2026-03-09 22:18'
updated_date: '2026-03-09 22:29'
labels:
  - libgpod-node
  - native
dependencies: []
parent_task_id: TASK-081
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Summary

Add the ability to create a new iTunesDB on an iPod that doesn't have one, via the libgpod-node bindings.

## Context

Currently `IpodDatabase.open()` only opens existing databases. We need a `create()` method (or similar) to initialize a fresh iPod.

## Requirements

1. **Create new iTunesDB** on a mounted iPod volume that has no existing database
2. **Detect iPod model** and configure database appropriately (artwork formats, video support, etc.)
3. **Create folder structure** (iPod_Control/iTunes, iPod_Control/Music, etc.)
4. **Handle SysInfo** if needed for artwork support
5. **Return IpodDatabase instance** ready for use

## API Design

```typescript
// Option A: Static factory method
const ipod = await IpodDatabase.create('/Volumes/IPOD', {
  model?: string;  // Optional model hint
});

// Option B: Separate function
const ipod = await createIpodDatabase('/Volumes/IPOD');
```

## Implementation Notes

- libgpod has `itdb_new()` and related functions for creating databases
- Check `gpod-tool init` implementation in `tools/gpod-tool/gpod-tool.c` for reference
- May need to call `itdb_device_set_sysinfo()` for proper model detection
- Master playlist must be created (see existing deviation docs)

## Testing

- Unit tests: Mock libgpod calls
- Integration tests: Create database in temp directory, verify structure
- E2E tests: Full flow with dummy iPod

## References

- `tools/gpod-tool/gpod-tool.c` - existing C implementation
- `packages/libgpod-node/README.md` - behavioral deviations documentation
- `docs/LIBGPOD.md` - libgpod integration notes
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 IpodDatabase.create() method implemented
- [x] #2 Creates valid iTunesDB structure
- [x] #3 Creates required folder structure (iPod_Control, etc.)
- [x] #4 Handles model detection appropriately
- [x] #5 Integration tests verify database creation
- [x] #6 Documented in libgpod-node README
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Complete

Added `Database.initializeIpod()` method that:

1. **Native binding** (`gpod_binding.cc`): Added `InitIpod()` function that:
   - Creates mountpoint directory with `g_mkdir_with_parents()`
   - Calls `itdb_init_ipod()` to create iPod structure
   - Parses the created database and returns it

2. **TypeScript API** (`database.ts`):
   - `Database.initializeIpod(mountpoint, options?)` - async
   - `Database.initializeIpodSync(mountpoint, options?)` - sync
   - `Database.IpodModels` - constants for common models

3. **Testing**: 7 new integration tests covering:
   - Basic initialization
   - Directory structure creation
   - Adding tracks and saving
   - Custom model and name
   - Synchronous API
   - Auto-creation of directories
   - Model constants validation

4. **Documentation**: Updated README with:
   - API usage examples
   - Model constants reference
   - When to use guidance
<!-- SECTION:NOTES:END -->
