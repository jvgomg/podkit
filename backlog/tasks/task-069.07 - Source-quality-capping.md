---
id: TASK-069.07
title: Source quality capping
status: To Do
assignee: []
created_date: '2026-03-08 16:04'
labels:
  - video
  - phase-2
dependencies: []
parent_task_id: TASK-069
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement logic to cap output quality based on source quality, preventing "upscaling" of low-quality content.

Formula: effective = min(preset_target, source_actual)

**Depends on:** TASK-069.04 (Probe), TASK-069.05 (Presets)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 calculateEffectiveSettings(source, preset, device) function
- [ ] #2 Video bitrate capped at source bitrate
- [ ] #3 Resolution capped at source resolution
- [ ] #4 Aspect ratio preserved when downscaling
- [ ] #5 Low quality sources produce appropriately sized outputs
- [ ] #6 Warning generated when source limits output quality
- [ ] #7 Unit tests for various source/preset combinations
<!-- AC:END -->
