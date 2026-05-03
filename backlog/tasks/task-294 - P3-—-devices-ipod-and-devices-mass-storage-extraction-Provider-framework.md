---
id: TASK-294
title: P3 — devices-ipod and devices-mass-storage extraction + Provider framework
status: To Do
assignee: []
created_date: '2026-05-03 11:32'
labels:
  - device-capability-architecture
  - phase-3
milestone: m-18
dependencies:
  - TASK-293
documentation:
  - backlog/docs/doc-030 - PRD-Device-Capability-Architecture.md
  - >-
    backlog/docs/doc-034 -
    Spec-Phase-3-devices-ipod-and-devices-mass-storage-extraction.md
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Move iPod generation tables into `@podkit/devices-ipod`. Move mass-storage presets into `@podkit/devices-mass-storage` with a user-extensible registry framework. Add the Provider pattern and a unified, extensible enumeration framework to `podkit-core`. Bundle adjacent code-quality refactors that the moves naturally touch (split readiness.ts, unify ARTWORK_MAX_RESOLUTION, rename IpodIdentity, open DeviceTypeId).

User-visible outcome: Echo Mini and other mass-storage devices with known USB IDs are auto-detected at `device add` time. Capability resolution unchanged from the user's perspective.

This is the parent task for the P3 phase. Sub-tasks cover each new package, the framework, and each adjacent refactor.

See spec doc-034 for full details.

Parent PRD: doc-030 (PRD: Device Capability Architecture).
Blocked by: TASK-293 (P2 main).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 @podkit/devices-ipod and @podkit/devices-mass-storage packages exist, build, pass tests in CI
- [ ] #2 All capability resolution produces byte-identical DeviceCapabilities to pre-P3 code (snapshot parity)
- [ ] #3 device add auto-detects an Echo Mini by USB VID/PID without --type flag
- [ ] #4 device add --type my-walkman works with user-registered preset
- [ ] #5 Two Echo Minis can be configured with different overrides in the same program
- [ ] #6 core/device/readiness.ts replaced by readiness/ subdirectory with per-stage modules; tests pass
- [ ] #7 IpodIdentity (config-link) renamed to StoredIpodLink everywhere
- [ ] #8 usb-discovery.ts no longer hardcodes Apple VID; classification is providers' job
- [ ] #9 Re-export shims in core for ipod-models.ts, presets.ts, capability-adapter.ts in place
- [ ] #10 ARTWORK_MAX_RESOLUTION unified in @podkit/devices-ipod (no duplicate)
- [ ] #11 LibgpodDeviceInfo adapter type gone
- [ ] #12 CLI --type flag accepts any string; built-ins still autocomplete
- [ ] #13 Hardware validation per inventory: all five devices behave identically to P2
- [ ] #14 AGENTS.md updated with new package list
<!-- AC:END -->
