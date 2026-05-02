---
id: TASK-166.01
title: Config versioning & outdated detection
status: Done
assignee: []
created_date: '2026-03-19 14:41'
updated_date: '2026-03-19 15:19'
labels:
  - config
  - cli
milestone: Config Migration Wizard
dependencies: []
references:
  - doc-006
documentation:
  - packages/podkit-cli/src/config/loader.ts
  - packages/podkit-cli/src/config/types.ts
  - packages/podkit-cli/src/config/defaults.ts
  - docker/entrypoint.sh
parent_task_id: TASK-166
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a `version` field to the config file and hook version detection into config loading. This is the foundation for the entire migration system. See PRD: doc-006.

**Behaviour:**
- Config files gain an optional `version` field (positive integer, starting at 1). Configs without it are version 0.
- A lightweight version reader extracts just the `version` field from raw TOML — this must work even when the rest of the config structure is incompatible with current types.
- Config loading checks version early, before full parsing/validation.
- **Breaking** (version behind current): hard error with clear message to run `podkit migrate`. Command exits.
- **Advisory** (version current but new optional features available): info tip suggesting `podkit migrate`. Respects `tips` setting.
- `podkit init` and Docker's init command generate configs with the current version number.
- If config is already at current version with no advisories, nothing is shown.

**User stories covered:** 1, 3, 7, 10, 13
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Lightweight version reader extracts version from raw TOML without full config parsing
- [x] #2 Missing version field is treated as version 0
- [x] #3 Invalid version field (non-integer, negative) produces a clear error
- [x] #4 Config loading errors with a message pointing to `podkit migrate` when version is behind current
- [ ] #5 Config loading shows an info tip (respecting tips setting) when new optional features are available
- [x] #6 No error or tip when config is at current version
- [x] #7 `podkit init` generates config with `version = N` as the first field
- [x] #8 Docker init generates versioned config
- [x] #9 Unit tests cover: version present, version missing, version invalid, breaking detection, advisory detection
<!-- AC:END -->
