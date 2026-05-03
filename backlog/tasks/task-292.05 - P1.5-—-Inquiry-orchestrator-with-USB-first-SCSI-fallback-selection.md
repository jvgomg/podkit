---
id: TASK-292.05
title: P1.5 — Inquiry orchestrator with USB-first / SCSI-fallback selection
status: To Do
assignee: []
created_date: '2026-05-03 11:29'
labels:
  - device-capability-architecture
  - phase-1
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-032 - Spec-Phase-1-ipod-firmware-SCSI-delivery.md
parent_task_id: TASK-292
ordinal: 8050
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the deep-module entry point `inquireFirmware(fingerprint)` that probes available methods, runs USB first (richer data on 5G+), falls back to SCSI on USB failure, parses the resulting plist XML, and returns a structured `ParsedFirmware`.

The orchestrator is the single public entry point for firmware inquiry. Selection logic is internal — callers do not specify a method.

See spec doc-032, Scope > inquiry/orchestrator.ts and inquiry/selection.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 inquireFirmware(fingerprint) returns ParsedFirmware | null with USB-first / SCSI-fallback selection
- [ ] #2 Transports injectable for testing (opts.transports)
- [ ] #3 Unit tests cover: USB-success-no-SCSI, USB-fail-SCSI-success, both-fail-graceful, malformed-XML-rejection, identity-extraction-failure
- [ ] #4 On a USB-inquiry-supporting device, never invokes SCSI
- [ ] #5 On a USB-inquiry-failing device, falls back to SCSI cleanly
- [ ] #6 Returns null without throwing when both methods fail or device returns invalid data
<!-- AC:END -->
