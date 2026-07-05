---
id: TASK-444
title: Single mass-storage device via ENV (type + path + preset)
status: To Do
assignee: []
created_date: '2026-06-27 19:04'
updated_date: '2026-06-29 08:27'
labels:
  - config
  - docker
  - mass-storage
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-052 - PRD-podkit-docker-alignment.md
priority: medium
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Today ENV can declare the music source and global settings but not a device/preset, so a single-mass-storage user is forced into a config file purely to name a preset. Add a single mass-storage device declaration via ENV (`type` + `path` + `preset`, preset defaulting to generic), giving iPod and mass-storage symmetric single-device daemon lanes.

This is the first slice of the broader ENV↔config parity direction (full multi-device/multi-collection parity is out of scope — see the Draft task). Implement as a pure **mass-storage ENV mapper**: env -> the same DeviceConfig shape the config file produces.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Pure mass-storage ENV mapper: env -> DeviceConfig, unit-tested in isolation
- [ ] #2 A single mass-storage device (type + path + preset) is fully configurable via ENV with no config file
- [ ] #3 Preset defaults to generic when unspecified
- [ ] #4 ENV-only daemon mode auto-syncs the declared single mass-storage device
- [ ] #5 Documented in the environment-variables reference + Docker docs
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Handoff note (from TASK-447): TASK-447 (Tier-1 tests) depends on this. When you build the mass-storage ENV mapper, put it in a pure, table-tested module (external behavior, no impl coupling) so it satisfies TASK-447 AC#2/#3 — that's the Tier-1 unit test for this module. The unknown-model guard + readiness classifier are already done (440, 447).
<!-- SECTION:NOTES:END -->
