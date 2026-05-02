---
id: TASK-202
title: Transfer mode documentation and changeset
status: Done
assignee: []
created_date: '2026-03-23 14:09'
updated_date: '2026-03-23 17:09'
labels:
  - docs
  - release
milestone: 'Transfer Mode: iPod Support'
dependencies:
  - TASK-195
  - TASK-196
  - TASK-197
  - TASK-198
  - TASK-199
  - TASK-200
  - TASK-201
references:
  - docs/reference/config-file.md
  - docs/reference/environment-variables.md
  - docs/reference/cli-commands.md
  - docs/reference/sync-tags.md
  - docs/user-guide/configuration.md
documentation:
  - backlog/docs/doc-011 - PRD--Transfer-Mode.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update all user-facing documentation for the fileMode → transferMode rename, new three-tier system, and new CLI flags. Create changeset for the release.

**PRD:** DOC-011 (Transfer Mode)

**Documentation updates:**
- `docs/reference/config-file.md` — `transferMode` replaces `fileMode`, document all three values with descriptions
- `docs/reference/environment-variables.md` — `PODKIT_TRANSFER_MODE` replaces `PODKIT_FILE_MODE`, add `PODKIT_FORCE_TRANSFER_MODE`
- `docs/reference/cli-commands.md` — `--transfer-mode` replaces `--file-mode`, add `--force-transfer-mode`
- `docs/reference/sync-tags.md` — `transfer=` replaces `mode=`, document `quality=copy` for direct-copy tracks
- `docs/user-guide/configuration.md` — Update config examples, explain three tiers
- Docker compose example files — Update any `PODKIT_FILE_MODE` references

**Changeset:**
- Minor bump for `podkit` and `@podkit/core`
- Summary: "Replace fileMode with three-tier transferMode system (fast/optimized/portable). Transfer mode now applies to all file types including direct copies. Add --force-transfer-mode flag. Introduce DeviceCapabilities abstraction."
- Note breaking change: `fileMode` config/CLI/env renamed, recommend full resync

**Changelog notes should include:**
- `fileMode` → `transferMode` rename
- New `fast` default (was `optimized`)
- `--file-mode` → `--transfer-mode`
- `PODKIT_FILE_MODE` → `PODKIT_TRANSFER_MODE`
- New `--force-transfer-mode` flag
- Recommend full device resync after upgrading
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Config file docs updated: transferMode with fast/optimized/portable values and descriptions
- [x] #2 Environment variables docs updated: PODKIT_TRANSFER_MODE and PODKIT_FORCE_TRANSFER_MODE
- [x] #3 CLI commands docs updated: --transfer-mode and --force-transfer-mode flags
- [x] #4 Sync tags docs updated: transfer= field and quality=copy for direct-copy tracks
- [x] #5 User guide config examples updated with transferMode
- [x] #6 All references to fileMode/--file-mode/PODKIT_FILE_MODE removed from docs
- [x] #7 Docker compose examples updated if applicable
- [x] #8 Changeset created: minor bump for podkit and @podkit/core with breaking change note
- [x] #9 Changelog notes cover the rename, new default, and resync recommendation
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Updated 5 documentation files and created changeset for the transfer mode feature:

- **config-file.md**: `fileMode` → `transferMode`, added `forceTransferMode`, updated defaults and descriptions
- **environment-variables.md**: `PODKIT_FILE_MODE` → `PODKIT_TRANSFER_MODE`, added `PODKIT_FORCE_TRANSFER_MODE`
- **cli-commands.md**: `--file-mode` → `--transfer-mode`, added `--force-transfer-mode` flag
- **sync-tags.md**: `mode=` → `transfer=`, documented copy-format sync tags with `quality=copy`
- **configuration.md**: Updated quick-reference tables for new option names and defaults
- **Changeset**: Created `.changeset/transfer-mode.md` with minor bumps for `podkit` and `@podkit/core`, documenting all breaking changes and new features. Deleted superseded `file-mode-config.md` changeset.
<!-- SECTION:FINAL_SUMMARY:END -->
