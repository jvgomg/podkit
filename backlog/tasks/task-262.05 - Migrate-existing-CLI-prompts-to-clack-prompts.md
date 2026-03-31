---
id: TASK-262.05
title: Migrate existing CLI prompts to @clack/prompts
status: To Do
assignee: []
created_date: '2026-03-31 15:27'
labels:
  - cli
  - ux
milestone: m-14
dependencies:
  - TASK-262.03
references:
  - doc-026
documentation:
  - packages/podkit-cli/src/commands/device.ts
  - packages/podkit-cli/src/commands/collection.ts
  - packages/podkit-cli/src/commands/migrate.ts
  - packages/podkit-cli/src/config/migrations/types.ts
parent_task_id: TASK-262
priority: medium
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace all remaining raw `readline`-based interactive prompts across the CLI with clack-backed equivalents from the prompt primitives layer.

Part of TASK-262 (Interactive Device Add Wizard). See doc-026 for full PRD.

**Locations to migrate:**
- `commands/device.ts` — confirm calls for add, remove, clear, reset, reset-artwork, scan mount prompt
- `commands/collection.ts` — remove confirmation (confirmNo)
- `commands/migrate.ts` — local confirm, select, and text implementations
- `config/migrations/` — MigrationPrompt interface implementation

Dependencies: TASK-262.03 (prompt primitives).

Covers PRD user story: 14.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All confirm/confirmNo calls in device.ts use clack-backed prompts
- [ ] #2 Collection remove confirmation in collection.ts uses clack-backed prompts
- [ ] #3 Migration system's local confirm, select, text replaced with clack-backed equivalents
- [ ] #4 MigrationPrompt interface backed by clack implementation
- [ ] #5 All existing interactive flows maintain the same behaviour (defaults, cancel handling)
- [ ] #6 No remaining raw readline usage in the CLI package
<!-- AC:END -->
