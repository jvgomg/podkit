---
id: TASK-052
title: Add iPod initialization command for fresh devices
status: Done
assignee: []
created_date: '2026-02-26 00:16'
updated_date: '2026-03-09 22:21'
labels:
  - cli
  - ipod
  - initialization
dependencies:
  - TASK-055
references:
  - tools/gpod-tool/gpod-tool.c
  - docs/LIBGPOD.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a CLI command to initialize a fresh/blank iPod with the required database structure.

**Context:**
- `podkit init` currently creates the config file
- There's no CLI command to initialize an iPod's database (iTunesDB, folder structure, SysInfo)
- The underlying `gpod-tool init` exists but isn't exposed through the CLI

**Requirements:**
1. Detect if iPod is already initialized vs. fresh
2. Handle different iPod models/generations correctly
3. Verify device compatibility before initialization
4. Create proper folder structure (iPod_Control, etc.)
5. Initialize iTunesDB with correct device-specific settings
6. Provide clear feedback about what was created

**Considerations:**
- Should this be `podkit ipod init` or `podkit device init` to distinguish from config init?
- Need to research what device-specific settings libgpod requires
- Should warn user if device doesn't look like an iPod (wrong filesystem, etc.)
- May need SysInfo file creation for artwork support

**References:**
- gpod-tool init implementation in `tools/gpod-tool/gpod-tool.c`
- libgpod device initialization docs
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Fresh iPod can be initialized via CLI
- [ ] #2 Different iPod models handled correctly
- [ ] #3 Device compatibility verified before init
- [ ] #4 Clear error messages for incompatible devices
- [ ] #5 Existing databases not overwritten without confirmation
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Blocked

This task is blocked by TASK-055 (Design init/setup command UX) - we need to decide the command structure before implementing.

Superseded by TASK-081 - Enhanced device onboarding and reset. Design decisions and implementation requirements captured in the new epic.
<!-- SECTION:NOTES:END -->
