---
id: TASK-262
title: Interactive Device Add Wizard
status: To Do
assignee: []
created_date: '2026-03-31 15:26'
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
