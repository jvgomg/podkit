---
id: TASK-476
title: >-
  Epic: quality:rc — verify the release candidate against exact CI-built assets
  (doc-058)
status: In Progress
assignee: []
created_date: '2026-08-06 18:21'
updated_date: '2026-08-06 18:30'
labels:
  - testing
  - ci
  - docker
  - vm
  - release
  - epic
milestone: m-22
dependencies: []
references:
  - >-
    backlog/docs/doc-058 -
    RFC-quality-rc-—-verify-the-release-candidate-locally-against-the-exact-CI-built-assets.md
ordinal: 236000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Master/epic for the doc-058 RFC. Deliver two mirror quality commands — `quality` (local assets) and `quality:rc` (the exact CI-built release-candidate assets) — so a maintainer can verify what's about to ship (mac + linux binaries + Docker image) locally, before merging the "Version Packages" PR.

Design, user stories, decisions: **doc-058**. Sub-tickets are `ready-for-agent`; implement in the children, not here.

Sub-tickets (dependency order):
1. `quality` becomes the full local mirror (prefactor) — no blockers.
2. RC-build discovery + preflight decision (seam + unit tests) — no blockers.
3. Produce `:rc`, retire `:edge` (workflow) — no blockers.
4. `quality:rc` — fetch CI assets + run the mirror (integration) — blocked by 1, 2, 3.

Builds on TASK-475 (delivered the override seams, `cliSpawnArgv`, turbo passthrough, two-phase body; completes its deferred CI-byte-fidelity AC) and repoints TASK-463's `:edge` machinery to `:rc`.
<!-- SECTION:DESCRIPTION:END -->
