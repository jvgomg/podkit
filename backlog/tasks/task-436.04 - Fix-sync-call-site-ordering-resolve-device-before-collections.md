---
id: TASK-436.04
title: 'Fix sync call-site ordering: resolve device before collections'
status: To Do
assignee: []
created_date: '2026-06-24 15:20'
labels:
  - sync
  - refactor
dependencies:
  - TASK-436.03
parent_task_id: TASK-436
ordinal: 185000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Behavior-neutral correctness-enabling refactor in the sync command.

Today collection resolution runs before the path/UUID-matched device config entry is fully bound, so any device-scoped defaulting would be silently skipped for devices not selected by literal name. Reorder so the target device (including path/UUID matches to a named `[devices.x]` entry) is resolved first, then call `resolveEffectiveCollections` once with the resolved device threaded in. Resolution stays global-only in this slice (the `device` input is passed but the cascade does not yet consult per-device defaults), so behavior is unchanged — this slice only puts the plumbing in the right order.

A raw, unconfigured by-path device must pass `device: undefined` (no config match) so it keeps falling back to global defaults.

Part of epic TASK-436. See PRD doc-050.

Context: PRD user stories 7, 8, 26 (enabling).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Device (incl. path/UUID match to a named config entry) is resolved before collections in the sync command
- [ ] #2 resolveEffectiveCollections is called once, after device resolution, with the resolved device passed in
- [ ] #3 Raw unconfigured by-path devices resolve with no device context (global-only)
- [ ] #4 Sync behavior is unchanged in this slice (still global-only cascade); existing sync tests pass
<!-- AC:END -->
