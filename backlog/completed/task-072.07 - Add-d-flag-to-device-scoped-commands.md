---
id: TASK-072.07
title: Add -d flag to device-scoped commands
status: Done
assignee: []
created_date: '2026-03-08 23:47'
updated_date: '2026-03-09 00:19'
labels:
  - cli
dependencies: []
parent_task_id: TASK-072
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add `-d <device>` flag to all commands that interact with a device:

- `podkit status [-d <device>]`
- `podkit list [-d <device>]`
- `podkit clear music|video [-d <device>]`
- `podkit reset [-d <device>]`
- `podkit mount [-d <device>]`
- `podkit eject [-d <device>]`

When omitted, use default device from config. Resolve device name to volumeUuid for auto-detection.
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Added `-d, --device-name <name>` flag to all device-scoped commands:

- `podkit status [-d <device>]`
- `podkit list [-d <device>]`
- `podkit clear music|video [-d <device>]`
- `podkit reset [-d <device>]`
- `podkit mount [-d <device>]`
- `podkit eject [-d <device>]`

## Changes

### New shared helper functions in `device-resolver.ts`:

1. **`resolveDeviceFromConfig(config, deviceName?)`** - Resolves a named device from config, falling back to default device or legacy ipod config
2. **`getConfigForDeviceResolution(config, resolvedDevice)`** - Creates a config object with the named device's volumeUuid for auto-detection
3. **`formatDeviceNotFoundError(deviceName, config)`** - Formats error message when a named device is not found

### Updated commands:

Each command now:
- Accepts `-d, --device-name <name>` option
- Resolves the named device from `config.devices[name]`
- Falls back to default device from `config.defaults.device`
- Uses the device's `volumeUuid` for auto-detection
- Existing `--device <path>` global option takes precedence

## Resolution Priority

1. CLI `--device <path>` flag (explicit path)
2. Named device from `-d <name>` flag
3. Default device from `config.defaults.device`
4. Legacy `config.ipod` fallback
5. Legacy `config.device` fallback

## Testing

All 384 tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
