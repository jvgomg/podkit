---
id: TASK-292.02
title: P1.2 — Plist parser + tests against captured XML
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
ordinal: 8020
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement a structured plist-XML parser in `@podkit/ipod-firmware` covering the Apple plist subset that SysInfoExtended uses (dict, key, string, integer, data, array, true, false). Pure module, no dependencies. Tests use real captured XML fixtures from documents/sysinfo-captures/.

See spec doc-032, Scope > New packages > ipod-firmware > plist/.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 parsePlist(xml) returns a structured PlistValue tree
- [ ] #2 Round-trip parse on all 5 captured XML files in documents/sysinfo-captures/ succeeds
- [ ] #3 Malformed input rejection: truncated XML, missing closing tag, unknown element, invalid UTF-8
- [ ] #4 All plist element types covered: dict, key, string, integer, data, true, false, array
- [ ] #5 No external runtime dependencies
- [ ] #6 Unit tests exercise structural and error paths
<!-- AC:END -->
