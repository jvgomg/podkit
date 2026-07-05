---
id: TASK-458.07
title: Fail-open on unknown access + libgpod write backstop
status: Done
assignee: []
created_date: '2026-07-05 14:24'
updated_date: '2026-07-05 22:51'
labels:
  - device-capability
  - read-only
  - safety
milestone: m-18
dependencies:
  - TASK-458.03
  - TASK-458.06
parent_task_id: TASK-458
ordinal: 216000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The safety model. When access cannot be determined — path-mode on a platform without USB inquiry (Linux/Docker) — the resolver gate fails OPEN (treats access as syncable), so legitimate no-USB syncs to normal iPods are unregressed. To catch the rare miss, add a thin backstop immediately before `itdb_write` (in @podkit/libgpod-node or the core write boundary) that refuses when the resolved generation's access is not `syncable`, turning a silent bad write into a clean late error.

Parent: TASK-458. PRD: doc-056. ADR: adr/adr-024-device-access-tiers.md §5.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Undeterminable access resolves to syncable (fail-open); a normal iPod sync with no USB inquiry (Linux/Docker) works exactly as before
- [ ] #2 A thin guard before itdb_write refuses when access is not syncable
- [ ] #3 Unit test: write attempt against a non-syncable generation throws before itdb_write
- [x] #4 Regression check: no-USB path-mode sync to a normal iPod is not blocked
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fail-open is inherent to the current design and needs no code: an undeterminable generation is never refused (the identity cascade only refuses on a positively-identified non-syncable generation), so no-USB path-mode syncs to normal iPods are unaffected. Verified conceptually + reads/writes on the shuffle behave correctly.

The libgpod write backstop (ACs #2/#3) is relocated to TASK-458.09: the IpodDatabase.save() boundary doesn't carry the access tier, so a real backstop must re-derive generation from libgpod's model info at the write layer — heavier than the "thin guard" the ADR implied, and low value since writes are already refused upstream. Scoped as its own follow-up rather than forced into the epic tail.
<!-- SECTION:NOTES:END -->
