---
id: TASK-069.06
title: Video quality preset logic
status: To Do
assignee: []
created_date: '2026-03-08 16:04'
labels:
  - video
  - phase-2
dependencies: []
parent_task_id: TASK-069
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement quality preset mapping that calculates appropriate bitrates based on device profile and preset selection.

Key principle: Quality affects bitrate only, not resolution. Resolution always targets device native.

**Depends on:** TASK-069.01 (Types)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 getVideoPresetSettings(preset, device) returns target bitrates
- [ ] #2 max preset uses device maximum bitrate
- [ ] #3 high preset uses ~80% of max
- [ ] #4 medium preset uses ~50% of max
- [ ] #5 low preset uses ~30% of max
- [ ] #6 Audio bitrate scales appropriately (160/128/128/96 kbps)
- [ ] #7 Presets documented with actual bitrate values per device
- [ ] #8 Unit tests for all preset/device combinations
<!-- AC:END -->
