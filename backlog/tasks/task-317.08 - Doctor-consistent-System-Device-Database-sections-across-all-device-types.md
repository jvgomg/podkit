---
id: TASK-317.08
title: 'Doctor: consistent System / Device / Database sections across all device types'
status: To Do
assignee: []
created_date: '2026-05-09 15:59'
labels:
  - doctor
  - ux
  - architecture
milestone: m-18
dependencies: []
parent_task_id: TASK-317
priority: medium
ordinal: 35000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Doctor's output sectioning is inconsistent across device types. iPods get a clean three-section structure (`System` / `Device Readiness` / `Database Health`); Echo Mini and other mass-storage devices collapse everything into `Device Health` AND mis-categorize three system-scope checks as device-scope.

## Observed during m-18 sweep

**iPod path** (mini 2G example):

```
System
  ✓ Codec Encoders ...
  ✓ iPod Firmware Inquiry Methods ...
  ✓ Video Encoder (H.264) ...

Device Readiness
  ✓ USB Connection / Filesystem / Mounted / SysInfo / Database ...

Database Health
  ✓ Artwork / Orphan Files / SysInfoExtended consistency ...
```

**Echo Mini path**:

```
Device Health
  ✓ Codec Encoders                         <- system check, mis-labeled
  ✓ iPod Firmware Inquiry Methods          <- system check, mis-labeled (also iPod-specific!)
  ✓ Video Encoder (H.264)                  <- system check, mis-labeled
  ✓ Orphan Files (Mass Storage)            <- actual device-scope check
```

## Why this matters

1. **`--no-system` cannot reliably filter system checks** on non-iPod devices because they're rendered under `Device Health` at the output layer. The flag's filter operates on scope tags; if the tags are wrong, the filter doesn't match.
2. **Inconsistent UX** — users learning podkit on an iPod build a mental model (System → Device Readiness → Database Health) that breaks when they plug in mass-storage hardware.
3. **The iPod-specific `iPod Firmware Inquiry Methods` check is being run on Echo Mini and rendered under Device Health.** It's a system check (asks if iPodDriver.kext is present), not device-specific, and definitely shouldn't be shown for a non-iPod device.

## Underlying smell

Each check declares (or should declare) its scope: `system` vs `device-readiness` vs `database-health`. The renderer should bucket checks by their declared scope, not by per-device-type heuristics. Currently:

- For iPods: bucketing happens correctly via the readiness/diagnostic infrastructure.
- For mass-storage: the renderer falls back to a single bucket (`Device Health`) that swallows all checks regardless of scope.

Two parts to the fix:

1. **Make every check declare its scope** in metadata. Audit existing checks; tag each as `system`, `device-readiness`, or `database-health`. Re-use the existing readiness stage tagging where applicable.
2. **Renderer always groups by declared scope**, regardless of device type. Empty sections are omitted (so an Echo Mini that has no `Device Readiness` checks just doesn't show that header).
3. **Skip iPod-specific system checks on non-iPod devices.** `iPod Firmware Inquiry Methods` should not run when the active device is mass-storage.

## Acceptance Criteria
<!-- AC:BEGIN -->
See AC list. Real-hardware verification on iPod + Echo Mini.
<!-- SECTION:DESCRIPTION:END -->

- [ ] #1 Every diagnostic check declares its scope (`system` | `device-readiness` | `database-health`) in metadata.
- [ ] #2 Doctor's output renderer always groups checks by declared scope and emits the sections in a consistent order (`System` first, then device sections), regardless of device type.
- [ ] #3 Empty sections are omitted from output (e.g., a mass-storage device with no `Database Health` checks doesn't show that header).
- [ ] #4 iPod-specific system checks (`iPod Firmware Inquiry Methods`) are skipped on non-iPod devices. Replace with mass-storage-relevant system checks if needed (e.g., FAT/ExFAT/HFS+ tooling presence) — or just omit.
- [ ] #5 `--no-system` flag correctly filters out system checks on every device type (iPod, Echo Mini, Rockbox, generic).
- [ ] #6 iPod doctor output remains identical to the m-18 baseline (no regressions in the System / Device Readiness / Database Health structure).
- [ ] #7 Echo Mini doctor output now shows `System` (Codec Encoders, Video Encoder — NOT iPod Firmware Inquiry) followed by a device-scope section with `Orphan Files (Mass Storage)`.
- [ ] #8 Unit tests added: each check has its scope assertion; the renderer test confirms grouping logic with synthetic check sets.
- [ ] #9 Real-hardware verification: iPod (any of mini 2G / nano 4G / nano 7G) doctor output matches the established three-section structure; Echo Mini doctor output now has consistent section structure with system checks under `System`.
<!-- AC:END -->
