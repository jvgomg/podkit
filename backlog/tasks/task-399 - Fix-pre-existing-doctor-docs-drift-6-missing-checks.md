---
id: TASK-399
title: Fix pre-existing doctor docs drift (6 missing checks)
status: Done
assignee: []
created_date: '2026-06-07 14:25'
updated_date: '2026-06-07 14:40'
labels:
  - documentation
  - doctor
  - diagnostics
  - drift-fix
dependencies: []
references:
  - docs/user-guide/devices/doctor.md
  - docs/reference/cli-commands.md
  - docs/troubleshooting/common-issues.md
  - packages/podkit-core/src/diagnostics/index.ts
priority: medium
ordinal: 115000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

A docs audit found user-facing doctor documentation is significantly drifted from the actual diagnostic-check registry. The registry today contains **11 checks**; the docs name only **5** across the iPod + mass-storage tables.

This task is independent of the upcoming pre-sync sweep / debris-split work (TASK-397 + TASK-398) and lands first so that work starts on a clean docs baseline.

## Drift inventory

**`docs/user-guide/devices/doctor.md`** (primary doctor doc)
- iPod check table lists 4 checks; registry has 7 iPod-applicable. Missing: `video-encoder`, `inquiry-methods`, `udev-rule`, `sysinfo-consistency`, `sysinfo-modelnum-mismatch`.
- Mass-storage check table lists 1 check (`orphan-files-mass-storage`); registry has 4 mass-storage-applicable. Missing: `codec-encoders`, `video-encoder`, `udev-rule`.
- `artwork-reset` is mis-categorised under "SysInfoExtended" in the iPod table — both `artwork-reset` and `sysinfo-extended` are repair-only and need their own table row treatment.
- Quick Start sample output (sample `podkit doctor` run) is stale — doesn't reflect what a real run on an iPod surfaces today.
- "Previewing Repairs" `--dry-run` example list is incomplete (missing `orphan-files-mass-storage`, `sysinfo-extended`, `udev-rule`).

**`docs/reference/cli-commands.md`**
- iPod Checks table omits `udev-rule`, `video-encoder`, `inquiry-methods`, `sysinfo-extended`, `sysinfo-consistency`, `sysinfo-modelnum-mismatch`.
- Mass-Storage Checks table omits `codec-encoders`, `video-encoder`, `udev-rule`.

**`docs/troubleshooting/common-issues.md`**
- "Orphaned files after interrupted sync" only mentions `--repair orphan-files` (iPod). No mass-storage equivalent (`orphan-files-mass-storage`).

## Scope

Doc-only update; no code changes. Each table row should record check id, description, scope (system / database-health), repair confirmation requirement, and `--dry-run` support.

## Why now / why standalone

- Doctor doc tables are the first thing a user reads when troubleshooting; misleading omissions block self-service.
- Lands fast as a small PR; decouples review from the larger TASK-397/398 work.
- TASK-397 + TASK-398 will further mutate these same files; baselining drift first keeps that PR's doc diff focused on net-new content.

## Acceptance

See checklist below. No functional code change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 doctor.md iPod table lists all 7 iPod-applicable checks (artwork-rebuild, artwork-reset, codec-encoders, inquiry-methods, orphan-files, sysinfo-consistency, sysinfo-modelnum-mismatch, video-encoder, udev-rule, sysinfo-extended) with correct scope + repair confirmation columns
- [x] #2 doctor.md Mass-Storage table lists all 4 mass-storage-applicable checks (codec-encoders, orphan-files-mass-storage, udev-rule, video-encoder)
- [x] #3 doctor.md Quick Start sample output regenerated from an actual run (or representative current-state mock)
- [x] #4 doctor.md Previewing Repairs section enumerates --dry-run support for every check that has a repair
- [x] #5 cli-commands.md iPod + Mass-Storage check tables match doctor.md tables 1:1
- [x] #6 common-issues.md 'Orphaned files after interrupted sync' covers both --repair orphan-files (iPod) and --repair orphan-files-mass-storage (mass-storage)
- [x] #7 No code changes — doc-only PR
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Closed pre-existing drift between user-facing doctor docs and the diagnostic-check registry. Three files updated, doc-only:

- **`docs/user-guide/devices/doctor.md`**: iPod check table grew from 4 → 10 rows (added `Codec Encoders`, `Video Encoder (H.264)`, `iPod Firmware Inquiry Methods`, `udev Rule`, `Artwork Reset`, `SysInfoExtended consistency with device`, `SysInfo ModelNumStr vs firmware identity`). Mass-storage table grew from 1 → 4 rows (added `Codec Encoders`, `Video Encoder (H.264)`, `udev Rule`). Quick Start sample output gained a System section + new Database Health rows. Previewing Repairs section enumerates `--dry-run` for every repair, including newly-documented checks.
- **`docs/reference/cli-commands.md`**: iPod + Mass-Storage health-check tables match `doctor.md` 1:1.
- **`docs/troubleshooting/common-issues.md`**: orphan section now covers both iPod (`--repair orphan-files`) and mass-storage (`--repair orphan-files-mass-storage`) repair paths with a `--dry-run` hint.

Sonnet review pass identified 5 issues; 4 valid (applied) and 1 wrong (rejected with code citation — `sysinfo-extended.ts:161` declares `repairOnly: true`; "Failure (repair-only)" label preserved per original doc convention).

Doc edits intentionally documented current state (separate `orphan-files` + `orphan-files-mass-storage` IDs). When TASK-397 lands the unified `--repair orphan-files` (hard removal of the mass-storage variant per design decision), it will rewrite the same docs to the unified IDs.

Committed in `0702ec29` on `main`. No code changes; no changeset needed.
<!-- SECTION:FINAL_SUMMARY:END -->
