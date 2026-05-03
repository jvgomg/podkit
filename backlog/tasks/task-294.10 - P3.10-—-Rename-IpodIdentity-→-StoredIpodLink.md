---
id: TASK-294.10
title: P3.10 — Rename IpodIdentity → StoredIpodLink
status: To Do
assignee: []
created_date: '2026-05-03 11:33'
labels:
  - device-capability-architecture
  - phase-3
milestone: m-18
dependencies: []
documentation:
  - >-
    backlog/docs/doc-034 -
    Spec-Phase-3-devices-ipod-and-devices-mass-storage-extraction.md
parent_task_id: TASK-294
ordinal: 10100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rename the existing `IpodIdentity` interface in `core/device/types.ts` (which means "config-side stored device link" — volumeUuid + volumeName) to `StoredIpodLink` everywhere in the codebase. This frees the `IpodIdentity` name for the new "live device identity" concept used by `@podkit/devices-ipod`.

Mechanical refactor; touches CLI, config, tests, docs. Single PR.

See spec doc-034, Scope > Core changes > Naming clean-up.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Existing IpodIdentity interface in core/device/types.ts renamed to StoredIpodLink
- [ ] #2 All references in podkit-core, podkit-cli, config, tests updated
- [ ] #3 No remaining references to the old name (grep -r 'IpodIdentity' returns only the new device-identity uses from @podkit/devices-ipod)
- [ ] #4 All tests pass
<!-- AC:END -->
