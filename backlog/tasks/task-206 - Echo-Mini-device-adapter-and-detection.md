---
id: TASK-206
title: Echo Mini device adapter and detection
status: Done
assignee: []
created_date: '2026-03-23 14:10'
updated_date: '2026-03-23 20:31'
labels:
  - superseded
milestone: "Additional Device Support: Echo Mini"
dependencies:
  - TASK-205
  - TASK-221
references:
  - devices/echo-mini.md
  - packages/podkit-core/src/device/types.ts
  - packages/podkit-core/src/device/manager.ts
documentation:
  - backlog/docs/doc-013 - Spec--Device-Capabilities-Interface.md
  - backlog/docs/doc-020 - Architecture--Multi-Device-Support-Decisions.md
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Superseded** — This placeholder task has been replaced by concrete tasks from the architecture discussion (DOC-020):

- **TASK-222** — DeviceAdapter interface and IpodDatabase refactor
- **TASK-223** — MassStorageAdapter implementation
- **TASK-224** — Config and detection support for non-iPod devices
- **TASK-225** — CLI multi-device support for device commands
- **TASK-226** — End-to-end validation: Echo Mini sync

See DOC-020 for the architectural decisions that informed this split.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Echo Mini DeviceCapabilities implemented with correct artworkSources, codec support, and max resolution
- [ ] #2 Config supports specifying device type to select Echo Mini capability preset
- [ ] #3 Config supports explicit capability overrides for custom/unknown devices
- [ ] #4 Sync engine correctly uses Echo Mini capabilities for transfer mode decisions
- [ ] #5 Device profile (devices/echo-mini.md) updated with implementation findings
<!-- AC:END -->
