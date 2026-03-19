---
id: TASK-074
title: Add Windows support for mount/eject commands
status: To Do
assignee: []
created_date: '2026-03-09 14:41'
updated_date: '2026-03-19 15:43'
labels:
  - cli
  - windows
  - cross-platform
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement Windows device management for the mount and eject CLI commands.

The `DeviceManager` abstraction already exists. Need to implement `WindowsDeviceManager` using appropriate Windows APIs.

Reference: TASK-068 implemented macOS support.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 eject command works on Windows
- [ ] #2 mount command works on Windows
- [ ] #3 Auto-detection of iPod devices on Windows
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Config migration CRLF note:** The config migration engine (`packages/podkit-cli/src/config/migrations/`) uses `content.split('\n')` and inserts lines with LF-only endings. On Windows, if a config file has CRLF line endings, migrated output will have mixed CRLF/LF endings. When adding Windows support, the migration engine should normalize line endings (or detect and preserve the file's original line ending style).
<!-- SECTION:NOTES:END -->
