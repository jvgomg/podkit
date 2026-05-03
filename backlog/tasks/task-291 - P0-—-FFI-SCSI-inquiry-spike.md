---
id: TASK-291
title: P0 — FFI SCSI inquiry spike
status: To Do
assignee: []
created_date: '2026-05-03 11:28'
labels:
  - device-capability-architecture
  - phase-0
  - spike
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-030 - PRD-Device-Capability-Architecture.md
  - backlog/docs/doc-031 - Spec-Phase-0-FFI-SCSI-inquiry-spike.md
  - documents/device-identification.md
  - documents/test-devices.md
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Spike to validate that a TypeScript foreign-function-interface (`koffi`) can drive macOS IOKit SCSITaskUserClient and Linux SG_IO ioctl end-to-end against a real iPod. The outcome decides whether P1 commits to FFI on both platforms or falls back to a compiled helper binary on macOS.

This is a single 1–2 day spike, not split into sub-tasks. Output: throwaway code in `tools/scsi-spike/` plus a findings document with a clear go/no-go recommendation.

See spec doc-031 for full details.

Parent PRD: doc-030 (PRD: Device Capability Architecture).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Spike script reads SysInfoExtended XML via SCSI inquiry on macOS against a real iPod (preferably nano 2G — exercises SCSI-only path)
- [ ] #2 Spike script reads SysInfoExtended XML via SCSI inquiry on Linux against the same physical device
- [ ] #3 Output XML matches captured fixtures in documents/sysinfo-captures/ for the same device (modulo per-read crypto blob)
- [ ] #4 macOS run completes without sudo and without code-signing entitlements on macOS 14 or 15
- [ ] #5 Linux run completes against /dev/sgN or /dev/sdN with no new privilege requirements
- [ ] #6 Findings document records: working koffi patterns, IOKit interfaces, FFI gotchas, performance characteristics, clear go/no-go recommendation
<!-- AC:END -->
