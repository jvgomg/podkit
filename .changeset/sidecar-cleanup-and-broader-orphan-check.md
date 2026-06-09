---
'@podkit/core': minor
'podkit': minor
---

Sidecar lifecycle cleanup + broader orphan-files surface (TASK-375).

**Sync-time sidecar cleanup (mass-storage, sidecar-primary devices).**
`MassStorageAdapter.removeTrack` and `relocateTrack` now drop the
album's `cover.jpg` when the last managed audio file leaves the
directory. The delete is queued at the moment of removal and flushed
in a new `save()` stage that re-evaluates the predicate per entry, so
a re-add inside the same save cycle (whether through `writeSidecar` or
via a pipeline that skipped artwork on a hash match) cleanly cancels
the queued delete. The previous behaviour left a dangling `cover.jpg`
and a stale manifest entry forever; sync-time cleanup keeps the
invariant "every managed sidecar has at least one managed audio
sibling in its dir" alive.

**Doctor's orphan-files check no longer filters by extension.** The
mass-storage walker previously surfaced only audio/video files as
orphan candidates. Any other file in your content directories
(sidecar images, lyrics `.lrc`, playlist `.m3u`, stray documents) was
silently dropped. Now the check considers any non-debris file in the
configured content roots — confirmation-gated repair stays unchanged
so you review the list before anything is deleted. This is the
backstop for sidecars on devices that synced before sync-time cleanup
existed, and surfaces unmanaged user-placed files in podkit's
territory you may want to clear out.

**Migration:** on a rockbox device with a pre-existing user-placed
`cover.jpg` that podkit never wrote, the orphan check will now flag
it. The confirmation prompt is your safety; review before repairing.
After deletion, the next sync re-issues a managed sidecar.
