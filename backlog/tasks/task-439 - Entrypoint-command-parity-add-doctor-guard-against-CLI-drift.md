---
id: TASK-439
title: 'Entrypoint command-parity: add doctor + guard against CLI drift'
status: To Do
assignee: []
created_date: '2026-06-27 19:03'
labels:
  - docker
  - entrypoint
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-052 - PRD-podkit-docker-alignment.md
  - packages/podkit-docker/entrypoint.sh
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`docker run podkit doctor` currently falls through to the raw-shell branch and fails because `doctor` was never added to the entrypoint's `PODKIT_COMMANDS` list. Fix the immediate blocker, then make command-parity robust so future CLI commands don't silently break in the image.

Per doc-052: keep the entrypoint bash thin — the parity check should validate against the CLI's actual known commands rather than a hand-maintained string that drifts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `docker run podkit doctor` runs the diagnostics (does not fall through to raw-shell)
- [ ] #2 Entrypoint recognises every current podkit subcommand
- [ ] #3 Command list is derived from / validated against the CLI rather than hand-maintained, so a newly-added CLI command cannot silently break the image
- [ ] #4 Covered by the entrypoint bats suite (see testing task)
<!-- AC:END -->
