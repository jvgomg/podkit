---
id: TASK-436.07
title: Extend `podkit device set` with default-collection write flags
status: To Do
assignee: []
created_date: '2026-06-24 15:20'
labels:
  - cli
  - config
  - collections
dependencies:
  - TASK-436.05
parent_task_id: TASK-436
ordinal: 188000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add the CLI write path for per-device defaults to the existing `podkit device set` command, following its established set / `--clear-X` / `--no-X` + option-source-filter pattern.

- `--default-music <name>` / `--default-video <name>` — set a collection name.
- `--no-default-music` / `--no-default-video` — record `false` (explicit none).
- `--clear-default-music` / `--clear-default-video` — remove the value (revert to inheriting the global default).
- Error at write time if a provided name does not reference an existing collection (consistent with how the command already rejects bad `--quality`), listing the available collections.
- The defaults apply to all device types — do NOT place them behind the mass-storage-only option gate.
- Widen the `updateDevice` writer's `updates` value type to include the two keys (with `null` meaning remove); its generic write loop already handles arbitrary keys, so no new TOML-surgery routine is needed.

Part of epic TASK-436. See PRD doc-050.

Context: PRD user stories 9, 10, 11, 12, 13.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 device set supports --default-music/--default-video (set), --no-default-music/--no-default-video (false), and --clear-default-music/--clear-default-video (remove)
- [ ] #2 Setting a name that references a missing collection errors at write time and lists available collections
- [ ] #3 The flags work for all device types (not gated to mass-storage)
- [ ] #4 updateDevice persists the values (null = remove) via its generic write loop with no new surgery routine
- [ ] #5 Unit tests cover set/none/clear, the missing-collection error, and a round-trip through updateDevice
<!-- AC:END -->
