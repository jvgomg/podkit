---
id: TASK-040.05
title: Implement device capability APIs
status: Done
assignee: []
created_date: '2026-02-23 22:38'
updated_date: '2026-02-23 23:52'
labels:
  - libgpod-node
  - device
dependencies: []
parent_task_id: TASK-040
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Expose libgpod device capability checking APIs:

- `itdb_device_supports_artwork(device)` - Check artwork support
- `itdb_device_supports_video(device)` - Check video support  
- `itdb_device_supports_photo(device)` - Check photo support
- `itdb_device_supports_podcast(device)` - Check podcast support
- `itdb_device_read_sysinfo(device)` - Read SysInfo file
- `itdb_device_write_sysinfo(device)` - Write SysInfo file

Note: Some capability info is already exposed via DeviceInfo, but explicit boolean checks would be cleaner.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Device capability checks available as methods or properties
- [x] #2 SysInfo read/write operations exposed
- [x] #3 Integration tests verify capability detection
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Implemented device capability APIs for the libgpod-node package, exposing libgpod's device capability checking functions through the Node.js bindings.

## Changes

### Native Bindings (C++)
- **`packages/libgpod-node/native/database_wrapper.h`**: Added method declarations for `GetDeviceCapabilities()`, `GetSysInfo()`, and `SetSysInfo()`
- **`packages/libgpod-node/native/database_wrapper.cc`**: Implemented the three new methods:
  - `GetDeviceCapabilities()`: Returns an object with all capability flags (`supportsArtwork`, `supportsVideo`, `supportsPhoto`, `supportsPodcast`, `supportsChapterImage`) plus device identification info
  - `GetSysInfo(field)`: Reads a specific SysInfo field from the device
  - `SetSysInfo(field, value)`: Sets or removes a SysInfo field (pass null to remove)

### TypeScript Types
- **`packages/libgpod-node/src/types.ts`**: Added `DeviceCapabilities` interface with all capability flags and device identification
- **`packages/libgpod-node/src/binding.ts`**: Added native method signatures
- **`packages/libgpod-node/src/database.ts`**: Added public methods with full JSDoc documentation:
  - `getDeviceCapabilities()`: Get all device capabilities
  - `getSysInfo(field)`: Read SysInfo field
  - `setSysInfo(field, value)`: Set/remove SysInfo field
- **`packages/libgpod-node/src/index.ts`**: Exported `DeviceCapabilities` type

### Integration Tests
- **`packages/libgpod-node/src/__tests__/database.integration.test.ts`**: Added 4 new tests:
  - Device capabilities retrieval and field validation
  - SysInfo reading
  - SysInfo setting and removal
  - SysInfo persistence after save/reopen

## APIs Exposed

The following libgpod functions are now accessible via the bindings:
- `itdb_device_supports_artwork(device)`
- `itdb_device_supports_video(device)`
- `itdb_device_supports_photo(device)`
- `itdb_device_supports_podcast(device)`
- `itdb_device_supports_chapter_image(device)` (bonus - not in original spec)
- `itdb_device_get_sysinfo(device, field)`
- `itdb_device_set_sysinfo(device, field, value)`

Note: `itdb_device_read_sysinfo()` and `itdb_device_write_sysinfo()` are called automatically by libgpod during database parse and save operations, so they don't need explicit exposure.
<!-- SECTION:FINAL_SUMMARY:END -->
