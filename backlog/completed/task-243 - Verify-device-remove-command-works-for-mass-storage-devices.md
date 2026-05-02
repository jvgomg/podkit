---
id: TASK-243
title: Verify device remove command works for mass-storage devices
status: Done
assignee: []
created_date: '2026-03-24 23:52'
updated_date: '2026-03-25 01:04'
labels:
  - testing
  - cli
milestone: 'Mass Storage Device Support: Extended'
dependencies: []
references:
  - packages/podkit-cli/src/commands/device.ts
  - packages/podkit-cli/src/config/writer.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`podkit device remove` should work for mass-storage devices since it just removes the config entry, but it hasn't been tested with mass-storage device configs that have `type` and `path` fields instead of `volumeUuid` and `volumeName`.

**Verify:**
- Removing a mass-storage device config entry works correctly
- The TOML writer properly removes all mass-storage fields (type, path, capability overrides)
- No iPod-specific assumptions in the remove flow (e.g., checking for iTunesDB)
- Confirmation prompt shows appropriate device info (not iPod-specific)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 device remove successfully removes mass-storage device config
- [x] #2 All mass-storage fields cleaned up from TOML
- [x] #3 No iPod-specific errors or prompts shown
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Verified (2026-03-25)

Device remove is fully type-agnostic — no changes needed:
- Remove subcommand has no iPod-specific logic; confirmation prompt is generic
- `removeDevice()` in writer.ts uses regex-based TOML section removal that strips the entire `[devices.<name>]` block
- Automatically handles all mass-storage fields (type, path, capability overrides) since it removes the whole section, not individual fields
- No iPod-specific prompts or errors shown
<!-- SECTION:NOTES:END -->
