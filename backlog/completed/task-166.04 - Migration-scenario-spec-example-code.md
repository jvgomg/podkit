---
id: TASK-166.04
title: Migration scenario spec & example code
status: Done
assignee: []
created_date: '2026-03-19 14:42'
updated_date: '2026-03-19 15:36'
labels:
  - config
  - documentation
  - HITL
milestone: Config Migration Wizard
dependencies:
  - TASK-166.03
references:
  - doc-006
parent_task_id: TASK-166
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
HITL review: enumerate the concrete scenarios the migration system will handle and create documented example migrations for each. See PRD: doc-006.

**Scenarios to cover:**
1. **Breaking config restructure** — sections renamed or removed (e.g., `[video.*]` → `[tv.*]` + `[movies.*]`)
2. **Breaking field changes** — field type changes, removed fields, renamed fields
3. **New required fields with defaults** — a new field that must exist but has a sensible default
4. **New optional features** — advisory-level: feature exists but user hasn't configured it (e.g., a new transform)
5. **Deprecation with removal** — field is deprecated in version N, removed in version N+1
6. **Environment variable changes** — env vars renamed/removed; migration can't fix these but messaging should be clear

**Deliverables:**
- For each scenario: a documented example migration implementation that future developers can copy as a template.
- Examples should live alongside the migration registry as reference implementations with thorough inline comments.
- Validate that the migration interface (from slices 2 and 3) handles all scenarios ergonomically. If friction is found, adjust the interface before documenting.
- Each example should include a corresponding test case.

**User stories covered:** 11
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All six migration scenarios enumerated with concrete examples
- [x] #2 Each scenario has a documented example migration implementation with inline comments
- [x] #3 Example migrations are tested — each has at least one test case with input/output TOML
- [x] #4 Examples live alongside the migration registry as copyable templates
- [ ] #5 If the migration interface needed adjustments to handle a scenario, those adjustments are made
- [x] #6 Environment variable change scenario documents the messaging approach (since env vars can't be auto-migrated)
- [ ] #7 Review completed with developer — examples are clear and the interface is ergonomic
<!-- AC:END -->
