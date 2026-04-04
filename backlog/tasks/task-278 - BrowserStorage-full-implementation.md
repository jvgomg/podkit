---
id: TASK-278
title: BrowserStorage full implementation
status: To Do
assignee: []
created_date: '2026-04-03 20:19'
labels:
  - ipod-web
  - storage
  - deferred
milestone: m-17
dependencies:
  - TASK-117
references:
  - doc-028
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the full `BrowserStorage` class that allows ipod-web to work standalone in a browser without any backend server. Users would drag-drop music files or load a pre-built iPod image to populate the virtual iPod.

**Blocked on:** ipod-db write support (m-8 Phase 2, TASK-117) — needed to create iTunesDB from imported files.

**Approach (when unblocked):**
- Store iPod filesystem in IndexedDB or OPFS (Origin Private File System)
- Drag-drop music files → extract metadata (via Web Audio API or a lightweight tag parser) → create tracks in ipod-db → write iTunesDB to storage
- Audio playback via blob URLs from stored files
- Persist across browser sessions

This task replaces the stub that currently throws "not yet implemented".
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 BrowserStorage implements full StorageProvider interface
- [ ] #2 Users can drag-drop audio files to populate the virtual iPod
- [ ] #3 iTunesDB created from imported files using ipod-db write support
- [ ] #4 Data persists across browser sessions via IndexedDB or OPFS
- [ ] #5 Audio plays from stored files via blob URLs
<!-- AC:END -->
