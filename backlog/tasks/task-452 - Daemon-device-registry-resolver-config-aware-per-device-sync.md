---
id: TASK-452
title: Daemon device-registry resolver + config-aware per-device sync
status: To Do
assignee: []
created_date: '2026-06-28 08:34'
labels:
  - docker
  - daemon
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-052 - PRD-podkit-docker-alignment.md
  - packages/podkit-daemon/src/sync-orchestrator.ts
priority: medium
ordinal: 202000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extracted from doc-052 daemon section; surfaced as a gap while doing TASK-447 (the readiness classifier landed there, but the device-registry resolver had no owning task).

Today the daemon is config-blind: it shells out to `podkit sync <mountPath>` for every detected device, so per-device config settings never apply. doc-052 wants: a pure **device-registry resolver** — given a detected UUID and the loaded config, resolve to a registered device name or "unregistered" — that drives whether the daemon invokes the CLI by name (per-device settings apply) or by path (global/ENV settings).

Scope:
- Pure module `device-registry-resolver` in packages/podkit-daemon: `(uuid, devices) -> name | null`. Table-tested by external behavior.
- Daemon reads the config file (the scoped change doc-052 calls out — the daemon explicitly does not load config today) to obtain the device registry, matched by UUID.
- On a UUID match, sync by device **name** (`--device <name>`) so per-device settings apply; otherwise fall back to path-based sync (unchanged).
- Integration coverage belongs to Tier-4 (TASK-450, loopback) / Tier-5 (TASK-451, VM) once those land.

This completes the doc-052 daemon decision-logic pair (readiness classifier done in TASK-447; this is the registry resolver).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Pure device-registry resolver module: (uuid, config devices) -> registered name | null, table-tested via external behavior
- [ ] #2 Daemon loads config and resolves a detected UUID to a registered device name
- [ ] #3 On a registry match the daemon syncs by device name so per-device settings apply; otherwise path-based sync is unchanged
- [ ] #4 Existing daemon unit suite stays green; new behavior covered by daemon unit tests
<!-- AC:END -->
