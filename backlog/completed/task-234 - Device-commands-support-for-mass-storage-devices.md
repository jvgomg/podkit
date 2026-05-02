---
id: TASK-234
title: Device commands support for mass-storage devices
status: Done
assignee: []
created_date: '2026-03-24 19:18'
updated_date: '2026-03-24 22:09'
labels:
  - feature
  - cli
milestone: 'Additional Device Support: Echo Mini'
dependencies:
  - TASK-224
references:
  - packages/podkit-cli/src/commands/device.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update CLI device commands to work with non-iPod mass-storage devices. Currently all device commands hardcode `IpodDatabase.open()` and will crash or mislead when used with mass-storage devices.

**Blockers (commands that fail entirely):**
- `device info` — always tries to open iTunesDB; shows iPod-specific model/gen fields
- `device music` — unconditionally calls `IpodDatabase.open`; throws IpodError for mass-storage
- `device video` — same as music; should show "device does not support video" for Echo Mini
- `device add` — no `--type` option; offers to create iTunesDB on non-iPod devices; `type` field never saved to config

**Safety gates needed (iPod-only commands):**
- `device init` — no type gate; would attempt to write iTunesDB to mass-storage device
- `device reset` — no type gate; same risk as init
- `device clear` — no type gate; fails with IpodError but error message is wrong

**Lower priority:**
- `device scan` — only scans for iPods via `findIpodDevices()`; configured path-based devices never appear

For mass-storage devices:
- `device info` should show device type, mount point, capacity, track count, capabilities from preset
- `device music` should read tracks via `MassStorageAdapter.open()` and `getTracks()`
- `device add` needs `--type <type>` option, skip iTunesDB check for non-iPod types, write `type` to config
- iPod-only commands (init, reset, clear) should check device type and exit with "This command is only supported for iPod devices"
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 device info shows device-appropriate information for mass-storage devices (type, mount point, capacity, track count, capabilities)
- [x] #2 device music reads tracks from MassStorageAdapter for non-iPod devices
- [x] #3 device add supports --type option and saves device type to config
- [x] #4 device init/reset/clear show clear 'iPod only' error for mass-storage devices
- [x] #5 device scan shows configured path-based devices alongside auto-detected iPods
- [x] #6 Existing iPod device command behavior unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Video sync on mass-storage:** VideoPresenter calls `ipod.getInfo().device` which doesn't exist on MassStorageAdapter. Currently safe because Echo Mini preset has `supportsVideo: false`, but a `generic` device with `supportsVideo: true` would crash. Either:
- Gate video sync behind `isIpodDevice` in sync.ts (quick fix), or
- Refactor VideoPresenter to use DeviceAdapter (larger, future scope)

The quick gate should be added as part of this task's safety work.

## Details merged from TASK-225

- `podkit doctor` should route to device-appropriate diagnostics (deferred — not in current milestone)
- Device type display should be consistent across scan/info output (e.g., "Echo Mini", "iPod Classic 7G")
- `device video` should show "device does not support video" for devices with `supportsVideo: false`

## AC #4 completed (2026-03-24)

Safety gates added to: `device init`, `device reset`, `device clear`, `device reset-artwork`.
Video sync gate added in `sync.ts` — blocks video for non-iPod devices with appropriate messages.
All gates check `config.type` — undefined/ipod = allowed, anything else = blocked.

## AC #1, #2, #3, #5, #6 completed (2026-03-24)

**AC #1 (device info):** Mass-storage branch shows device type, mount point, storage, track counts, and preset capabilities. iPod path unchanged.

**AC #2 (device music):** Mass-storage branch opens MassStorageAdapter, maps DeviceTrack to DisplayTrack via shared helper. All output formats (stats/albums/artists/tracks + JSON/CSV/table) work.

**AC #3 (device add --type):** Added --type option with .choices() validation. Mass-storage flow requires --path, validates directory exists, saves type+path to config. iPod flow unchanged. Config writer updated to write type/path fields.

**AC #5 (device scan):** Shows configured mass-storage devices with connection status alongside auto-detected iPods.

**AC #6 (iPod unchanged):** All iPod paths preserved, no behavioral changes.

**Additional:** device video shows 'not supported' for devices without video capability. Helper functions added: isMassStorageDevice, getDeviceTypeDisplayName, deviceTrackToDisplayTrack. Review fixes: directory validation on --path, cleaner scan 'no devices' message, outputVideoTracks declaration ordering.
<!-- SECTION:NOTES:END -->
