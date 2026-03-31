---
id: TASK-262.04
title: Device Candidate Scanner
status: To Do
assignee: []
created_date: '2026-03-31 15:26'
labels:
  - device-detection
  - cross-platform
milestone: m-14
dependencies:
  - TASK-262.01
references:
  - doc-026
documentation:
  - packages/podkit-core/src/device/types.ts
  - packages/podkit-core/src/device/platforms/macos.ts
  - packages/podkit-core/src/device/platforms/linux.ts
parent_task_id: TASK-262
priority: medium
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a `scanCandidates()` function in podkit-core that combines device listing, iPod detection, USB identity lookup, removable/external filtering, and preset matching into a single call. Returns candidates grouped by physical USB device.

Part of TASK-262 (Interactive Device Add Wizard). See doc-026 for full PRD.

**Each group contains:**
- USB device identity (vendor/product ID, display name)
- Matched device preset (if USB IDs match a known profile), or null for unknown
- List of volumes with name, mount point, size, UUID

**Filtering rules:**
- Must be removable/external (not internal disks)
- Must be mounted
- Skip known system volumes (macOS Data, Recovery, EFI, Preboot)

**Ordering:** iPods first, then known mass-storage matches, then unknown removable volumes as generic candidates.

**Already-configured marking:** Volumes that match a configured device (by UUID) are flagged so the CLI can show them as non-selectable.

Dependencies: TASK-262.01 (USB enrichment + preset matching).

Covers PRD user stories: 2, 3, 8, 12.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 scanCandidates() returns candidates grouped by physical USB device
- [ ] #2 Groups include USB identity, matched preset, and volume list
- [ ] #3 Filters out internal disks, unmounted volumes, and system partitions
- [ ] #4 Candidates ordered: iPods first, then known mass-storage, then unknown/generic
- [ ] #5 Volumes matching configured devices (by UUID) are flagged as already-configured
- [ ] #6 Cross-platform: works on macOS (system_profiler) and Linux (lsblk hierarchy)
- [ ] #7 Unit tests with mock device data covering filtering, grouping, ordering, and preset matching
<!-- AC:END -->
