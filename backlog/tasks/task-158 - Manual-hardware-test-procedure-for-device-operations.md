---
id: TASK-158
title: Manual hardware test procedure for device operations
status: To Do
assignee: []
created_date: '2026-03-18 12:25'
labels:
  - testing
  - linux
  - cross-platform
milestone: Linux Device Manager
dependencies:
  - TASK-156
  - TASK-150
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Document a manual test checklist for validating device operations on real hardware. Run on macOS, Debian VM (Lima), and Alpine VM (Lima) with a real iPod connected.

Checklist covers:
1. **Device detection** — `podkit device add` finds the iPod
2. **UUID lookup** — `findByVolumeUuid` resolves the correct device
3. **Mount** — `podkit mount` mounts an unmounted iPod (with and without sudo)
4. **Eject** — `podkit eject` cleanly unmounts
5. **iFlash detection** — `assessDevice` correctly identifies iFlash adapter (iFlash iPod available for testing)
6. **Wrong device rejection** — configure mismatched UUID, verify sync refuses

No actual sync — device operations only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Test procedure document exists in repo
- [ ] #2 Covers all 6 test scenarios listed in description
- [ ] #3 Includes expected results for each platform (macOS, Debian, Alpine)
- [ ] #4 Includes setup instructions (Lima VM start, iPod connection)
- [ ] #5 Procedure executed successfully on all 3 platforms
<!-- AC:END -->
