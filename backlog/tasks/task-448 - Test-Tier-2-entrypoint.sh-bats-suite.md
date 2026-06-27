---
id: TASK-448
title: 'Test Tier 2: entrypoint.sh bats suite'
status: To Do
assignee: []
created_date: '2026-06-27 19:05'
labels:
  - docker
  - entrypoint
  - testing
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-053 - podkit-docker-testing-strategy.md
  - packages/podkit-docker/entrypoint.sh
priority: medium
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tier 2 of the docker testing strategy. Shell-level `bats` tests of `entrypoint.sh`: command routing (sync/daemon/raw/known-subcommand), command-parity (every CLI command recognised — would have caught the `doctor` blocker), PUID/PGID user/group creation and ownership, `--device /ipod` injection for sync, `--path /config/config.toml` injection for init, su-exec privilege drop for one-shot vs root for daemon. No device, no real sync.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 bats suite covers command routing including the known-subcommand and raw-passthrough branches
- [ ] #2 Command-parity assertion fails if a CLI command is unrecognised by the entrypoint
- [ ] #3 PUID/PGID user/group creation + ownership asserted
- [ ] #4 `--device /ipod` and init `--path` injection asserted
- [ ] #5 su-exec drop (one-shot) vs root (daemon) asserted
- [ ] #6 Suite is runnable locally via a documented command
<!-- AC:END -->
