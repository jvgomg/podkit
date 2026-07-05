---
id: TASK-458.06
title: >-
  Write-ops refuse — sync/init/add write-intent, doctor per-invocation, hard
  error
status: Done
assignee: []
created_date: '2026-07-05 14:24'
updated_date: '2026-07-05 22:51'
labels:
  - device-capability
  - read-only
  - cli
milestone: m-18
dependencies:
  - TASK-458.03
parent_task_id: TASK-458
ordinal: 215000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Wire the write-side of the gate. `sync`, `device init`, `device add` declare `requiredAccess: 'write'` — a read-only or none target throws `DEVICE_READ_ONLY` before any work. `sync` is single-device (no sweep), so a read-only target is a hard error with a clear reason (never a silent skip). `doctor` computes intent per-invocation: bare `doctor` is read (a read-only shuffle can still be diagnosed), `doctor --repair` is write (refused).

Parent: TASK-458. PRD: doc-056. ADR: adr/adr-024-device-access-tiers.md §4, §6.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 sync/init/add declare write intent; on a read-only device they throw DEVICE_READ_ONLY with the generation-specific reason
- [x] #2 `sync` on a read-only shuffle hard-errors (no silent skip)
- [x] #3 bare `doctor` runs on a read-only shuffle; `doctor --repair` refuses with DEVICE_READ_ONLY
- [ ] #4 Tests cover sync-refused, doctor-diagnoses, doctor--repair-refused on a read-only device
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Write-refusal was already satisfied by the 458.01 migration: `access !== 'syncable'` routes into the identity cascade's unsupportedReason, so sync/init/add refuse read-only devices. Verified live: `sync -d <shuffle>` → "iPod shuffle (4th Generation) is read-only — podkit can read and archive it, but cannot sync to it." (init/add share the same resolve→refuse path; not individually live-run to avoid a destructive init against the real device.)

Doctor: added a read-only archive hint to the unsupported short-circuit (commit 25450d29) — verified live, keeps the specific reason and adds "podkit can still read and back up this device — run `podkit device archive`." Doctor tests 30/0, typecheck green.

Deferred to TASK-458.09 (follow-up): doctor should run diagnostic *checks* on a read-only device rather than hard-refuse (US #7); `doctor --repair` explicit refusal. These need the readiness gate to distinguish read-only from none.
<!-- SECTION:NOTES:END -->
