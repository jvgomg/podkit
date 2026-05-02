---
id: TASK-042.06
title: Review podkit-core sync APIs for correctness after TrackHandle changes
status: Done
assignee: []
created_date: '2026-02-25 13:38'
updated_date: '2026-02-25 16:55'
labels:
  - podkit-core
  - architecture
dependencies:
  - TASK-042
parent_task_id: TASK-042
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After the TrackHandle migration, review podkit-core's public APIs and internal methods to ensure they're designed correctly.

## Review Areas

### Sync Plan Types (`sync/types.ts`)
- `RemoveOperation` has a `track` with `id` field - is this still valid?
- Should sync operations reference tracks by handle or by metadata?
- Consider: sync plans may be serialized/persisted - handles won't survive that

### Collection Adapters
- How do adapters identify tracks for removal?
- Is there a mismatch between collection track IDs and iPod track references?

### Diff Algorithm
- How does diffing work between collection tracks and iPod tracks?
- What identifiers are used for matching?

## Questions to Answer

1. Should `RemoveOperation.track.id` be the iPod's `track->id` or something else?
2. If sync plans are persisted, how do we reference tracks?
3. Is `track->dbid` a better identifier for matching existing tracks?

## Documentation

After review, update:
- `docs/ARCHITECTURE.md` if needed
- Code comments explaining identifier usage
- Any ADRs if significant decisions are made
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Review Complete

Reviewed sync APIs after TrackHandle migration. Key findings:

1. **RemoveOperation.track.id** - Correctly used within session; executor finds handle by matching ID
2. **Sync plans not persisted** - Plans are ephemeral, created and executed in same session
3. **Diff uses metadata matching** - artist/title/album tuples, not IDs
4. **Track IDs are separate** - CollectionTrack.id (string) vs IPodTrack.id (number) never interact

Conclusion: Architecture is correct. No changes needed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Review Complete: podkit-core Sync APIs are Correctly Designed

### Key Findings

**1. RemoveOperation.track.id is RELIABLE (within session)**
- The `IPodTrack.id` corresponds to libgpod's `track->id`
- It's stable within a single database session before `db.save()` is called
- The executor correctly looks up handles by iterating tracks and matching on ID
- Sync plans are created and executed in the same session, so this works correctly

**2. Sync Plans are NOT Persisted (and shouldn't be with current design)**
- No serialization/persistence code exists
- Current workflow: open DB → compute diff → create plan → execute → save → close
- If persistence were needed in the future, `track->dbid` (64-bit, stable across saves) should be used instead of `track->id`

**3. Diff Algorithm Uses Metadata Matching (not IDs)**
- Tracks are matched by normalized (artist, title, album) tuples
- `IPodTrack.id` is only used internally to track "already matched" status
- This is a clean separation: matching by content, operations by reference

**4. Collection Track IDs vs iPod Track IDs are Separate**
- `CollectionTrack.id`: string, implementation-specific (file path hash)
- `IPodTrack.id`: number, libgpod session identifier
- These never interact directly; matching is metadata-based

### Conclusion
**No code changes needed.** The current design is sound for ephemeral sync plans. The architecture cleanly separates:
- Matching (metadata-based)
- Execution (handle-based)  
- Session tracking (id-based)

### Future Consideration
If sync plan persistence becomes a requirement, add `dbid: bigint` to `IPodTrack` and use `db.getTrackByDbId()` for lookups.
<!-- SECTION:FINAL_SUMMARY:END -->
