---
id: TASK-262.07
title: Device Add Wizard — generic device flow
status: To Do
assignee: []
created_date: '2026-03-31 15:27'
labels:
  - cli
  - ux
milestone: m-14
dependencies:
  - TASK-262.06
references:
  - doc-026
documentation:
  - packages/podkit-cli/src/commands/device.ts
  - packages/podkit-core/src/device/presets.ts
parent_task_id: TASK-262
priority: medium
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the device add wizard to handle generic/unknown devices with a full capability questionnaire.

Part of TASK-262 (Interactive Device Add Wizard). See doc-026 for full PRD.

When a user selects an unknown removable volume (no USB preset match), the wizard prompts for all capability settings with sensible defaults from the generic preset:

1. Device name (slugified volume name suggestion)
2. Quality preset (default: high)
3. Transfer mode (default: fast)
4. Supported audio codecs (multi-select, default: aac, mp3, flac)
5. Music directory (text input, default from generic preset)
6. Video support (confirm, default: no)
7. Artwork on/off + max resolution if on (default: on, 500px)
8. Audio normalization (select: none/replaygain, default: none)

**Config write strategy (generic devices):**
Write everything the user was asked about, regardless of whether it matches generic preset defaults. The config should be a complete, self-contained picture of what the user chose.

Dependencies: TASK-262.06 (known device wizard flow).

Covers PRD user stories: 6, 7, 16, 17.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Selecting an unknown volume in the wizard triggers the generic device questionnaire
- [ ] #2 Prompts for codecs (multi-select), music dir (text), video (confirm), artwork (confirm + resolution), normalization (select)
- [ ] #3 All prompts have sensible defaults from the generic preset
- [ ] #4 All user answers written to config explicitly, even if matching generic defaults
- [ ] #5 Integration tests with mock prompts verify full config output for generic devices
<!-- AC:END -->
