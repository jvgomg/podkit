---
id: TASK-295
title: P4 — Unification and cleanup
status: To Do
assignee: []
created_date: '2026-05-03 11:34'
labels:
  - device-capability-architecture
  - phase-4
milestone: m-18
dependencies:
  - TASK-294
documentation:
  - backlog/docs/doc-030 - PRD-Device-Capability-Architecture.md
  - backlog/docs/doc-035 - Spec-Phase-4-Unification-and-cleanup.md
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Move SysInfoExtended file I/O into `@podkit/ipod-firmware`. Replace the regex-based plist extraction with the structured parser. Unify the capability resolution path through `resolveCapabilities`. Delete the re-export shims added in P3 and the libgpod-coupled adapter remnants. Refactor complete.

User-visible outcome: none. P4 is finalisation. The architecture established in P0–P3 is now the only path through the code; transitional scaffolding is gone.

This is the parent task for the P4 phase. Sub-tasks cover SysInfoExtended migration, resolveCapabilities unification, shim removal, doc-003 correction, ADR.

See spec doc-035 for full details.

Parent PRD: doc-030 (PRD: Device Capability Architecture).
Blocked by: TASK-294 (P3 main).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 @podkit/ipod-firmware owns all SysInfoExtended file I/O; regex extraction gone
- [ ] #2 core/device/sysinfo-extended.ts deleted; consumers import from @podkit/ipod-firmware
- [ ] #3 core/device/ipod-models.ts, presets.ts, capability-adapter.ts shim files deleted
- [ ] #4 resolveCapabilities is the only entry point used by sync, transcoding, CLI display
- [ ] #5 No reference to LibgpodDeviceInfo exists in the codebase
- [ ] #6 doc-003 D15 corrected with reference to doc-030
- [ ] #7 ADR written, merged, status Accepted
- [ ] #8 All existing tests pass with no regressions
- [ ] #9 Hardware validation per inventory: all five devices behave identically to P3
- [ ] #10 AGENTS.md updated to reflect final package structure
- [ ] #11 CHANGELOG updated for podkit and all affected packages
<!-- AC:END -->
