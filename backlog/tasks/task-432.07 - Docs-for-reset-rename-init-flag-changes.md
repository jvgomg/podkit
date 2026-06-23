---
id: TASK-432.07
title: Docs for reset/rename/init/flag changes
status: Done
assignee: []
created_date: '2026-06-23 14:43'
updated_date: '2026-06-23 14:55'
labels:
  - docs
  - device
  - rename
  - reset
dependencies: []
documentation:
  - doc-048 - PRD-Device-Reset-Rename-Fresh-Setup.md
modified_files:
  - docs/reference/cli-commands.md
  - docs/user-guide/devices/resetting.md
  - docs/user-guide/devices/renaming.md
  - docs/user-guide/devices/clearing.md
  - docs/user-guide/devices/formatting.md
  - docs/user-guide/devices/archive.md
  - docs/user-guide/devices/index.md
parent_task_id: TASK-432
ordinal: 172000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Documentation follow-on for doc-048. The device command behaviors changed and `device rename` is brand new with no doc entry. Update the docs to match.

Scope:
- NEW user-guide page for `device rename` (both-layer rename: iTunesDB name + volume label, --no-disk/--no-database, FAT lossiness, config auto-refresh).
- Rewrite `resetting.md` for the new factory-wipe behavior (empty DB + all audio + artwork + name preserve/--name + disk label) and the errors-to-init case.
- `reference/cli-commands.md`: add `device rename`, update `device reset` (+--name, -n/--dry-run, factory wipe), add `device init --name`, add `-n` to reset-artwork; verify clear/remove show `-y/--yes`.
- Update cross-references (clearing.md reset-vs-clear table, formatting.md, tips, troubleshooting) where reset behavior is described.

PRD: doc-048.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 New renaming.md user-guide page documents device rename (both layers, --no-* flags, FAT lossiness, config refresh)
- [x] #2 resetting.md reflects the factory-wipe behavior (audio+artwork+name+label) and the errors-to-init case
- [x] #3 reference/cli-commands.md has a device rename section, updated device reset, init --name, and consistent flags
- [x] #4 Cross-references (clearing/formatting/tips/troubleshooting) updated where reset behavior is described
- [x] #5 Docs match the actual command flags/wording (verified against command source)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Docs done by team lead inline (subagent dispatch was API-overloaded). Verified against command source for exact flags/wording. Changes: (1) reference/cli-commands.md — new `device rename` section, rewrote `device reset` (factory wipe + --name + -n/--dry-run + errors-to-init), added `init --name`, added -n to reset-artwork. (2) NEW user-guide/devices/renaming.md (order 9) — two-layer rename, FAT uppercase/11-char lossiness + warning, --no-disk/--no-database + both-flags error, HFS+ vs FAT, config auto-refresh, pointers to init/reset --name. (3) resetting.md — rewrote What Reset Does + Reset vs Clear for factory wipe (audio incl. orphans + artwork + name preserve/--name + disk label), added --name/--dry-run usage + errors-to-init section + renaming cross-links. (4) clearing.md — updated Clear vs Reset table. (5) formatting.md — corrected 'only recreates the database' phrasing; bumped order 9->10. (6) archive.md — order 10->11. (7) index.md — added renaming to See Also. Devices sidebar autogenerates, so no sidebar.ts edit. Validated via `bunx turbo run build --filter @podkit/docs-site`: build OK, '✓ All internal links are valid', 67 pages. No changeset (docs-only). Reminder: docs deploy from docs-live branch — cherry-pick at/after release.
<!-- SECTION:NOTES:END -->
