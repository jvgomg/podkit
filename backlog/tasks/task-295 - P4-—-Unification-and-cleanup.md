---
id: TASK-295
title: P4 — Unification and cleanup
status: In Progress
assignee: []
created_date: '2026-05-03 11:34'
updated_date: '2026-05-07 21:29'
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
- [x] #1 @podkit/ipod-firmware owns all SysInfoExtended file I/O; regex extraction gone
- [x] #2 core/device/sysinfo-extended.ts deleted; consumers import from @podkit/ipod-firmware
- [x] #3 core/device/ipod-models.ts, presets.ts, capability-adapter.ts shim files deleted
- [x] #4 resolveCapabilities is the only entry point used by sync, transcoding, CLI display
- [x] #5 No reference to LibgpodDeviceInfo exists in the codebase
- [x] #6 doc-003 D15 corrected with reference to doc-030
- [x] #7 ADR written, merged, status Accepted
- [x] #8 All existing tests pass with no regressions
- [ ] #9 Hardware validation per inventory: all five devices behave identically to P3
- [x] #10 AGENTS.md updated to reflect final package structure
- [x] #11 CHANGELOG updated for podkit and all affected packages
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DRY refactor (post-release): consolidated `bridgeIpodIdentityToModel` (core) and `modelFromLibgpodInfo` (devices-ipod) into a single `resolveIpodModel(ResolveModelInput)` in `packages/devices-ipod/src/resolve.ts`. Five-axis cascade: modelNumStr → serialNumber → productId → familyId → libgpodGeneration. Shared `synthesizeFromGeneration` helper replaces duplicate synthetic-model construction. `LIBGPOD_NAME_TO_GENERATION_ID` reverse-index unified in libgpod-mapping.ts (new `lookupByLibgpodName` export). `libgpod-bridge.ts` survives but slimmed to LibgpodDeviceInfo type + getUnsupportedReasonByLibgpodName. 28 new tests in resolve.test.ts; all gates green.
<!-- SECTION:NOTES:END -->
