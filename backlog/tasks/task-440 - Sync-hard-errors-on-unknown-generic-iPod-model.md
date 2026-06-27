---
id: TASK-440
title: Sync hard-errors on unknown/generic iPod model
status: To Do
assignee: []
created_date: '2026-06-27 19:04'
labels:
  - sync
  - device-capability-architecture
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-052 - PRD-podkit-docker-alignment.md
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Today an iPod whose model can't be resolved from on-disk identity falls back to a "generic iPod" and syncs anyway — risking the wrong artwork format or database incompatibility, silently. Replace this silent degradation with a hard, typed error at the sync boundary, with remediation pointing at the one-time USB setup (`device add` with passthrough) / `doctor --repair sysinfo-extended`.

This is a deliberate behavior change affecting host and Docker alike. It is also the universal backstop that makes the daemon correct for free (the daemon shells `sync`, so it inherits the refusal). Extract the decision as a pure function over the resolved identity so it is table-testable (the **unknown-model sync guard** in doc-052).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Sync refuses an unknown/unresolved iPod model with a typed error instead of degrading to generic
- [ ] #2 Error message gives actionable remediation (one-time USB setup / doctor --repair sysinfo-extended)
- [ ] #3 Decision logic lives in a pure, isolated, table-tested module
- [ ] #4 A changeset is added (user-facing behavior change to a distributed package)
- [ ] #5 Docs updated to describe the new failure + remediation
<!-- AC:END -->
