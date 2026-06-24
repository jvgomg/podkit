---
id: TASK-436.06
title: Wire per-device cascade into resolveEffectiveCollections
status: To Do
assignee: []
created_date: '2026-06-24 15:20'
labels:
  - sync
  - collections
dependencies:
  - TASK-436.04
  - TASK-436.05
parent_task_id: TASK-436
ordinal: 187000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
First slice with new user-facing behavior.

Wire the per-device defaults into `resolveEffectiveCollections`: when a named device is present, consult `device.defaults.{music,video}` between the `-c` flag and the global default. Precedence per content type: `flag > device default > global default > none`. Model the cascade on `resolveChain`, with `false` ("none") short-circuiting as a sticky terminal-none via a guard before the chain (the same idiom the resolver already uses for `artwork === false`) — do not change the shared `resolveChain` contract. The `source` provenance now includes `device`.

A device without a config match still passes no device context (global-only); an explicit `-c` flag wins even over a device `false`.

Part of epic TASK-436. See PRD doc-050.

Context: PRD user stories 1, 2, 3, 4, 5, 6, 7, 8, 20, 26.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 resolveEffectiveCollections consults device.defaults.{music,video} for named devices with precedence flag > device > global > none
- [ ] #2 false on a device resolves to terminal 'none' (overrides global) without altering the shared resolveChain contract
- [ ] #3 An explicit -c flag overrides a device 'false'
- [ ] #4 Returned collections carry the correct source provenance (flag/device/global/none)
- [ ] #5 Unit tests cover the full precedence matrix: flag × device × global over {name, false, unset}, type filtering, and named-vs-absent device
<!-- AC:END -->
