---
id: TASK-069.09
title: Video metadata adapter interface
status: To Do
assignee: []
created_date: '2026-03-08 16:05'
labels:
  - video
  - phase-3
dependencies: []
references:
  - packages/podkit-core/src/adapters/interface.ts
  - docs/adr/ADR-004-collection-sources.md
parent_task_id: TASK-069
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Define the VideoMetadataAdapter interface following the adapter pattern from ADR-004.

This interface allows for extensible metadata sources (embedded, NFO, Plex, etc.).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 VideoMetadataAdapter interface defined
- [ ] #2 VideoMetadata type with common fields (title, year, description, genre)
- [ ] #3 MovieMetadata extending VideoMetadata
- [ ] #4 TVShowMetadata with series, season, episode fields
- [ ] #5 ContentType discriminator ('movie' | 'tvshow')
- [ ] #6 canHandle(filePath) method for adapter selection
- [ ] #7 getMetadata(filePath) async method
- [ ] #8 Interface exported from podkit-core
<!-- AC:END -->
