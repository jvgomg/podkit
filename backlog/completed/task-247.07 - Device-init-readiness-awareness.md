---
id: TASK-247.07
title: Device init readiness awareness
status: Done
assignee: []
created_date: '2026-03-26 01:55'
updated_date: '2026-03-28 15:43'
labels:
  - feature
  - device
dependencies:
  - TASK-247.01
references:
  - packages/podkit-cli/src/commands/device.ts
  - packages/podkit-core/src/ipod/database.ts
parent_task_id: TASK-247
priority: medium
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Enhance `podkit device init` to run readiness checks first and provide appropriate guidance based on device state.

**PRD:** doc-023 | **Parent:** TASK-247

**Behavior by readiness level:**
- `ready` → "Device is already initialized" (unless `--force`, which proceeds with reinit — preserves existing workflow)
- `needs-init` → proceed with existing init (create iPod_Control + iTunesDB + SysInfo)
- `needs-format` → stub with Disk Utility / iTunes guidance message
- `needs-partition` → stub with partitioning guidance message (MBR + FAT32 instructions)
- `needs-repair` → suggest `podkit device reset` to recreate DB + SysInfo
- `hardware-error` → report interpreted error, suggest checking cable/connection

**Implementation notes:**
- Only `device init` subcommand is modified; top-level `init` (config creation) is unrelated
- Consolidate DB existence check with `IpodDatabase.hasDatabase()` — avoid duplicate detection paths
- Stub code paths structured so format/partition implementation slots in later without restructuring

**User stories:** 3, 4, 10
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Readiness checks run before attempting init
- [x] #2 Each readiness level produces correct behavior and messaging
- [x] #3 --force on already-initialized device proceeds with reinit
- [x] #4 needs-format stub shows Disk Utility / iTunes manual guidance
- [x] #5 needs-partition stub shows MBR + FAT32 partitioning guidance
- [ ] #6 DB existence consolidated with IpodDatabase.hasDatabase()
- [x] #7 Stub code paths structured for future format/partition implementation
- [ ] #8 Unit tests for init behavior at each readiness level
- [ ] #9 E2E tests: init on uninitialized device, init on already-initialized device
<!-- AC:END -->
