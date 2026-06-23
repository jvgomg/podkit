---
id: TASK-432
title: 'Device Reset, Rename & Fresh Setup'
status: Done
assignee: []
created_date: '2026-06-22 22:30'
updated_date: '2026-06-23 14:55'
labels:
  - device
  - cli
  - reset
  - rename
dependencies: []
documentation:
  - doc-048 - PRD-Device-Reset-Rename-Fresh-Setup.md
ordinal: 165000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Umbrella task for doc-048 (PRD: Device Reset, Rename & Fresh Setup).

Makes `podkit device reset` a true one-shot factory reset (recreate empty DB + delete audio files + clear artwork DB + preserve/override device name + keep disk label consistent), adds a new `podkit device rename` command (DB master-playlist name + FAT/HFS volume label), gives `podkit device init` a `--name` flag, and standardises confirmation/dry-run flags across the CLI. `clear` and `reset-artwork` remain as complementary granular tools.

The reuse seam is `applyDeviceName` (the single engine both rename and reset funnel through). Empirically grounded: the case-correct name lives in the iTunesDB master-playlist; the uppercase name is the FAT32 volume label; SCSI/SysInfo carry no writable name.

See PRD: backlog document doc-048. Subtasks are vertical tracer-bullet slices.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All subtasks completed
- [x] #2 `device reset` performs a full factory wipe in one command (empty DB, audio files removed, artwork cleared, name preserved, disk label consistent)
- [x] #3 `device rename <name>` renames both the DB name and the disk label
- [x] #4 `device init --name` names a fresh device during initialisation
- [x] #5 Confirmation flag is `-y/--yes` and dry-run short flag is `-n` consistently across destructive commands
- [x] #6 `clear` and `reset-artwork` still function for partial wipes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
All 6 subtasks complete (432.01-432.06), each reviewed and gate-green. Full repo gate at completion: typecheck 36/36, lint 0/0, core 3246 tests 0 fail, CLI 1771 tests 0 fail. 5 changesets staged (all minor): device-rename-command, device-rename-disk-label, device-rename-config-refresh, factory-reset-device, cli-flag-standardisation. Changes left UNCOMMITTED for the user to commit. macOS verified throughout; Linux fatlabel/hfslabel + HFS+ relabel implemented but deferred to Lima VM / CI per team decision.

Docs follow-on (432.07) complete: device rename/reset/init/flag changes documented; new renaming.md user-guide page added; docs-site build green with all internal links valid. Full feature + docs now done.
<!-- SECTION:NOTES:END -->
