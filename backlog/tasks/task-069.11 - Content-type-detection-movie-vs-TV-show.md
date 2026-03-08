---
id: TASK-069.11
title: Content type detection (movie vs TV show)
status: To Do
assignee: []
created_date: '2026-03-08 16:05'
labels:
  - video
  - phase-3
dependencies: []
parent_task_id: TASK-069
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement logic to distinguish movies from TV shows based on:
1. Embedded metadata tags (if present)
2. Folder structure patterns
3. Filename patterns

**Depends on:** TASK-069.10 (Embedded adapter)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 detectContentType(filePath, metadata?) returns 'movie' | 'tvshow'
- [ ] #2 Detects TV patterns: S01E01, 1x01, 'Season X'
- [ ] #3 Detects TV folder patterns: /TV Shows/, /Series/
- [ ] #4 Extracts series name, season, episode from patterns
- [ ] #5 Falls back to 'movie' when no TV patterns match
- [ ] #6 Confidence score or explicit override option
- [ ] #7 Unit tests for various naming conventions
<!-- AC:END -->
