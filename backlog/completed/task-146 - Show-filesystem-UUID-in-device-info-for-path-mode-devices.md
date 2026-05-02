---
id: TASK-146
title: Show filesystem UUID in device info for path-mode devices
status: Done
assignee: []
created_date: '2026-03-18 02:24'
updated_date: '2026-03-23 19:31'
labels:
  - docker
  - ux
dependencies:
  - TASK-073
references:
  - packages/podkit-core/src/device/types.ts
  - packages/podkit-cli/src/commands/device.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When `podkit device info --device /path` is used, extract and display the filesystem UUID from the mount point. This helps users discover their iPod's UUID for use in device config or env vars.

**Implementation:** Add `getVolumeUuidForMountPoint(path)` to DeviceManager interface. On macOS, use `diskutil info`. On Linux, use `findmnt --output UUID --noheadings --target <path>` or parse `/dev/disk/by-uuid/` symlinks.

**Context:** Users need the UUID to configure multi-device setups where different iPods are mounted at the same path. Currently there's no way to discover the UUID from within podkit — users must use host-level tools like `lsblk` or `blkid`.

In the meantime, document the host-side commands in the Docker docs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 podkit device info --device /path shows the filesystem UUID
- [x] #2 Works on macOS (diskutil)
- [x] #3 Works on Linux (findmnt or equivalent)
- [x] #4 Gracefully skips UUID display when extraction is not supported
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added filesystem UUID display to `podkit device info` for path-mode devices. Uses the existing `getUuidForMountPoint()` method on the DeviceManager interface, which is already implemented for macOS (diskutil) and Linux (lsblk). UUID lookup is wrapped in try/catch so it gracefully skips when extraction fails. Changes limited to `packages/podkit-cli/src/commands/device.ts`: added `volumeUuid` to the status output type, added the lookup call after device path resolution, and added human-readable display for path-mode devices.
<!-- SECTION:FINAL_SUMMARY:END -->
