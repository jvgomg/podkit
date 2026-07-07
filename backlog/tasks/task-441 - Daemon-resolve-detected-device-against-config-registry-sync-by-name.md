---
id: TASK-441
title: 'Daemon: resolve detected device against config registry, sync by name'
status: In Progress
assignee: []
created_date: '2026-06-27 19:04'
updated_date: '2026-07-07 21:24'
labels:
  - daemon
  - docker
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-052 - PRD-podkit-docker-alignment.md
  - packages/podkit-daemon/src/cli-runner.ts
  - packages/podkit-daemon/src/sync-orchestrator.ts
modified_files:
  - packages/podkit-daemon/src/device-registry-resolver.ts
  - packages/podkit-daemon/src/device-registry-resolver.test.ts
  - packages/podkit-daemon/src/cli-runner.ts
  - packages/podkit-daemon/src/sync-orchestrator.ts
  - packages/podkit-daemon/src/sync-orchestrator.test.ts
  - packages/podkit-daemon/src/main.ts
  - docs/getting-started/docker-daemon.md
  - .changeset/daemon-registry-sync-by-name.md
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
- [x] #1 Pure device-registry resolver: (detectedUuid, config) -> {name} | unregistered, unit-tested in isolation
- [x] #2 Daemon invokes CLI by device name when the detected UUID matches a config entry, so per-device settings apply
- [x] #3 Daemon falls back to path-based sync with global/ENV settings when there is no registry match
- [x] #4 ENV-only single-iPod lane continues to work unchanged
- [x] #5 Mass-storage auto-sync requires a declared preset (documented, not silently attempted)
- [x] #6 Existing daemon unit suite stays green; new behavior covered by daemon unit tests
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Absorbed duplicate TASK-452 (filed during TASK-447 without noticing this task already owned the resolver). Extra scope notes from 452: pure module `device-registry-resolver` in packages/podkit-daemon, `(uuid, devices) -> name | null`, table-tested by external behavior; daemon loads config (the scoped change doc-052 calls out) to obtain the registry; integration coverage belongs to Tier-4 (TASK-450) / Tier-5 (TASK-451). This completes the doc-052 daemon decision-logic pair (readiness classifier landed in TASK-447). TASK-447's Tier-1 dependency now points here.

Implemented (TDD). Pure resolver packages/podkit-daemon/src/device-registry-resolver.ts: resolveRegisteredDeviceName(uuid, devices) — case-insensitive UUID match, entries without volumeUuid never match — plus createDeviceNameResolver(listDevices) which fetches the registry per cycle via `podkit --json device list` (new runDeviceList + DeviceListOutput in cli-runner) and degrades EVERY failure mode (CLI missing/non-zero/malformed) to null = path-based sync. Daemon still never parses config files — it consults config through the CLI's JSON view, preserving the shell-out decoupling.

Orchestrator: optional resolveDeviceName seam; resolved name drives dry-run + sync (both runSync and abortable spawnSync); mount/eject stay on the mount path. main.ts wires the iPod lane only; mass-storage lane unchanged (no identity to resolve). 14 resolver tests + 6 orchestrator tests incl. registered-name-through-readiness-refusal; ENV-only lane pinned by 'no resolver configured' test. 104 daemon tests green; typecheck + root lint clean. Changeset @podkit/daemon minor.

AC#5: documented in docs/getting-started/docker-daemon.md — new Mass-Storage Devices section (declared preset requirement, PODKIT_MASS_STORAGE_PATHS now in the daemon ENV table), registry step added to How It Works, Multiple iPods section rewritten to describe by-name sync.

Discovery worth recording: the CLI already auto-matches a bare path by reading the volume UUID at the path (resolveDevicePath 'Scenario B', source=path-matched) — so per-device settings were not fully 'silently ignored' pre-change when locate-at-path worked. The by-name lane makes application explicit, logged, and independent of locate-at-path succeeding inside the container; Scenario B remains as a fallback. Also relevant to TASK-444: daemon mass-storage path sync only picks up a declared preset via that UUID match — a bind-mounted dir with no filesystem UUID cannot match, which is the gap the ENV mapper (type+path+preset) must close.

Sonnet review applied: fixed resolver test that hit the early-return guard instead of the no-volumeUuid branch; added registered-name + readiness-refusal orchestrator test; neutralised the 'not in config registry' log (null also means lookup-failed, which the resolver warn-logs itself); corrected docs comment on volumeUuid matching mechanics.
<!-- SECTION:NOTES:END -->
