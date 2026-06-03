---
id: TASK-378
title: Pre-save free-space probe + early ENOSPC error — doc-041 §5.3
status: To Do
assignee: []
created_date: '2026-06-03 09:08'
labels:
  - enhancement
  - save-transaction
  - preflight
  - reliability
dependencies:
  - TASK-142
references:
  - packages/podkit-core/src/device/
  - backlog/docs/doc-041 - Save-Transaction-Design-and-State-of-Play.md
priority: low
ordinal: 104000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`doc-041 §5.3`: ENOSPC mid-save is detected only at write time, after a full plan + transcode have happened. Wasted work; user sees a confusing partial-completion state.

## Scope

1. Add `MassStorageAdapter.estimatedFreeSpaceBytes()` and `IpodAdapter.estimatedFreeSpaceBytes()` (statvfs on the mount).
2. Sync planner sums `plan.estimatedSize` against device free space; emits a typed `SyncPlanWarning` (or a hard error if the gap is large) before execution starts.
3. CLI surface: pre-flight check in `podkit sync --dry-run` so users see the ENOSPC risk before committing.

## Acceptance

- `podkit sync` against a mount with insufficient space fails fast with an actionable message before any transcode/copy starts.
- The check is informational on dry-run + becomes a hard stop on real sync (with a flag to bypass — `--ignore-free-space-check` for the brave).

## Reference

`doc-041 §5.3` — failure mode catalogue.
<!-- SECTION:DESCRIPTION:END -->
