---
id: DRAFT-019
title: Test Tier 5 full persona matrix (beyond scaffold)
status: Draft
assignee: []
created_date: '2026-06-27 19:05'
labels:
  - docker
  - daemon
  - testing
  - vm
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-053 - podkit-docker-testing-strategy.md
priority: low
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Beyond-scope for the alignment release. Tier 5 ships scaffolded with one synthesized persona. This task broadens it to the full persona matrix (multiple iPod generations, unsupported-device rejection, sysinfo-mismatch repair, etc.) run through the Docker image inside the VM — reusing the existing `e2e-vm-tests` expectations/matrix against the image instead of the host binary. Draft until the scaffold lands.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Existing VM persona matrix runs through the Docker image, not just the host binary
- [ ] #2 Coverage includes multiple iPod generations + unsupported-device rejection + sysinfo repair
- [ ] #3 No silent persona drops vs the host-binary matrix
<!-- AC:END -->
