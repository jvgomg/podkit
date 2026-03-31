---
id: TASK-262.03
title: Adopt @clack/prompts and create prompt primitives
status: To Do
assignee: []
created_date: '2026-03-31 15:26'
labels:
  - cli
  - ux
milestone: m-14
dependencies: []
references:
  - doc-026
documentation:
  - packages/podkit-cli/src/utils/confirm.ts
parent_task_id: TASK-262
priority: medium
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add `@clack/prompts` as a dependency to `podkit-cli` and create a thin prompt abstraction layer that replaces the existing raw `readline` utilities.

Part of TASK-262 (Interactive Device Add Wizard). See doc-026 for full PRD.

**Prompt primitives to implement:**
- `confirm(message, default)` — yes/no with configurable default
- `text(message, default, placeholder)` — text input
- `select(message, choices, default)` — single selection
- `multiSelect(message, choices, defaults)` — multiple selection
- `note(message, title)` — passive display (for capability summaries)

**Non-interactive fallback:**
- Provide an interface so the wizard logic can be tested with canned answers
- Detect non-TTY and return defaults or error appropriately

This replaces `utils/confirm.ts` (confirm, confirmNo).

Dependencies: None — can start immediately.

Covers PRD user story: 14.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 @clack/prompts added as dependency to podkit-cli
- [ ] #2 Prompt abstraction layer provides confirm, text, select, multiSelect, and note primitives
- [ ] #3 Non-interactive fallback interface exists for testing and non-TTY environments
- [ ] #4 Existing utils/confirm.ts replaced with clack-backed implementation
- [ ] #5 All existing callers of confirm/confirmNo continue to work
<!-- AC:END -->
