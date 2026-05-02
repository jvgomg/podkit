---
id: TASK-136.05
title: Update docs for self-healing sync
status: Done
assignee: []
created_date: '2026-03-14 13:57'
updated_date: '2026-03-14 15:23'
labels:
  - sync
  - docs
dependencies: []
references:
  - docs/reference/config-file.md
  - docs/reference/cli-commands.md
  - adr/adr-009-self-healing-sync.md
parent_task_id: TASK-136
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update documentation to cover the self-healing sync feature.

**Config file reference** (`docs/reference/config-file.md`):
- Add `skipUpgrades` to global settings table
- Add `skipUpgrades` to device settings table
- Update the full example to show `skipUpgrades` usage

**CLI commands reference** (`docs/reference/cli-commands.md`):
- Add `--skip-upgrades` flag to sync command documentation

**User guide — syncing** (new or existing page):
- Explain what self-healing sync does (automatic detection and upgrade of improved source files)
- List the upgrade categories with examples
- Explain that play counts, ratings, and playlists are preserved
- Show dry-run output example
- Document `skipUpgrades` config and `--skip-upgrades` flag

**ADR-009:**
- Update status from Proposed to Accepted once implementation begins
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Config file reference includes skipUpgrades in global and device tables
- [x] #2 CLI commands reference includes --skip-upgrades flag
- [x] #3 User guide explains self-healing sync with examples
- [x] #4 ADR-009 status updated to Accepted
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
### Documentation Updated\n\n- **ADR-009:** Status changed from Proposed to Accepted\n- **Config file reference:** Already had `skipUpgrades` from .03 — confirmed complete\n- **CLI commands reference:** Added `--skip-upgrades` to sync options table\n- **New page:** `docs/user-guide/syncing/upgrades.md` — covers detection, categories, preserved data, dry-run output, skip config\n- **AGENTS.md:** Documentation Map updated with new page
<!-- SECTION:NOTES:END -->
