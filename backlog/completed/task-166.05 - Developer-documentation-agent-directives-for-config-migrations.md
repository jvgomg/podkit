---
id: TASK-166.05
title: Developer documentation & agent directives for config migrations
status: Done
assignee: []
created_date: '2026-03-19 14:42'
updated_date: '2026-03-19 15:36'
labels:
  - documentation
milestone: Config Migration Wizard
dependencies:
  - TASK-166.04
references:
  - doc-006
documentation:
  - AGENTS.md
  - docs/developers/development.md
  - docs/reference/config-file.md
parent_task_id: TASK-166
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update developer-facing documentation and agent directives so that future developers and AI agents know about the config migration system and how to use it. See PRD: doc-006.

**Updates needed:**

1. **AGENTS.md** — Add a new section on config migrations alongside existing sections on ADRs, changesets, and testing. Should cover:
   - When a migration is needed (breaking config changes, new required fields, section restructures)
   - When a migration is NOT needed (new optional fields with defaults, internal-only changes)
   - How to create a migration (point to example migrations from TASK-166.04)
   - The relationship between config versions and migrations

2. **Developer guide** (`docs/developers/`) — Add documentation covering:
   - How the config versioning system works (version field, detection, severity levels)
   - How to add a new migration step by step
   - How to test migrations
   - Pointers to the example migrations as templates
   - How interactive vs automatic migrations differ

3. **Config reference** (`docs/reference/config-file.md`) — Document the `version` field.

4. **`podkit init` documentation** — Update if the generated config format changed.

**User stories covered:** 11, 12
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 AGENTS.md has a config migrations section covering when to create migrations, how to create them, and pointers to examples
- [x] #2 Developer guide has a page or section explaining the versioning system, migration creation workflow, and testing approach
- [x] #3 Config reference documents the `version` field
- [x] #4 `podkit init` documentation reflects versioned config generation
- [x] #5 A developer or AI agent reading only AGENTS.md and the developer guide can create a new migration without looking at existing migration code
<!-- AC:END -->
