---
id: TASK-294.10
title: P3.10 — Rename IpodIdentity → StoredIpodLink
status: Done
assignee: []
created_date: '2026-05-03 11:33'
updated_date: '2026-05-05 18:07'
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
- [x] #1 Existing IpodIdentity interface in core/device/types.ts renamed to StoredIpodLink
- [x] #2 All references in podkit-core, podkit-cli, config, tests updated
- [x] #3 No remaining references to the old name (grep -r 'IpodIdentity' returns only the new device-identity uses from @podkit/devices-ipod)
- [x] #4 All tests pass
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Renamed 4 files touched (1 declaration + 3 re-export sites):

- `packages/podkit-core/src/device/types.ts` — interface declaration renamed, JSDoc updated to clarify distinction from `@podkit/device-types` IpodIdentity
- `packages/podkit-core/src/device/index.ts` — re-export renamed
- `packages/podkit-core/src/index.ts` — public re-export renamed
- `packages/demo/src/mock-core.ts` — mock re-export renamed

No ambiguous-import disambiguation was needed: no file imports both types simultaneously. The `@podkit/device-types` IpodIdentity (firewireGuid, serialNumber, familyId) is untouched.

Backlog docs (doc-030, doc-034) and task files reference the old name as historical context — left as-is per spec.

Gates: podkit-core typecheck ✓, demo typecheck ✓, podkit-core unit tests 2509/2509 pass ✓, lint 0 errors ✓. Full `bun run typecheck` and `bun run build` both fail on the pre-existing empty @podkit/devices-ipod + @podkit/devices-mass-storage packages (no src/index.ts yet — another agent's in-progress work). The packages I touched all pass independently.
<!-- SECTION:FINAL_SUMMARY:END -->
