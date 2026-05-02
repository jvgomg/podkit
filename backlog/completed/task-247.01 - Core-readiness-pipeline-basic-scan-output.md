---
id: TASK-247.01
title: Core readiness pipeline + basic scan output
status: Done
assignee: []
created_date: '2026-03-26 01:53'
updated_date: '2026-03-28 15:23'
labels:
  - feature
  - device
dependencies: []
references:
  - packages/podkit-core/src/device/readiness.ts
  - packages/podkit-core/src/device/types.ts
  - packages/podkit-core/src/device/assessment.ts
  - packages/podkit-core/src/diagnostics/types.ts
  - packages/podkit-cli/src/commands/device.ts
parent_task_id: TASK-247
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the core readiness pipeline engine and wire it into `device scan` with verbose check/cross output.

**PRD:** doc-023 | **Parent:** TASK-247

**Core pipeline (`packages/podkit-core/src/device/readiness.ts`):**
- 6-stage linear pipeline: USB Connected → Partitioned → Has Filesystem → Mounted (with iPod Structure) → Valid SysInfo → Has Database
- When a stage fails, subsequent stages are marked as skipped
- Each stage produces a `StageCheckResult` (pass/fail/warn/skip with details)
- Pipeline returns a `ReadinessResult` — discriminated union on `level` for exhaustive pattern-matching
- Readiness levels: `ready`, `needs-repair`, `needs-init`, `needs-format`, `needs-partition`, `hardware-error`, `unknown`
- iPod structure, SysInfo, and database checks are independently callable (for reuse by doctor)
- Pipeline is stateless and purely functional

**Architectural fit:**
- Readiness checks implement the existing `DiagnosticCheck` interface with `db` made optional in context
- Keeps one unified diagnostic system rather than two parallel frameworks
- Build on existing `assessDevice()` data rather than replacing it

**Scan integration (`packages/podkit-cli/src/commands/device.ts`):**
- Run full readiness pipeline on each discovered iPod
- Verbose per-check output with ✓/✗ markers
- Healthy devices show summary: "Ready — 1,234 tracks, 45 GB free"
- Track count requires DB open — treat as optional enhancement, degrade gracefully if DB open fails
- "No devices found" message unchanged when nothing connected
- Mass-storage devices shown with existing output + "readiness checks not applicable" note
- Unsupported platforms degrade gracefully (skip readiness, show devices as today)

**Edge cases to handle:**
- Device disconnect mid-pipeline: current stage fails gracefully with "device not found", collapses to `hardware-error`
- Stale mount points (macOS force-eject leaves dead dirs): verify mount is live via statfs, not just directory existence
- Read-only mounts (damaged FAT32): detect and report as a sub-check within mount stage — a read-only device passes readiness but with a warning
- Multiple partitions: operate per-partition (data partition), consistent with existing `findIpodDevices` behavior

**Performance:** Scan with healthy devices should complete in under 2s (fast path via diskutil/lsblk only).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Readiness pipeline runs 6 stages with fail→skip cascading
- [x] #2 ReadinessResult is a discriminated union on level
- [x] #3 iPod structure, SysInfo, and database checks callable independently
- [x] #4 device scan shows verbose check/cross output for each stage
- [x] #5 Healthy devices show track count and free space summary
- [x] #6 Mass-storage devices shown with note that readiness checks are not applicable
- [x] #7 Device disconnect mid-pipeline produces hardware-error (no crash)
- [x] #8 Read-only mount detected and reported as warning
- [x] #9 Stale mount points detected (statfs check)
- [x] #10 Unit tests for pipeline cascading, level determination, all stage results
- [ ] #11 E2E tests for scan on healthy device and device without DB
<!-- AC:END -->
