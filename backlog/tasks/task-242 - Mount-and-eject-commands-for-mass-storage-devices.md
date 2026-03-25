---
id: TASK-242
title: Mount and eject commands for mass-storage devices
status: Done
assignee: []
created_date: '2026-03-24 23:52'
updated_date: '2026-03-25 01:04'
labels:
  - feature
  - cli
milestone: 'Mass Storage Device Support: Extended'
dependencies:
  - TASK-234
references:
  - packages/podkit-cli/src/commands/device.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`podkit device eject` and `podkit device mount` currently use platform device managers that assume iPod. They will likely fail or no-op for mass-storage devices.

For mass-storage devices:
- **Eject**: should unmount the volume (platform `umount`/`diskutil eject` equivalent). This is straightforward since we have the mount path.
- **Mount**: less clear — mass-storage devices are typically auto-mounted by the OS. May not be needed, or could attempt to mount a known path/UUID.

**Scope:**
- Audit current eject/mount implementations for iPod assumptions
- Add mass-storage support or clear "not supported" messages
- Test on macOS and Linux (the two supported platforms)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 device eject works for mass-storage devices (unmounts volume)
- [x] #2 device mount either works or shows clear 'not supported' message for mass-storage
- [x] #3 Existing iPod eject/mount behavior unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Completed (2026-03-25)

Updated all hardcoded 'iPod' strings in mount/eject commands to be device-type-aware:

- `device.ts` eject: uses `getDeviceLabel()` for error messages, status output
- `device.ts` mount: uses `getDeviceLabel()` for UUID lookup errors, mounting progress, success/failure messages
- `mount.ts` (root shortcut): same treatment, updated description
- `eject.ts` (root shortcut): same treatment, updated description

New helpers extracted to `open-device.ts`:
- `getDeviceTypeDisplayName()` — human-readable device type names
- `getDeviceLabel()` — convenience wrapper for user-facing messages

Existing iPod eject/mount behavior unchanged — `getDeviceLabel()` returns 'iPod' for undefined/ipod device types.
<!-- SECTION:NOTES:END -->
