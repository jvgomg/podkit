---
id: TASK-071
title: Design collection metadata caching for faster rescans
status: To Do
assignee: []
created_date: '2026-03-08 23:45'
labels:
  - design
  - performance
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Scanning large music collections is slow (1,414 tracks took noticeable time). Each sync requires a full directory scan and metadata parsing with `music-metadata`.

## Goals

1. Cache parsed metadata to avoid re-parsing unchanged files
2. Detect changes efficiently (mtime, hash, or filesystem events)
3. Invalidate cache entries when files change

## Design Questions

1. **Storage format** — SQLite, JSON, or filesystem-based?
2. **Change detection** — File mtime, content hash, or directory watch (fsevents)?
3. **Cache location** — Per-collection cache file, or global cache database?
4. **Cache invalidation** — On-demand (during scan) or background watcher?

## Related

- Extracted from TASK-062 (collection/device management design)
- Should integrate with multi-collection config from ADR-008
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Caching storage format decided
- [ ] #2 Change detection strategy chosen
- [ ] #3 Cache invalidation approach defined
- [ ] #4 ADR created documenting decisions
<!-- AC:END -->
