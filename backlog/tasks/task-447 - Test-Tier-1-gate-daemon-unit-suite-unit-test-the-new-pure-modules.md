---
id: TASK-447
title: 'Test Tier 1: gate daemon unit suite + unit-test the new pure modules'
status: To Do
assignee: []
created_date: '2026-06-27 19:05'
labels:
  - docker
  - daemon
  - testing
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-053 - podkit-docker-testing-strategy.md
priority: high
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tier 1 of the docker testing strategy. The ~69 existing daemon unit tests run but are not gated in the quality pipeline (the daemon's `test` script is a no-op). Gate them, then add isolation tests for the new pure modules from doc-052: unknown-model sync guard, device-registry resolver, readiness classifier, mass-storage ENV mapper, container device-access probe.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Existing daemon unit suite runs and gates in `bun run quality`
- [ ] #2 Unit tests added for: unknown-model guard, device-registry resolver, readiness classifier, mass-storage ENV mapper, device-access probe
- [ ] #3 All five modules tested via external behavior (inputs -> outputs/typed errors), no implementation coupling
<!-- AC:END -->
