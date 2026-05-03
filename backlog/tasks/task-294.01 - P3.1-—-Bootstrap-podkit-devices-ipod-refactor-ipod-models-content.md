---
id: TASK-294.01
title: P3.1 — Bootstrap @podkit/devices-ipod; refactor ipod-models content
status: To Do
assignee: []
created_date: '2026-05-03 11:32'
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
ordinal: 10010
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the `@podkit/devices-ipod` package skeleton. Move the content of `podkit-core/device/ipod-models.ts` (2,013 lines) into the new package, refactored into the file structure from spec doc-034:

- tables/generations.ts, usb-ids.ts, serials.ts, model-numbers.ts, artwork-formats.ts, libgpod-mapping.ts
- lookups.ts (consolidated lookup functions)
- identity.ts (identify() facade replacing resolveIpodModel)

Types (ChecksumType, IpodGeneration, IpodGenerationId, IpodModel, IpodModelVariant) move with the data. IpodGenerationId becomes a literal-plus-runtime union.

See spec doc-034, Scope > New package: @podkit/devices-ipod.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 packages/devices-ipod/ exists with package.json, build script, test runner
- [ ] #2 ipod-models.ts content fully migrated; tables organised by lookup-axis
- [ ] #3 lookups.ts exports lookupByUsbId, lookupBySerial, lookupByModelNumber, lookupGenerationInfo
- [ ] #4 identity.ts exports identify(input) facade replacing resolveIpodModel
- [ ] #5 Existing ipod-models tests run against the new module structure and pass
- [ ] #6 IpodGenerationId is a literal-plus-runtime union (const array + literal type + string companion)
<!-- AC:END -->
