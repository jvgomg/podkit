---
id: TASK-256
title: Auto-detect device type from USB identifiers
status: To Do
assignee: []
created_date: '2026-03-31 12:55'
labels:
  - ux
  - cli
  - device-detection
milestone: m-14
dependencies: []
references:
  - devices/echo-mini.md
  - packages/podkit-cli/src/commands/device.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Currently users must manually specify `--type echo-mini` when adding a mass-storage device. podkit should be able to detect the device type automatically from USB vendor/product IDs and manufacturer strings.

Discovered during Echo Mini E2E validation (TASK-226). The device profile (`devices/echo-mini.md`) already documents the USB identifiers:
- Vendor ID: `0x071b`
- Product ID: `0x3203`
- Manufacturer string: `ECHO MINI`

**Proposed behaviour:**
- When `--type` is omitted and `--path` points to a mounted volume, query USB metadata to match against known device profiles
- If a match is found, suggest/auto-select the preset and confirm with the user
- If no match, fall back to `generic` type or prompt the user
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When --type is omitted for a mass-storage device, attempt USB identifier matching against known device profiles
- [ ] #2 If matched, display the detected device type and confirm with user before proceeding
- [ ] #3 If no match, fall back gracefully to generic type or prompt
<!-- AC:END -->
