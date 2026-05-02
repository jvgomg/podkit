---
id: TASK-287
title: Implement device identification from spec
status: To Do
assignee: []
created_date: '2026-05-02 15:44'
labels: []
milestone: m-18
dependencies:
  - TASK-286
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the device identification improvements as specified in the implementation spec produced by TASK-286. This covers SCSI inquiry support, device capability architecture, doctor checks, inquiry method selection, and any identified refactors.

The spec document (in backlog/docs/) contains the agreed design — follow it. Raise issues with the user if implementation reveals problems with the spec rather than deviating silently.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 SCSI inquiry implemented for macOS (IOKit) and Linux (SG_IO)
- [ ] #2 Device capability layer implemented per spec
- [ ] #3 Doctor checks report available inquiry methods and data consistency
- [ ] #4 Inquiry method selection works (SCSI preferred, USB fallback)
- [ ] #5 Existing tests pass, new tests cover inquiry codepaths
- [ ] #6 Package organisation improved per spec — no bolt-on code
<!-- AC:END -->
