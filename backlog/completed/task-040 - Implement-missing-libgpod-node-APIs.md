---
id: TASK-040
title: Implement missing libgpod-node APIs
status: Done
assignee: []
created_date: '2026-02-23 22:37'
updated_date: '2026-02-24 00:50'
labels:
  - libgpod-node
  - native-bindings
  - epic
dependencies: []
references:
  - docs/LIBGPOD.md
  - packages/libgpod-node/native/gpod_binding.cc
  - packages/libgpod-node/src/binding.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Expose additional libgpod C APIs through the Node.js bindings. The current implementation covers core database, track, and basic playlist read operations, but many useful APIs remain unwrapped.

This is a parent task tracking the implementation of missing APIs across several categories.
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## TASK-040 Complete: Implement missing libgpod-node APIs\n\nAll 9 subtasks successfully implemented, adding comprehensive libgpod API coverage to the Node.js bindings.\n\n### Subtasks Completed:\n\n1. **TASK-040.01**: getUniqueArtworkIds - artwork deduplication support\n2. **TASK-040.02**: Playlist CRUD - create, delete, rename, track management\n3. **TASK-040.03**: Artwork management - set/remove/check track artwork\n4. **TASK-040.04**: Track updates - modify metadata, get file paths, duplicate tracks\n5. **TASK-040.05**: Device capabilities - capability flags, SysInfo read/write\n6. **TASK-040.06**: Database creation - create new DBs, open from file, set mountpoint\n7. **TASK-040.07**: Smart playlists - rules, preferences, evaluation\n8. **TASK-040.08**: Chapter data - podcast/audiobook chapter markers\n9. **TASK-040.09**: Photo database - separate PhotoDatabase class with full album support\n\n### Metrics:\n- **Total tests**: 270 integration tests\n- **Files restructured**: Native code split from 1 file to 10+, tests split into focused modules\n- **New TypeScript types**: ~30 new interfaces/enums for comprehensive type safety\n\n### Note:\nTASK-040.06 acceptance criteria #3 (database.duplicate) could not be implemented because libgpod's itdb_duplicate() returns NULL - marked as unimplemented in upstream libgpod source."]
<!-- SECTION:FINAL_SUMMARY:END -->
