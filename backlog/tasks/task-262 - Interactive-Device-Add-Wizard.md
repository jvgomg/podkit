---
id: TASK-262
title: Interactive Device Add Wizard
status: To Do
assignee: []
created_date: '2026-03-31 15:26'
updated_date: '2026-05-09 15:42'
labels:
  - ux
  - cli
  - device-detection
milestone: m-14
dependencies: []
references:
  - doc-026
documentation:
  - packages/podkit-cli/src/commands/device.ts
  - packages/podkit-core/src/device/presets.ts
  - packages/podkit-core/src/device/assessment.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parent task for the interactive device add wizard feature (doc-026).

Transform `podkit device add` into an interactive wizard (TTY mode) that scans for connected devices, presents them as selectable candidates grouped by physical USB device, and walks users through configuration with sensible defaults. Adopt `@clack/prompts` as the standard prompt library across the entire CLI.

See PRD: doc-026 - PRD: Interactive Device Add Wizard for full details.

This task subsumes TASK-256 (auto-detect device type from USB identifiers).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
UX observations from m-18 hardware sweep (TASK-312) on real Echo Mini hardware (`0x071b:0x3203`, two mountable volumes: `/Volumes/ECHO MINI` internal + `/Volumes/Echo SD` 126 GB ExFAT):

1. **Existing-config awareness**: `device add` doesn't notice when one of the device's volumes already has a config entry pointing at it (matched by Volume UUID or USB device fingerprint). The wizard should surface 'You already have an `echomini` config entry that points at /Volumes/Echo SD' and offer to (a) update its settings, (b) add the OTHER volume as a new device, or (c) cancel.

2. **Multi-volume handling**: Echo Mini exposes two volumes (firmware partition + SD card slot). Both can be valid sync targets in different scenarios. The wizard should list all mountable volumes, indicate which (if any) is already configured, and let the user pick — or pick multiple to add separately under different names.

3. **Copy-paste-ready commands**: when the wizard falls back to suggesting a non-interactive command (e.g., for scripting), the suggestion should fill in actual mount paths discovered, not `<mount-point>` placeholders. Real example user got: `podkit device add -d new-echo --type echo-mini --path <mount-point>` — should have been `--path '/Volumes/Echo SD'` (or list both volumes).

4. **Generic device serial caveat**: the Echo Mini's USB serial is `USBV1.00` (generic, shared across all units). USB-fingerprint-based 'is this the same device?' matching cannot rely on serial; must use Volume UUID per filesystem instead. The wizard's identity-of-device matcher should account for generic serials.

These all fold under TASK-262.04 (candidate scanner) + TASK-262.06 (known-device flow).
<!-- SECTION:NOTES:END -->
