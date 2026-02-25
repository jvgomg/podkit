---
id: TASK-042.04
title: Document libgpod track ID behavior in LIBGPOD.md
status: Done
assignee: []
created_date: '2026-02-25 13:38'
updated_date: '2026-02-25 16:55'
labels:
  - documentation
dependencies: []
parent_task_id: TASK-042
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update docs/LIBGPOD.md to document the track ID behavior findings.

## Add Section: Track Identification

Document:

### Track IDs (`track->id`)
- Assigned by libgpod during `itdb_write()`, not `itdb_track_add()`
- **Reassigned on every export** - not a stable identifier
- libgpod's own docs say `itdb_track_by_id()` is "not really a good idea"
- Only used internally for iTunesDB binary format references

### Track Database IDs (`track->dbid`)
- 64-bit unique identifier
- More stable than `id`, but also assigned during write
- No `itdb_track_by_dbid()` function exists - requires manual iteration

### Pointers (`Itdb_Track*`)
- **The primary reference mechanism** in libgpod
- Remain valid after `itdb_write()`
- Invalidated by `itdb_track_remove()` or `itdb_free()`
- This is how Strawberry and other libgpod users reference tracks

### Implications for libgpod-node
- TrackHandle wraps a pointer internally
- Don't expose `track->id` as a primary identifier
- Operations accept TrackHandle, not numeric IDs

## Add Reference to Strawberry

Note that Strawberry (a major libgpod user) was analyzed and found to:
- Never use `itdb_track_by_id()`
- Pass `Itdb_Track*` pointers through all operations
- Find tracks by iterating `db->tracks` and matching `ipod_path`
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Add: Why getTrackById is not exposed

Document that libgpod-node intentionally does not expose `itdb_track_by_id()` because:

1. libgpod's own documentation says it's "not really a good idea"
2. Track IDs are reassigned on every `itdb_write()` - not stable identifiers
3. The function exists in libgpod only for internal use during iTunesDB import/export
4. Real-world libgpod users (Strawberry) never use it

Instead, use:
- `TrackHandle` for referencing tracks within a session
- Metadata matching (artist/album/title or `ipod_path`) for finding specific tracks

## Implementation Complete

Added comprehensive 'Track Identification' section to docs/LIBGPOD.md covering:
- Track IDs (track->id) behavior and instability
- Database IDs (track->dbid) stability
- Pointer-based references (Itdb_Track*)
- Why getTrackById is not exposed
- How libgpod-node uses TrackHandle
- Real-world validation from Strawberry codebase analysis
<!-- SECTION:NOTES:END -->
