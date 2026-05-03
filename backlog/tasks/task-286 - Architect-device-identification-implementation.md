---
id: TASK-286
title: Architect device identification implementation
status: Done
assignee: []
created_date: '2026-05-02 15:44'
updated_date: '2026-05-03 11:38'
labels: []
milestone: m-18
dependencies: []
documentation:
  - documents/device-identification.md
  - documents/test-devices.md
  - documents/device-testing-playbook.md
  - packages/podkit-core/src/device/ipod-models.ts
  - packages/libgpod-node/native/gpod_binding.cc
  - packages/podkit-core/src/device/sysinfo-extended.ts
  - backlog/docs/doc-030 - PRD-Device-Capability-Architecture.md
  - backlog/docs/doc-031 - Spec-Phase-0-FFI-SCSI-inquiry-spike.md
  - backlog/docs/doc-032 - Spec-Phase-1-ipod-firmware-SCSI-delivery.md
  - backlog/docs/doc-033 - Spec-Phase-2-USB-inquiry-consolidation.md
  - >-
    backlog/docs/doc-034 -
    Spec-Phase-3-devices-ipod-and-devices-mass-storage-extraction.md
  - backlog/docs/doc-035 - Spec-Phase-4-Unification-and-cleanup.md
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design the implementation approach for improved device identification: SCSI inquiry support, device capability architecture, doctor checks, and inquiry method selection. This is a collaborative design task — go broad, think deeply, and work with the user to reach agreement before implementation begins.

Consider:
- Where SCSI inquiry code lives (native C++ binding, separate module, platform-specific TS with FFI)
- How to model hardcoded generation knowledge (checksum types, display names) alongside firmware-reported capabilities (artwork formats, codecs). What is the interface between these layers?
- How this interacts with the libgpod replacement work (m-8 ipod-db) — design for the future, not just the current libgpod dependency
- The write-back loop: when and how firmware-reported data gets written to the filesystem for libgpod
- Inquiry method selection logic (SCSI preferred, USB fallback)
- Platform-specific concerns: macOS IOKit SCSITaskUserClient, Linux SG_IO ioctl, heuristics for capability detection
- Doctor checks: reporting available inquiry methods, verifying consistency between filesystem and firmware data
- Package organisation — improve the codebase structure, don't bolt this on. Identify refactors and tech debt to address along the way.
- Ensure no stones are left unturned — review the living document thoroughly for open questions and edge cases.

Output: agreement with the user on the plan, followed by a backlog implementation spec document. The spec should be detailed enough for a separate task to pick up and implement.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Architecture proposal reviewed and agreed with user
- [x] #2 Refactors and tech debt opportunities identified
- [x] #3 All concerns from device-identification.md addressed or explicitly deferred with reasoning
- [x] #4 Implementation spec document created in backlog/docs/
- [x] #5 Spec covers: code location, interfaces, platform implementations, libgpod interaction, testing approach
- [x] #6 Follow-up implementation task created referencing the spec
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Architecture work complete. Outputs:

**PRD**: doc-030 (Device Capability Architecture) — covers four-package solution (`@podkit/device-types`, `@podkit/devices-ipod`, `@podkit/devices-mass-storage`, `@podkit/ipod-firmware`), Provider pattern for extensible enumeration, pure-functional preset registry, layered identity → capabilities resolution, and five-phase delivery (P0 spike → P1 SCSI ship → P2 USB consolidation → P3 data extraction → P4 unification).

**Phase specs**: doc-031 to doc-035 — each with acceptance criteria, file-level scope, function signatures, test plan, migration steps, risks.

**Implementation tasks**: 5 main + 42 sub-tasks created under m-18 (TASK-291 through TASK-295.09) with dependency chain P0 → P1 → P2 → P3 → P4 at the main-task level.

**Key architectural decisions** (documented in PRD, to be captured in ADR during P4):
- USB-first / SCSI-fallback inquiry selection (USB returns richer data on 5G+; SCSI works on more devices overall)
- FFI via koffi rather than additional native bindings (aligns with libgpod replacement direction)
- Provider pattern: pure values composed by caller, no global registry
- "Preset" is internal to devices-mass-storage; consumers think in terms of identity + capabilities
- Literal-plus-runtime-string union for IDs supports both strongly-typed programs and runtime-driven config

**Refactors bundled into the work** (P3): split readiness.ts into stages, reorganise ipod-models.ts by lookup-axis, unify duplicated ARTWORK_MAX_RESOLUTION, remove libgpod-coupled LibgpodDeviceInfo adapter, rename existing IpodIdentity → StoredIpodLink, open DeviceTypeId to runtime strings.

**Out of scope** (per user direction): generation table data corrections (B867, Touch checksum, missing model numbers, etc.) — handled separately.

Hardware testing on five real iPods (mini 2G, nano 2G, nano 4G, nano 7G, iPod 5G Video) confirmed SCSI inquiry works on all five, USB inquiry only on two — validating the SCSI-as-fallback architecture decision.
<!-- SECTION:FINAL_SUMMARY:END -->
