---
id: TASK-445
title: Container device-access probe + actionable startup guidance
status: To Do
assignee: []
created_date: '2026-06-27 19:04'
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
