---
id: TASK-479.08
title: 'nano 7g is read-only, not unsupported — tier corrected from hardware'
status: Done
assignee: []
created_date: '2026-08-18 01:19'
updated_date: '2026-08-18 01:19'
labels:
  - identity
  - devices-ipod
  - data-quality
milestone: m-18
dependencies: []
parent_task_id: TASK-479
priority: high
ordinal: 251000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## What was wrong

`nano_7g` carried `access: 'none'`, `verified: 'inferred'`, justified in-code as "Not in libgpod's ipod_info_table — no mountable database podkit can use". Hardware contradicted every part of that: a real iPod nano 7G (16GB Green, serial `DCYN83SFF0GQ`) had `device info` report **1,414 tracks** read through libgpod's classic `iTunesCDB` parser, and `device archive` completed successfully.

The device genuinely cannot be written, but for a different reason: `nano_7g` uses `hashAB` database signing, and libgpod does not implement it — `itdb_hashAB.c:43-68` opens an external `hashab` blob from `LIBGPOD_BLOB_DIR` and fails closed when the symbol is absent. podkit ships no such blob.

So the correct tier is `read-only`: readable and archivable, sync refused — which is what the tri-state in ADR-024 exists for. Under `none`, `doctor` refused to run at all, so a device podkit can demonstrably read could not be diagnosed.

## What changed

- `packages/devices-ipod/src/tables/generations.ts` — tier and justification
- Refusal copy corrected wherever it repeated the false "not in libgpod's table" claim: `tables/unsupported.ts`, `libgpod-mapping.ts`, `device-types`, the docs site, and a VM expectation whose pinned headline was already stale
- Docs updated: `documents/formats/generations.md` (regenerated), `adr/adr-024-device-access-tiers.md`, `documents/architecture/device/identity-support-matrix.md`, `devices/ipod.md`, `documents/test-devices.md`

## Hardware verified afterwards

`device scan`, `device info`, `device music` and `doctor` all present the device coherently as read-only; `device archive` recorded 1,414 tracks with full identity. Confirmed across four nano 7G units (green, blue, space gray, pink).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 nano_7g is `access: 'read-only'`, `verified: 'hardware'`
- [x] #2 The justification names hashAB signing, not a libgpod table gap
- [x] #3 No user-facing string repeats the false claim
- [x] #4 Verified on hardware: read, list and archive succeed; sync still refuses
<!-- AC:END -->
