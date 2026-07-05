---
id: TASK-458.04
title: >-
  Public docs — supported-devices matrix: Sync column, Confidence badge,
  Read-only split
status: Done
assignee: []
created_date: '2026-07-05 14:23'
updated_date: '2026-07-05 22:42'
labels:
  - device-capability
  - read-only
  - docs
milestone: m-18
dependencies:
  - TASK-458.01
parent_task_id: TASK-458
ordinal: 213000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update the public docs (`docs/devices/supported-devices.mdx`) to render the tri-state. The `DeviceCompatibilityTable` component gains a Sync column (Full / Read-only / Unsupported) and a Confidence badge (Hardware-verified / Inferred), both fed by `getSupportMatrix()` so they cannot drift from the code table. Split "Unsupported iPods" into "Read-only iPods" (shuffle 3g/4g — podkit reads/archives but can't sync) and true "Unsupported iPods." Add the shuffle read-only story to the "Device Not Mounting" troubleshooting section (the "connected but not mounted" case).

Ships via the `docs-live` branch flow — include the cherry-pick in the task, not as a surprise.

Parent: TASK-458. PRD: doc-056. ADR: adr/adr-024-device-access-tiers.md §7.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 DeviceCompatibilityTable renders a Sync column (Full/Read-only/Unsupported) + Confidence badge, sourced from getSupportMatrix()
- [x] #2 "Read-only iPods" is a distinct section from "Unsupported iPods"; shuffle 3g/4g listed as read-only/archivable
- [x] #3 "Device Not Mounting" troubleshooting covers the shuffle read-only case and the corrected error
- [ ] #4 Docs build succeeds; change is cherry-picked to docs-live per the release flow
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Commit 9ddc67f2. DeviceCompatibilityTable.astro gains Sync + Confidence columns read from getSupportMatrix() (a keys-only GENERATION_ID_CROSSWALK bridges @podkit/compatibility's libgpod ids to canonical matrix ids; an unmapped id throws at astro build, so drift can't render silently). New IpodAccessTable.astro renders Read-only + Unsupported sections from the matrix. supported-devices.mdx: split "Unsupported iPods" into "Read-only iPods" (shuffle 3g/4g + nano 6g, pointing at device archive) and true "Unsupported iPods"; Confidence reworded to hardware/inferred; troubleshooting gains the shuffle "not mounted" fix. docs-site build green (68 pages, links valid).

Notes: direct build-time import (workspace dep added, turbo ^build ordering) — no generated JSON needed. iPhone/iPad remain prose-only (not iPod generations, absent from the matrix). AC #4 (docs-live cherry-pick) is a release-flow step for later, not part of this branch.
<!-- SECTION:NOTES:END -->
