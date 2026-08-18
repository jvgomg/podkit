---
id: TASK-479.09
title: doctor diagnoses read-only devices instead of refusing them
status: Done
assignee: []
created_date: '2026-08-18 01:19'
updated_date: '2026-08-18 01:19'
labels:
  - diagnostics
  - cli
  - ux
milestone: m-18
dependencies: []
parent_task_id: TASK-479
priority: medium
ordinal: 252000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`podkit doctor` refused to run any check on a non-syncable device, so a read-only iPod — one podkit can read, list and archive — could not be diagnosed at all.

Root cause was not in the CLI: the readiness cascade short-circuits a read-only generation to `level: 'unsupported'` before any disk probe, marking mount/SysInfo/database as skipped. Patching only `doctor.ts` would have produced a run with no database handle and nothing to report.

`checkReadiness()` gained `requiredAccess: 'read' | 'write'`, defaulting to `'write'` so every existing caller (sync, init, add, scan, info) is unchanged by construction. Bare `doctor` opts into `'read'`; `doctor --repair` returns earlier and keeps write intent. This is ADR-024's "bare doctor is read, doctor --repair is write" implemented at the readiness seam rather than bolted on.

On a read-only device doctor now runs system checks, the full readiness cascade and every database-health check, prints a banner naming the tier and the reason, and exits 0 when contents are healthy. Findings whose only remedy is a write are still reported, with the `Fix:` line replaced by an explanation — a read-only doctor run contains the string `--repair` nowhere, and a test asserts that.

`access: 'none'` devices still refuse: they have no readable disk representation, so there is nothing to diagnose.

An audit found no check that mutates outside `repair.run`. Rather than trust the audit, `detection-never-writes.test.ts` snapshots a populated temp mount and asserts byte-identical paths, sizes and mtimes after every iPod database-health check runs.

Verified on hardware: an iPod nano 7G and a nano 6G both produced full diagnostic output with repairs withheld; a syncable device still offers its repair commands.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Bare `doctor` runs system, readiness and database-health checks on a read-only device
- [x] #2 `doctor --repair` remains refused for non-syncable devices
- [x] #3 Repair-only findings are reported with the remedy reframed, not a dangling command
- [x] #4 No check writes during detection, pinned by a test rather than an audit
- [x] #5 Verified on hardware
<!-- AC:END -->
