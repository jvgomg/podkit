---
id: TASK-436.05
title: 'Add CollectionDefault type + per-device defaults schema, parse, validation'
status: To Do
assignee: []
created_date: '2026-06-24 15:20'
labels:
  - config
  - collections
dependencies:
  - TASK-436.02
  - TASK-436.03
parent_task_id: TASK-436
ordinal: 186000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add the types and config-loading plumbing for per-device defaults, with no resolver wiring yet (no new sync behavior).

- Introduce `CollectionDefault = string | false`.
- Add a nested in-memory `DeviceConfig.defaults?: { music?: CollectionDefault; video?: CollectionDefault }`, mirroring the top-level `DefaultsConfig`.
- TOML surface stays flat: parse `defaultMusic` / `defaultVideo` keys under `[devices.x]` and normalize them into the nested in-memory shape. Accept a string or `false`; reject any other type (notably `true`).
- Drive per-device default reference validation through the shared `validateRef` helper (from 436.02): warn on a string referencing a missing collection; `false` skips validation.

This slice ships only types + parse + validation; the cascade is not yet consulted at sync time.

Part of epic TASK-436. See PRD doc-050.

Context: PRD user stories 14, 15.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CollectionDefault type exists and DeviceConfig carries a nested defaults?.{music,video} shape
- [ ] #2 Flat defaultMusic/defaultVideo TOML keys parse and normalize into the nested in-memory shape
- [ ] #3 A string or false is accepted; true (and other non-string-non-false values) is rejected at parse
- [ ] #4 Per-device default string refs are validated via the shared validateRef helper (warn on missing; false skips)
- [ ] #5 Unit tests cover parse tri-state, normalization, and validation warnings
<!-- AC:END -->
