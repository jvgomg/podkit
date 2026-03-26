---
id: TASK-247.03
title: USB discovery for unpartitioned devices
status: To Do
assignee: []
created_date: '2026-03-26 01:54'
labels:
  - feature
  - device
dependencies:
  - TASK-247.01
references:
  - packages/podkit-core/src/device/platforms/macos.ts
  - packages/podkit-core/src/device/platforms/linux.ts
  - packages/podkit-core/src/device/assessment.ts
parent_task_id: TASK-247
priority: medium
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Enhance device discovery to find iPods over USB even when they have no disk representation (unpartitioned/uninitialized devices).

**PRD:** doc-023 | **Parent:** TASK-247

**This is the highest-risk slice** due to platform-specific parsing fragility.

**New code path (not enhancing existing `assessDevice`):**
- macOS: query `system_profiler SPUSBDataType -json` independently of diskutil to find Apple devices (vendor 0x05ac) with known iPod product IDs
- Linux: read `/sys/bus/usb/devices/` for Apple vendor IDs with known iPod product IDs
- This is architecturally different from existing `assessDevice()` which only runs on devices diskutil already found

**Device filtering:**
- Only include devices with known iPod USB product IDs from existing lookup table
- Silently ignore other Apple devices (iPhones, iPads, AirPods)
- Recognize unsupported iPod models (Shuffle 3G/4G without disk mode) — provide specific "this device is not supported by podkit" message instead of misleading "needs-partition"

**Merge strategy with existing discovery:**
- Union of USB-discovered and disk-discovered devices, deduplicated by disk identifier
- USB-only devices (no disk representation) enter readiness pipeline at USB stage, fail at partition stage

**Fast path:** Only query USB subsystem when `findIpodDevices()` returns fewer devices than expected or when explicitly requested. Healthy devices found via diskutil skip the 2-3s system_profiler query.

**Docker/container:** Degrade gracefully when system_profiler / /sys/bus/usb/ are unavailable — skip USB discovery, rely on disk-based detection only.

**Risks:**
- system_profiler JSON structure varies across macOS versions and Apple Silicon hub topology
- /sys/bus/usb/ layout varies across kernel versions
- Needs extensive fixture-based tests with varied platform outputs

**User stories:** 1, 3, 19
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 macOS: system_profiler queried independently of diskutil for USB-only devices
- [ ] #2 Linux: /sys/bus/usb/devices/ scanned for Apple vendor IDs
- [ ] #3 Only known iPod product IDs included (iPhones, AirPods filtered out)
- [ ] #4 Unsupported iPod models (Shuffle 3G/4G) get specific not-supported message
- [ ] #5 USB-discovered and disk-discovered devices merged via union + dedup
- [ ] #6 Fast path: USB subsystem only queried when needed
- [ ] #7 Graceful degradation in Docker/containers (no crash if tools unavailable)
- [ ] #8 Fixture-based tests with varied macOS versions and Apple Silicon topology
- [ ] #9 Fixture-based tests with varied Linux kernel /sys layouts
- [ ] #10 Permission-denied on /sys/ handled gracefully
<!-- AC:END -->
