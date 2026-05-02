---
id: TASK-286
title: Architect device identification implementation
status: To Do
assignee: []
created_date: '2026-05-02 15:44'
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
- [ ] #1 Architecture proposal reviewed and agreed with user
- [ ] #2 Refactors and tech debt opportunities identified
- [ ] #3 All concerns from device-identification.md addressed or explicitly deferred with reasoning
- [ ] #4 Implementation spec document created in backlog/docs/
- [ ] #5 Spec covers: code location, interfaces, platform implementations, libgpod interaction, testing approach
- [ ] #6 Follow-up implementation task created referencing the spec
<!-- AC:END -->
