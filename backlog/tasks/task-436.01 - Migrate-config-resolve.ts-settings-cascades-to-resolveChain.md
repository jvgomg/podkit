---
id: TASK-436.01
title: Migrate config/resolve.ts settings cascades to resolveChain
status: To Do
assignee: []
created_date: '2026-06-24 15:19'
labels:
  - config
  - refactor
dependencies: []
parent_task_id: TASK-436
ordinal: 182000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Behavior-neutral refactor. Migrate the hand-written quality/audio/video/artwork cascades in `config/resolve.ts` (both global and device variants) onto the shared `resolveChain` primitive from `@podkit/device-types`, finishing the half-done migration the file already started for simple scalars.

Every existing source label (`global-quality`, `device-quality`, `unsupported`, `unknown`, etc.) and the capability-gating order (the explicit-`false` bypass and the unsupported/unknown checks) must be preserved exactly. Stop growing the parallel `ConfigSource` vocabulary; demote the thin `ResolvedValue<T>` alias toward the canonical `Resolved<T, Source>` where practical.

Part of epic TASK-436. See PRD doc-050.

Context: PRD user story 23.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 quality/audio/video/artwork global+device cascades in config/resolve.ts route through resolveChain (no hand-written if-ladders remain for these fields)
- [ ] #2 Capability gating (explicit-false bypass, unsupported/unknown precedence) is unchanged
- [ ] #3 Existing config/resolve.test.ts passes with no assertion changes attributable to this refactor
- [ ] #4 No new *Source provenance union is introduced
<!-- AC:END -->
