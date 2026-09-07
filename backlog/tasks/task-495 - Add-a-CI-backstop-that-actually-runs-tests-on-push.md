---
id: TASK-495
title: Add a CI backstop that actually runs tests on push
status: To Do
assignee: []
created_date: '2026-09-07 23:36'
labels:
  - testing
  - ci
dependencies: []
references:
  - docs/adr/adr-028-substrate-agnostic-device-harness.md
  - docs/architecture/testing/taxonomy.md
priority: medium
type: task
ordinal: 274000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per ADR-028 §6.

**No CI workflow currently runs a single test.** `pr-checks.yml` builds the docs site and nothing else; `build-platform`, `prebuild`, `docker`, `release` and `verify-release` only build and publish. The entire quality gate is `bun run quality` on one developer's machine — so a machine that cannot run the suite means the suite does not run.

Add an `ubuntu-latest` job covering:

- Unit
- Integration
- E2E `host-binary` · `local-dir` · `dir`
- E2E `host-binary` · `docker-sidecar` · `dir` (runners have Docker natively; the Navidrome image is digest-pinned so it is cache-friendly)

This is a backstop, not the primary gate — rapid local loops remain the point, and CI exists to catch what an unavailable machine would otherwise silently skip. It pairs with task-492: once cells skip rather than fail, CI is what guarantees the skipped ones ran somewhere.

**Deliberately deferred:** `usb-synth` on CI. GitHub runners are full VMs and *can* `modprobe dummy_hcd`, so the gadget cells are technically reachable — but that is real work that competes directly with the substrate effort, and deciding it now would be premature. Revisit once ADR-028's slices have landed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A CI job runs unit and integration tests on pull requests
- [ ] #2 A CI job runs the host-binary · local-dir · dir E2E surface
- [ ] #3 A CI job runs the docker-sidecar surface
- [ ] #4 Turbo caching is configured so the job is not rebuilding everything from scratch each run
- [ ] #5 The docs-only path filter on pr-checks.yml does not cause the test job to be skipped on code-only PRs
<!-- AC:END -->
