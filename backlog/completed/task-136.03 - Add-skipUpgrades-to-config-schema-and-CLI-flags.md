---
id: TASK-136.03
title: Add skipUpgrades to config schema and CLI flags
status: Done
assignee: []
created_date: '2026-03-14 13:56'
updated_date: '2026-03-14 15:22'
labels:
  - sync
  - cli
  - config
dependencies: []
references:
  - packages/podkit-cli/src/
  - packages/podkit-core/src/config/
  - docs/reference/config-file.md
parent_task_id: TASK-136
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add the `skipUpgrades` option to the config schema and CLI.

**Config schema:**
- Add `skipUpgrades` (boolean, default: false) as a global setting
- Add `skipUpgrades` to device config (overrides global)
- Resolution order: CLI `--skip-upgrades` → device `skipUpgrades` → global `skipUpgrades` → default (false)

**CLI:**
- Add `--skip-upgrades` flag to the `sync` command
- Pass resolved value through to the diff engine

**Dry-run output:**
- Show upgrade breakdown by category in the sync plan summary
- When `--skip-upgrades` is active, still detect and report available upgrades with a note that they're being skipped
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 skipUpgrades accepted in global config and device config
- [x] #2 skipUpgrades follows resolution order: CLI → device → global → default
- [x] #3 --skip-upgrades CLI flag works on sync command
- [x] #4 Dry-run output shows upgrade breakdown by category
- [x] #5 Skipped upgrades still shown in dry-run with explanatory note
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
### Implementation\n\n`skipUpgrades` added to:\n- Global config (`PodkitConfig`, `ConfigFileContent`)\n- Device config (`DeviceConfig`, `ConfigFileDevice`)\n- CLI flag (`--skip-upgrades` on sync command)\n\nResolution order: CLI → device → global → default (false). Follows exact same pattern as `artwork`.\n\nWired through to `computeDiff()` call in sync command. Config file reference docs updated with skipUpgrades in global/device tables and full example.\n\n10 tests covering parsing, type validation, merge/resolution, and CLI flag registration.
<!-- SECTION:NOTES:END -->
