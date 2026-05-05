---
id: TASK-292.11
title: 'P1.11 — Documentation, AGENTS.md update, P1 release'
status: Done
assignee: []
created_date: '2026-05-03 11:30'
updated_date: '2026-05-03 15:58'
labels:
  - device-capability-architecture
  - phase-1
  - release
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-032 - Spec-Phase-1-ipod-firmware-SCSI-delivery.md
parent_task_id: TASK-292
ordinal: 8110
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Final P1 release prep. Package READMEs for `@podkit/device-types` and `@podkit/ipod-firmware`. TSDoc on all public exports. AGENTS.md updated with the two new package entries. Changeset entries. Remove tools/scsi-spike/. Release.

See spec doc-032, Migration steps 12–14.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 @podkit/device-types README written and accurate
- [x] #2 @podkit/ipod-firmware README written and accurate
- [x] #3 TSDoc on all public exports of both packages
- [x] #4 AGENTS.md monorepo structure updated to include both packages
- [x] #5 Changeset entries for podkit (doctor output changes), @podkit/core (sysinfo-extended internal change), @podkit/device-types, @podkit/ipod-firmware
- [x] #6 tools/scsi-spike/ directory removed from repo
- [ ] #7 P1 released through CI
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
READMEs: packages/device-types/README.md (~60 lines) and packages/ipod-firmware/README.md (~110 lines) written. TSDoc was mostly complete; added @param/@returns/@throws to readAllVpdSubpages, and @example blocks to parsePlist, inquireFirmware, and extractFromPlist. AGENTS.md: device-types and ipod-firmware added alphabetically to monorepo structure tree; 4 entry-point rows added to table. Changeset: single grouped changeset ipod-firmware-scsi-delivery.md covering all four packages (podkit minor, @podkit/core minor, @podkit/device-types minor, @podkit/ipod-firmware minor). tools/scsi-spike/ deleted; oxlint.json scsi-spike override removed; TASK-291 references updated from tools/scsi-spike/ paths to packages/ipod-firmware/ paths; TASK-292.12 and TASK-296 documentation lists updated similarly. AC #7 (P1 released through CI) is deferred — requires lead to git push after review.
<!-- SECTION:NOTES:END -->
