---
id: TASK-442
title: 'Daemon: readiness classifier + notify-and-skip for needs-setup/needs-init'
status: Done
assignee: []
created_date: '2026-06-27 19:04'
updated_date: '2026-07-06 22:58'
labels:
  - daemon
  - docker
milestone: m-22
dependencies: []
references:
  - backlog/docs/doc-052 - PRD-podkit-docker-alignment.md
  - packages/podkit-daemon/src/sync-orchestrator.ts
modified_files:
  - packages/podkit-daemon/src/readiness-classifier.ts
  - packages/podkit-daemon/src/readiness-classifier.test.ts
  - packages/podkit-daemon/src/cli-runner.ts
  - packages/podkit-daemon/src/sync-orchestrator.ts
  - packages/podkit-daemon/src/sync-orchestrator.test.ts
  - .changeset/daemon-readiness-classifier.md
priority: high
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A freshly-detected device that needs setup (no authoritative identity) or initialisation (no database) currently produces a generic "sync failed". Add a pure **readiness classifier**: given a detected device, classify `ready | needs-setup | needs-init | unsupported`, driving notify-and-skip with actionable guidance.

Hard rule from doc-052: the daemon NEVER auto-mutates a detected device — never writes SysInfoExtended, never auto-inits a blank DB. Auto-formatting a freshly-detected block device is a data-loss footgun. Detect and guide only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Pure readiness classifier: (detectedDevice) -> ready | needs-setup | needs-init | unsupported, unit-tested in isolation
- [x] #2 needs-setup -> notification tells the user to run `device add` once (with USB passthrough); device is skipped, not retry-spammed
- [ ] #3 needs-init -> notification tells the user to run `device init`; device is skipped
- [x] #4 Daemon never writes SysInfoExtended and never auto-inits a database
- [x] #5 Notifications are device-specific and actionable (not generic 'sync failed')
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed on main as commit de596e09 (rebased from the stale feat/m-22-generic-hard-error worktree, 2026-07-06).

Pure classifier `classifyReadiness` in packages/podkit-daemon/src/readiness-classifier.ts, table-tested. Wired into sync-orchestrator's post-sync branch (READINESS_TITLE map): non-zero/non-lock exits are classified from the sync subprocess result (exit code + typed CLI `code`) instead of collapsing to a generic "Sync Error". needs-setup -> "Device Needs Setup" with device add / doctor --repair steps + skip; unsupported -> reported; clean skips no longer logged as "completed with errors". Daemon never writes SysInfoExtended and never auto-inits (it shells out to the CLI) — AC#4 satisfied structurally.

Design deviation from AC#1 wording: the classifier's input is the *sync outcome* (exitCode + typed code), not a raw `detectedDevice`. This is the decoupled shape — the daemon stays a thin subprocess wrapper and inherits the CLI's refusal (TASK-440) for free, rather than re-deriving readiness in-process. Serves the same goal; noted for the record.

AC#3 (needs-init) NOT checked: the `needs-init` classification branch and its "Device Needs Init" notification title are wired, but dormant — no CLI path emits the `IPOD_NEEDS_INIT` code yet (see the "Reserved" comment in readiness-classifier.ts). It will fire once `podkit sync` detects a blank device before the db-open gate and surfaces a distinct code instead of the overloaded IPOD_OPEN_FAILED. Tracked as follow-up.
<!-- SECTION:NOTES:END -->
