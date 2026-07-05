---
id: TASK-445
title: Container device-access probe + actionable startup guidance
status: To Do
assignee: []
created_date: '2026-06-27 19:04'
updated_date: '2026-06-29 08:27'
labels:
  - docker
  - entrypoint
  - ux
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-052 - PRD-podkit-docker-alignment.md
  - packages/podkit-docker/entrypoint.sh
priority: medium
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Users hit confusing failures when the container lacks the device access their chosen path needs. Add a startup **device-access probe**: a pure module that, given the container's filesystem/proc view, reports whether `/ipod` is mounted, whether `/dev/bus/usb` is present, whether `/dev/sg*` is present, and emits actionable guidance ("no iPod mounted at /ipod — mount it on the host and bind it", "no USB passthrough — one-time `device add` setup unavailable", etc.).

Keep the entrypoint bash thin; put the logic in a unit-testable module invoked from it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Pure device-access probe: (fs/proc view) -> access report + guidance, unit-tested in isolation
- [ ] #2 Entrypoint surfaces the report at startup with actionable guidance per missing access
- [ ] #3 Guidance distinguishes the path-baseline case from the USB-setup case
- [ ] #4 Does not block startup — informational, not fatal
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Handoff note (from TASK-447): TASK-447 (Tier-1 tests) depends on this. Build the container device-access probe as a pure, table-tested module (given a filesystem/proc view -> reports /ipod mounted? /dev/bus/usb? /dev/sg*? + guidance), with external-behavior tests — that doubles as the Tier-1 unit test for this module (447 AC#2/#3). The entrypoint already derives its command list from the CLI (TASK-439); the probe is the startup device-access guidance piece.
<!-- SECTION:NOTES:END -->
