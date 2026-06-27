---
id: TASK-441
title: 'Daemon: resolve detected device against config registry, sync by name'
status: To Do
assignee: []
created_date: '2026-06-27 19:04'
labels:
  - daemon
  - docker
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-052 - PRD-podkit-docker-alignment.md
  - packages/podkit-daemon/src/cli-runner.ts
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The daemon currently syncs by raw mount path and never loads config, so per-device settings are silently ignored. Add a pure **device-registry resolver**: given a detected device UUID and the loaded config, resolve to a registered device name or "unregistered". When matched, the daemon invokes the CLI by name so per-device settings apply; when unregistered (e.g. ENV-only single-device lane), it falls back to path with global/ENV settings.

This is the scoped change that lets the daemon consult config (today it explicitly does not). Mass-storage daemon auto-sync inherently requires a declared preset — falls out of this registry path.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Pure device-registry resolver: (detectedUuid, config) -> {name} | unregistered, unit-tested in isolation
- [ ] #2 Daemon invokes CLI by device name when the detected UUID matches a config entry, so per-device settings apply
- [ ] #3 Daemon falls back to path-based sync with global/ENV settings when there is no registry match
- [ ] #4 ENV-only single-iPod lane continues to work unchanged
- [ ] #5 Mass-storage auto-sync requires a declared preset (documented, not silently attempted)
<!-- AC:END -->
