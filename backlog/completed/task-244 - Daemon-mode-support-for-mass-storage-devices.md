---
id: TASK-244
title: Daemon mode support for mass-storage devices
status: Done
assignee: []
created_date: '2026-03-24 23:52'
updated_date: '2026-03-25 01:20'
labels:
  - feature
  - daemon
milestone: 'Mass Storage Device Support: Extended'
dependencies:
  - TASK-234
  - TASK-240
references:
  - packages/podkit-docker/entrypoint.sh
  - packages/podkit-core/src/device/platforms/linux.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Docker daemon mode auto-syncs when devices are connected. Currently it only watches for iPod devices via the platform device manager's `findIpodDevices()`. Mass-storage devices configured with `type` and `path` are invisible to the daemon.

**What's needed:**
- Daemon should detect when configured mass-storage device paths become available (volume mounted)
- Trigger sync using MassStorageAdapter instead of IpodDatabase
- Handle device disconnection gracefully (volume unmounted mid-sync)

**Approach options:**
1. **Poll configured paths** — periodically check if `path` exists for configured mass-storage devices
2. **Filesystem watch** — watch parent directories (e.g., `/Volumes/`, `/media/`) for mount events
3. **udev/diskutil integration** — platform-specific mount event listeners

Option 1 is simplest and most portable. The daemon already has a polling loop for iPod detection.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Daemon detects when configured mass-storage device paths become available
- [x] #2 Daemon triggers sync for mass-storage devices using correct adapter
- [x] #3 Daemon handles mass-storage device disconnection gracefully
- [x] #4 Existing iPod daemon behavior unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented using the second-poller pattern: a separate `DevicePoller` with custom `scanMassStoragePaths()` scan function + a separate `SyncOrchestrator` with `noopMount`/`noopEject` runners.

Key design decisions:
- `PODKIT_MASS_STORAGE_PATHS` env var (colon/comma separated) configures paths to poll
- `scanMassStoragePaths()` checks if paths exist and are directories
- `noopMount` returns the configured path as `mountPoint` (device already mounted)
- `noopEject` is a no-op (external device management)
- Graceful shutdown handles both iPod and mass-storage orchestrators
- All existing iPod behavior unchanged — mass-storage poller only starts if paths configured
<!-- SECTION:NOTES:END -->
