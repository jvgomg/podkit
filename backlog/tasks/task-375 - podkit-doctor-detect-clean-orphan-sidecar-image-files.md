---
id: TASK-375
title: 'podkit doctor: detect + clean orphan sidecar image files'
status: Done
assignee: []
created_date: '2026-06-03 08:47'
updated_date: '2026-06-09 18:51'
labels:
  - enhancement
  - doctor
  - artwork
  - sidecar
  - mass-storage
dependencies:
  - TASK-370
  - TASK-397
references:
  - packages/podkit-core/src/diagnostics/
  - packages/podkit-core/src/artwork/repair.ts
  - docs/user-guide/devices/doctor.md
priority: low
ordinal: 101000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

Once TASK-370 lands and podkit writes peer `cover.jpg` (or whatever the device-profile sidecar filename is — see TASK-374), the device gains a new failure mode: stale `cover.jpg` files left behind when audio tracks are removed/relocated without their album.

Today `podkit doctor` does not know about sidecar artwork files. After TASK-370, an album removed from the source (or moved by a path-template change) could leave its `cover.jpg` sitting on the device pointing at nothing — wasted bytes + a confusing user experience if they browse the filesystem.

Mirror existing orphan checks: `cleanupOrphanedIthmb` in `artwork/repair.ts` already handles iPod `.ithmb` orphans after a libgpod save.

## Scope

1. New diagnostic check in `podkit-core/src/diagnostics/checks/` — `sidecar-orphan-images.ts` (or fold into an existing artwork diagnostic). Walks the mass-storage music tree, collects every sidecar filename matching the device preset (cover.jpg / folder.jpg / whichever the preset declares), and reports any whose parent dir has no audio tracks indexed.
2. `podkit doctor --repair sidecar-orphans` repair action (or fold into an existing `--repair artwork-*` flow) that deletes the orphan files. Per the doctor-repair convention: requires explicit `--repair`, prints what it'd delete in dry-run mode.
3. Doc the new check in `docs/user-guide/devices/doctor.md`.
4. Test fixture: mass-storage target with a stale cover.jpg whose audio peers are absent → check flags + repair cleans.

## Why deferred

No orphans can exist until TASK-370 writes sidecars. File-and-defer.

## Notes

- The orphan-detection rule is "directory contains a sidecar filename and zero audio files podkit recognises". Be careful with subdirectories — if an album has a subdir like `disc 1/` with its own cover, both layers should be respected. A simple version: only flag a sidecar as orphan when its parent dir contains zero files of any audio extension.
- Touches the path template — if podkit's pathTemplate changed and the doctor runs, the orphan walk would find the old layout. That's actually desirable (cleans up the previous layout) but worth surfacing in the dry-run preview.
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Landed in commit fa589717 — `feat(sync): sidecar cleanup on album abandonment + broaden orphan check`.

Rescoped during planning. Original spec: build a dedicated `sidecar-orphan-images` doctor check + repair. Final shape: drop the walker's media-extension whitelist so the existing `orphan-files-mass-storage` check surfaces any non-debris file under the configured content roots (sidecar images, lyrics `.lrc`, playlist `.m3u`, stray documents). Paired with sync-time cleanup so the doctor backstop rarely fires.

## What landed

**Sync-time sidecar cleanup** (`packages/podkit-core/src/device/mass-storage-adapter.ts`):
- New `pendingSidecarDeletes` set keyed by album dir, paired with `pendingSidecarWrites`.
- `removeTrack` (last managed audio leaves dir) and `relocateTrack` (cross-album move, source dir loses its last track) call `maybeQueueSidecarDelete`.
- `writeSidecar` clears any pending delete for the same dir (write-wins on a single save cycle).
- New `flushSidecarDeletes` save stage runs AFTER `flushSidecarWrites`. Per-entry predicate is re-evaluated against the final `this.tracks` state + pending-move destinations so a re-add bypassing `writeSidecar` (artwork hash matched → pipeline skipped) cleanly cancels the queued delete. `managedFiles` mutation is deferred to flush time for the same reason.
- ENOENT on unlink is silent success (legacy data with no on-disk cover.jpg still needs the manifest entry dropped). Other unlink errors aggregate into `SidecarWriteError` symmetric with the write stage.
- `removeTrackArtwork` stale comment ("orphan-cleanup path in the doctor handles that case") rewritten to point at the new sync-time helper.

**Walker scope broadened** (`packages/podkit-core/src/diagnostics/scanners/mass-storage-walker.ts`):
- Drops the `isMediaExtension` whitelist. Any non-debris, non-dotfile file inside the configured content roots is now a content candidate. The orphan check derives its repair-confidence policy from the existing confirmation prompt, not from extension gating.
- Internal `scanFiles` return renamed `media → content`; external `MassStorageScanResult` field names (`orphans`/`debris`/`missingTrackedFiles`/`totalFiles`) unchanged.
- `totalFiles` semantics shift: now counts all non-debris content surveyed, not just media. Pass-summary line is honest about the broader scope.

**Tests**:
- 11 new sidecar-cleanup adapter tests covering: last-sibling removal, sibling stays, `deleteFile: false`, embedded-sink no-op, cross-album relocate (last/one-of-many), write-wins, flush-time re-eval cancels stale delete, ENOENT silent, non-ENOENT typed error.
- 3 walker scope tests in `orphans-mass-storage.test.ts`: non-audio files surface as orphans; tracked sidecars don't; abandoned cover.jpg flagged.
- 1 e2e in `mass-storage-sync.test.ts`: plant a `cover.jpg` next to managed audio on echo-mini, `podkit doctor --json` flags it, `podkit doctor --repair orphan-files` deletes it without touching managed audio.

**Docs**:
- `documents/architecture/sync/save-transactions.md`: stage table grew to 6 (added sidecar-deletes row), new "Asymmetry 3" explaining why deletes re-evaluate the predicate at flush time, sidecar lifecycle invariant under Responsibility Boundaries (plus the load-bearing `replaceTrackFile is dir-stable` claim).
- `documents/architecture/sync/error-handling.md` SidecarWriteError row reads "write OR delete failures".
- `docs/user-guide/devices/doctor.md` orphan-files section updated: any unmanaged file under content roots is a candidate; explicit note that on a rockbox device a user-placed cover.jpg deleted via repair leaves the device with no art until next sync re-issues a managed sidecar.

## Reviews

Opus pre-implementation review caught the load-bearing blocker (queue-time-only `albumDirStillOccupied` would let a hash-matched re-add lose its cover.jpg; the fix is flush-time predicate re-evaluation, deferring `managedFiles` mutation to flush). Sonnet post-implementation review found one stage-number typo in save-transactions.md (5 → 6) and one stale row description in error-handling.md — both applied before commit.

## Test results
- 3102 core unit tests pass (incl. 11 new + 3 walker scope)
- 69 integration pass
- 33 e2e pass (mass-storage-sync 111.9s clean with new doctor test; art-matrix 378.3s clean)

## Pair task
- TASK-374 (`Device-profile sidecar filename preset`) closed as won't-do: no concrete second sidecar device exists in roadmap or `devices/`. Adding a `sidecarFilename` capability field is hypothetical complexity; reopen when a real second device shows up.
<!-- SECTION:FINAL_SUMMARY:END -->
