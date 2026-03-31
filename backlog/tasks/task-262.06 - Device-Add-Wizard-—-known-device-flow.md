---
id: TASK-262.06
title: Device Add Wizard — known device flow
status: To Do
assignee: []
created_date: '2026-03-31 15:27'
labels:
  - cli
  - ux
  - device-detection
milestone: m-14
dependencies:
  - TASK-262.04
  - TASK-262.03
references:
  - doc-026
documentation:
  - packages/podkit-cli/src/commands/device.ts
  - packages/podkit-core/src/device/presets.ts
parent_task_id: TASK-262
priority: medium
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the interactive `device add` wizard for known device types (iPod, Echo Mini, Rockbox). This is the main wizard orchestration that activates when `podkit device add` is run with no flags in TTY mode.

Part of TASK-262 (Interactive Device Add Wizard). See doc-026 for full PRD.

**Interactive flow:**
1. Call candidate scanner, exit if no candidates found
2. Display grouped candidates with clack `select` — already-configured devices visible but not selectable
3. On selection: display capability summary passively (codecs, artwork, video, normalization from preset)
4. Prompt for device name (slugified suggestion with collision avoidance), quality preset, transfer mode — all with press-enter defaults
5. Final confirmation, then write config

**Config write strategy (known devices):**
- Always write: `type`, `path`, `volumeUuid`, `volumeName`, `quality`, `transferMode`
- Never write preset-derived capabilities (codec support, artwork settings, etc.)
- Quality and transfer mode written explicitly even if user accepted defaults

**Non-interactive behaviour:**
- Flags provided → skip wizard, use existing direct code paths
- Non-TTY + identifiable device → auto-accept defaults
- Non-TTY + ambiguous → error with usage hint

Dependencies: TASK-262.04 (candidate scanner), TASK-262.03 (prompt primitives).

Covers PRD user stories: 1, 4, 5, 7, 9, 10, 11, 15, 17.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Running `podkit device add` with no flags in TTY mode launches the interactive wizard
- [ ] #2 Candidates displayed grouped by physical USB device with USB identity in group header
- [ ] #3 Already-configured devices visible but not selectable
- [ ] #4 Selecting a known device shows capability summary (codecs, artwork, video, normalization)
- [ ] #5 Wizard prompts for name (with slugified suggestion), quality preset, and transfer mode
- [ ] #6 Name suggestion avoids collisions with existing configured devices
- [ ] #7 Config writes type, path, volumeUuid, volumeName, quality, transferMode only (no preset-derived values)
- [ ] #8 Quality and transfer mode written even when user accepts defaults
- [ ] #9 Existing flag-based paths (--type, --path, --device) continue to work unchanged
- [ ] #10 Non-TTY with identifiable device auto-accepts defaults
- [ ] #11 Non-TTY with missing required info errors with usage hint
- [ ] #12 Integration tests with mock prompts and mock scanner verify config output
<!-- AC:END -->
