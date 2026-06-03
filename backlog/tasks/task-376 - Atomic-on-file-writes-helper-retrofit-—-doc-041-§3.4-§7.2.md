---
id: TASK-376
title: Atomic on-file writes (helper + retrofit) — doc-041 §3.4/§7.2
status: To Do
assignee: []
created_date: '2026-06-03 09:08'
labels:
  - enhancement
  - save-transaction
  - mass-storage
  - reliability
  - doctor
dependencies:
  - TASK-142
references:
  - packages/podkit-core/src/device/mass-storage-tag-writer.ts
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - backlog/docs/doc-041 - Save-Transaction-Design-and-State-of-Play.md
priority: medium
ordinal: 102000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

Per `doc-041 §3.4`: tag-write, picture-write, and (future) sidecar-write all open the target file in-place via node-taglib-sharp. A SIGKILL mid-write CAN leave a torn file. Manifest writes are atomic (tmp + rename); on-file mutations are not.

## Scope

1. Add a shared atomic-write helper used across all on-file mutations: write to `<file>.podkit-tmp`, fsync, `fs.rename` (atomic on the same filesystem). Mirrors the existing `PODKIT_TEMP_SUFFIX` pattern used for transcode output.
2. Retrofit `MassStorageTagWriter.writeTags` and `writePicture` to use the helper.
3. Sidecar writes (TASK-370) should adopt it from day one.
4. `podkit doctor` should clean orphan `<file>.podkit-tmp` files on the device (related to TASK-375).
5. Test: SIGKILL simulation (write half the file then throw before rename) → target file is unchanged → doctor cleanup removes the tmp.

## Why deferred

Foundational. Should land alongside or just before TASK-370/371's normalization work so all three benefit from the same primitive.

## Reference

- `doc-041` §3.4 (rough edge), §7.2 (principle), §4.2 ("Crash mid-tag-write" gap)
- `PODKIT_TEMP_SUFFIX` in `packages/podkit-core/src/sync/music/pipeline.ts`
<!-- SECTION:DESCRIPTION:END -->
