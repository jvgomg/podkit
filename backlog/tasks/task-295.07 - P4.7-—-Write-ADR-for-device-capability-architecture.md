---
id: TASK-295.07
title: P4.7 — Write ADR for device capability architecture
status: Done
assignee: []
created_date: '2026-05-03 11:35'
updated_date: '2026-05-06 23:19'
labels:
  - device-capability-architecture
  - phase-4
  - adr
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-035 - Spec-Phase-4-Unification-and-cleanup.md
parent_task_id: TASK-295
ordinal: 11070
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Write a new ADR under `adr/` capturing the architectural decisions:

- Shift from libusb-only inquiry to USB-first / SCSI-fallback selection.
- Decision to use FFI rather than additional native bindings.
- Four-package architecture (`device-types`, `devices-ipod`, `devices-mass-storage`, `ipod-firmware`).
- Provider pattern for extensible enumeration.
- Pure-functional preset registry (no globals).
- Literal-plus-runtime-string union pattern for IDs.

Cross-references doc-030 (PRD), doc-013, doc-020, doc-029, and doc-031 to doc-035 (phase specs).

HITL: needs review and acceptance. Best written after migration steps are complete and the architecture is stable.

See spec doc-035, Scope > Write the ADR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ADR file created under adr/ following the project's ADR template
- [x] #2 All architectural decisions captured
- [x] #3 Cross-references to doc-030, doc-013, doc-020, doc-029, doc-031 to doc-035
- [x] #4 ADR initially merged in 'Proposed' status
- [x] #5 Status updated to 'Accepted' once architecture is validated against the new code
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
ADR-014 written at adr/adr-014-device-capability-architecture.md. Captures all 13 architectural decisions from P0–P4: USB-first/SCSI-fallback orchestration, koffi FFI, four-package architecture, Provider pattern, pure-functional preset registry, literal-plus-runtime-string union, resolveCapabilities entry point, libgpod-node scope reduction, libgpod-free capability tables, diagnostics in core, Linux SCSI permission UX, unsupported-iPod tagging, and artworkMaxResolution null typing. Status set to Accepted (architecture validated as of P4 landing).
<!-- SECTION:FINAL_SUMMARY:END -->
