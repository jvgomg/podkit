---
id: TASK-292
title: P1 — ipod-firmware SCSI delivery
status: In Progress
assignee: []
created_date: '2026-05-03 11:28'
updated_date: '2026-05-03 12:59'
labels:
  - device-capability-architecture
  - phase-1
milestone: m-18
dependencies:
  - TASK-291
documentation:
  - backlog/docs/doc-030 - PRD-Device-Capability-Architecture.md
  - backlog/docs/doc-032 - Spec-Phase-1-ipod-firmware-SCSI-delivery.md
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ship SCSI inquiry to users. Create `@podkit/device-types` and `@podkit/ipod-firmware` packages. Wire SCSI fallback into the existing `podkit doctor --repair sysinfo-extended` flow. Add two new doctor checks. Existing podkit-core device code stays untouched.

User-visible outcome: a user with an iPod mini 2G, nano 2G, or iPod 5G Video — devices where USB inquiry fails — can run `podkit doctor --repair sysinfo-extended` and have their device fully identified.

This is the parent task for the P1 phase. Sub-tasks cover bootstrapping, transports, orchestrator, doctor checks, and validation.

See spec doc-032 for full details.

Parent PRD: doc-030 (PRD: Device Capability Architecture).
Gated by: TASK-291 (P0 spike).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 @podkit/device-types and @podkit/ipod-firmware packages build, type-check, and pass tests in CI
- [ ] #2 inquireFirmware() returns a ParsedFirmware on each of the five inventory devices (mini 2G, nano 2G, nano 4G, nano 7G, iPod 5G Video)
- [ ] #3 On nano 4G and nano 7G (USB inquiry succeeds), inquireFirmware() uses USB and never invokes SCSI
- [ ] #4 On mini 2G, nano 2G, iPod 5G Video (USB inquiry fails), inquireFirmware() falls back to SCSI and produces a valid result
- [ ] #5 podkit doctor --repair sysinfo-extended writes SysInfoExtended successfully on all five devices
- [ ] #6 podkit doctor (no device) shows the new inquiry-methods system check
- [ ] #7 podkit doctor -d <device> shows the sysinfo-consistency device-scope check
- [ ] #8 Existing podkit-core, podkit-cli, libgpod-node tests pass with no regressions
- [ ] #9 Hardware validation per documents/device-testing-playbook.md Phase 3 on all five devices, recorded in documents/test-devices.md
- [ ] #10 P0 spike directory removed
- [ ] #11 Public API of the two new packages documented (TSDoc + README)
<!-- AC:END -->
