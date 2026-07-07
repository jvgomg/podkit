---
id: TASK-459
title: >-
  Sync emits distinct IPOD_NEEDS_INIT code for a blank device (activates daemon
  needs-init path)
status: Done
assignee: []
created_date: '2026-07-06 22:58'
updated_date: '2026-07-07 21:48'
labels:
  - daemon
  - sync
  - docker
milestone: m-22
dependencies:
  - TASK-442
references:
  - backlog/docs/doc-052 - PRD-podkit-docker-alignment.md
  - packages/podkit-daemon/src/readiness-classifier.ts
modified_files:
  - packages/podkit-cli/src/commands/sync.ts
  - packages/podkit-cli/src/commands/sync-runner.unit.test.ts
  - packages/podkit-daemon/src/readiness-classifier.ts
  - packages/podkit-daemon/src/readiness-classifier.test.ts
  - packages/podkit-daemon/src/sync-orchestrator.test.ts
  - .changeset/sync-needs-init-code.md
  - .changeset/daemon-needs-init-notification.md
priority: medium
ordinal: 219000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The daemon readiness classifier (TASK-442) already has a `needs-init` branch and a "Device Needs Init" notification wired, but it is dormant: `podkit sync` never emits an `IPOD_NEEDS_INIT` code. A blank device (mounted iPod with no database) currently surfaces via the overloaded `IPOD_OPEN_FAILED`, so the daemon can't distinguish "needs init" from a genuine DB-open failure.

Make `podkit sync` detect a blank device (no iTunesDB) before the db-open gate and surface a distinct typed `IPOD_NEEDS_INIT` error with remediation pointing at `podkit device init`. This activates the classifier's existing needs-init path end-to-end and closes TASK-442 AC#3.

Hard rule (doc-052): the daemon still never auto-inits — it detects and guides only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 podkit sync detects a blank device (no database) before the db-open gate and emits a distinct typed IPOD_NEEDS_INIT error (not the overloaded IPOD_OPEN_FAILED)
- [x] #2 Error remediation tells the user to run `podkit device init`
- [x] #3 Daemon classifies IPOD_NEEDS_INIT -> needs-init and sends the 'Device Needs Init' notification, then skips (verified end-to-end)
- [x] #4 TASK-442 AC#3 satisfied; the 'Reserved' comment in readiness-classifier.ts is removed
- [x] #5 Changeset added (user-facing: podkit + @podkit/core)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented (TDD). Blank-device gate in packages/podkit-cli/src/commands/sync.ts: probes core.IpodDatabase.hasDatabase(devicePath) inside the isIpodDevice block, AFTER the unsupported/unknown-model gates (setup guidance wins; init needs identity anyway) and BEFORE FFmpeg detect / DB open. Emits typed IPOD_NEEDS_INIT (new SyncErrorCodes entry) with remediation `podkit device init -d <path>`. Gate requires a non-null identity assessment — when assessIpodIdentity threw, the path may not be an iPod at all (unregistered -d /path at a mass-storage player) and init guidance would misdirect; that lane falls through to the open path's IPOD_OPEN_FAILED, pinned by test.

Daemon: Reserved comment removed from readiness-classifier.ts (branch live); notification copy fixed from nonexistent `podkit init` to `podkit device init` (kept generic without -d — the daemon's mount point is ephemeral, ejected after the cycle, so a path qualifier would dangle). End-to-end pin: orchestrator test feeds exit-1 + IPOD_NEEDS_INIT → 'Device Needs Init' notification containing the command, no generic Sync Error, device still ejected.

AC#5 note: changeset filed for podkit (minor — blank devices change JSON code from IPOD_OPEN_FAILED to IPOD_NEEDS_INIT) and @podkit/daemon (patch). No @podkit/core changeset: detection reuses the existing IpodDatabase.hasDatabase API, core is untouched — the AC's 'podkit + @podkit/core' assumption didn't materialise. Demo mock-core already stubs hasDatabase(→true), parity check green.

Verification: 1935 CLI + 105 daemon tests green (turbo test:unit --force), typecheck + root lint clean. Sonnet review applied: added the null-assessment guard + fall-through test (should-fix), added -d qualifier to CLI remediation (nit); second nit (no-op-gate test when DB exists) covered implicitly by every integration sync test.
<!-- SECTION:NOTES:END -->
