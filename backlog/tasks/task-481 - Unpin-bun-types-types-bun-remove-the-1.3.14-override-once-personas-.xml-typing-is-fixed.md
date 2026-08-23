---
id: TASK-481
title: >-
  Unpin bun-types/@types/bun (remove the 1.3.14 override once personas' .xml
  typing is fixed)
status: To Do
assignee: []
created_date: '2026-08-23 14:17'
labels:
  - tooling
  - chore
  - tech-debt
dependencies: []
references:
  - package.json
priority: low
ordinal: 260000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
During TASK-480.02 (P1 @podkit/lima extraction), a `bun install` (adding `proper-lockfile`) re-resolved the repo's floating `"latest"` `bun-types`/`@types/bun` to the just-released 1.4.0, whose ambient `*.xml` typing breaks `@podkit/device-testing` personas repo-wide (`TS2322 Document vs string`). Minimal fix applied: root `package.json` `overrides` pinning `bun-types` + `@types/bun` to **1.3.14** (the version the repo was on). This is a workspace-wide pin with no self-expiry.

Follow-up: either (a) upgrade `bun-types`/`@types/bun` to a 1.4.x that no longer breaks the persona `.xml` typing (or fix the personas to satisfy the new typing) and remove the override, or (b) replace the floating `"latest"` bun-types deps with an explicit pinned version and drop the override. Goal: no invisible workspace-wide type pin lingering as silent tech debt.
<!-- SECTION:DESCRIPTION:END -->
