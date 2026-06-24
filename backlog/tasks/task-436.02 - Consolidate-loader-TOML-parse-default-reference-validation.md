---
id: TASK-436.02
title: Consolidate loader TOML parse + default-reference validation
status: To Do
assignee: []
created_date: '2026-06-24 15:19'
labels:
  - config
  - refactor
dependencies: []
parent_task_id: TASK-436
ordinal: 183000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Behavior-neutral refactor of `config/loader.ts`.

Collapse the ~30 copy-pasted "type-check primitive → validate enum → throw context-tagged error → assign" TOML scalar/enum parse blocks into a shared parse helper, retrofitting the existing call sites (use the existing capability-fields parser as prior art). Collapse the three copy-pasted default-reference validation blocks (`defaults.music`/`video`/`device`) into a single `validateRef(name, kind, registry)`-style helper.

This lands the shared helpers that the per-device feature slices build on, without changing any current behavior or warning text.

Part of epic TASK-436. See PRD doc-050.

Context: PRD user stories 24, 25.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Repeated scalar/enum TOML parse blocks in loader.ts are routed through one shared helper, with existing call sites retrofitted
- [ ] #2 The three default-reference validation blocks are collapsed into a single reusable validateRef helper
- [ ] #3 Existing loader tests pass with no behavior or warning-text changes
- [ ] #4 No new copy-pasted parse/validate block is introduced
<!-- AC:END -->
