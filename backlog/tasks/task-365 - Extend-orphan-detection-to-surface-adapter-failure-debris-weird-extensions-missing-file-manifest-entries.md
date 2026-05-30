---
id: TASK-365
title: >-
  Extend orphan-detection to surface adapter-failure debris (weird extensions,
  missing-file manifest entries)
status: Done
assignee: []
created_date: '2026-05-30 17:46'
updated_date: '2026-05-30 21:10'
labels:
  - diagnostics
  - mass-storage
  - doctor
dependencies: []
priority: low
ordinal: 88000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Surfaced by

TASK-361 audit + pinning tests in `packages/podkit-core/src/diagnostics/checks/orphans-mass-storage.test.ts` "adapter-failure debris" describe block.

## Three gaps to close

### 1. Weird-extension legacy debris (e.g. `.Audio file`)

`isMediaExtension` (`packages/podkit-core/src/device/mass-storage-utils.ts:478`) only matches the `AUDIO_EXTENSIONS` + `VIDEO_EXTENSIONS` allowlists. Files left by pre-TASK-358.01 aborted syncs with literal extensions like `.Audio file` are silently skipped by the orphan scan.

**Fix shape:** add a `KNOWN_DEBRIS_EXTENSIONS` set to `mass-storage-utils.ts` (e.g. `'.Audio file'`, `'.partial'`, `'.podkit-tmp'`, etc. — whatever shows up after the atomic-write fix in the sibling task). Extend the orphan check to also surface these as debris (probably a separate detail field so they don't get conflated with user-placed non-media files).

### 2. Manifest entries pointing to missing files

The orphan check is one-way: files-on-disk-not-in-manifest. A sync that aborted after writing the manifest entry but before the file copy completed leaves a phantom manifest entry. This is invisible today.

**Fix shape:** add a symmetric pass — for each entry in `managedFiles`, verify the file exists. Surface missing ones in a new detail field (`missingTrackedFiles`). Repair surface: remove the phantom entries from the manifest.

### 3. Partial-write debris (file present, in manifest, corrupt)

Files that ARE in the manifest but are only partially written (e.g. interrupted ffmpeg output). Currently invisible because the orphan check trusts the manifest.

**Fix shape:** out of scope for this task — needs a size/checksum probe or atomic writes to detect. Tracked under the atomic-writes task; mention here for completeness.

## Pinning tests

The three "adapter-failure debris (current detection gaps)" tests in `orphans-mass-storage.test.ts` pin the current (gap) behaviour. When this task lands, those tests need to flip to assert the new (caught) behaviour:

- Gap #1 → expect `status: 'warn'`, `orphanCount: 1`, debris flagged in details
- Gap #2 → expect `status: 'warn'`, missingTrackedFiles flagged in details
- Gap #3 → stays gap-pinned (deferred to atomic-writes task)

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `KNOWN_DEBRIS_EXTENSIONS` set added with `.Audio file` as the first entry; orphan check surfaces these.
- [x] #2 Symmetric scan added: orphan check also surfaces manifest entries with no matching file on disk.
- [x] #3 Repair surface extended to (a) delete debris-extension files, (b) remove phantom manifest entries.
- [x] #4 The two gap-pinning tests in orphans-mass-storage.test.ts are updated to assert the new behaviour (the partial-write test stays gap-pinned).
- [x] #5 No false positives on the existing "should ignore non-media files" test (user-placed cover.jpg / notes.txt stay invisible).
<!-- SECTION:DESCRIPTION:END -->

<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-05-30 (Claude / Opus 4.7): Landed in commit `6b0b536e` — "feat(diagnostics): orphan-check surfaces adapter-failure debris + missing manifest entries".

**Implementation**

- `mass-storage-utils.ts`: added `KNOWN_DEBRIS_EXTENSIONS = new Set(['.Audio file', '.podkit-tmp'])` + `isDebrisExtension(ext)` helper. (`.podkit-tmp` covers in-flight residue from the atomic-fs helper introduced in TASK-364.)
- `orphans-mass-storage.ts`:
  - `scanMediaFiles` → `scanFiles`, returns `{ media, debris }` (one walk, two predicates; media wins on overlap — none today).
  - `findOrphans` → `findIssues`, also returns `debrisPaths` + `missingTrackedFiles`. Symmetric pass stats each manifest entry in parallel.
  - `check()` surfaces `debrisCount`, `debris`, `missingTrackedFiles` in details; `status: warn` if any non-zero. Summary text built from non-zero parts so existing assertions on "${N} orphan files" remain valid when orphans are the only class.
  - `repair.run()` deletes orphans + debris uniformly, then prunes phantom manifest entries via `atomicWriteFile` (re-reads manifest from disk, NFC-normalises the missing set, filters managedFiles, writes via the same atomic helper from TASK-364).

**Result-shape changes**

Additive only — `orphanCount`, `wastedBytes`, `orphans` keys unchanged so the existing e2e test in `test-packages/e2e-tests/src/features/mass-storage-sync.test.ts` (lines 1010-1148) keeps passing. New keys: `debrisCount`, `debris`, `missingTrackedFiles`, `phantomsPruned`. Repair "Nothing to clean up" replaces "No orphan files to delete" — same condition, accurate wording given broader scope.

**Pinning tests**

The "adapter-failure debris" describe block in `orphans-mass-storage.test.ts`:
- Test #1 (`.Audio file` legacy debris): flipped to assert `status: warn`, `debrisCount: 1`, debris path includes the filename.
- Test #2 (manifest entries pointing to missing files): flipped to assert `status: warn`, `missingTrackedFiles: ['Music/Artist/Album/02 - Missing.m4a']`.
- Test #3 (partial-write of file still tracked): stays gap-pinned. The `stat()` symmetric pass only checks existence, not content. Closing this needs a size/checksum probe — out of scope here.
- New test added: `.podkit-tmp` in-flight residue → caught as debris.

**Repair tests added**

- Debris files deleted alongside orphans (.Audio file + .podkit-tmp).
- Phantom manifest entries pruned via atomic rewrite.
- Dry-run reports all three issue classes without writing.

**Sonnet review caught**

- P2: `phantomsPruned` was assigned before `atomicWriteFile` call; a failed rewrite reported non-zero pruned alongside the error. Moved assignment to after the write.
- P2: "No orphan files to delete" early-return summary misleading now that phantom-prune is in scope. Changed to "Nothing to clean up".

**Gates**

typecheck (core + e2e), oxlint, unit (2831 / 0 fail), integration (12 / 0), targeted e2e (mass-storage-sync, 1 / 0) — all green locally on macOS. Linux not validated.

**Follow-ups**

- Test #3 partial-write gap remains. Would need either size/checksum verification or stronger atomic-write guarantees on the data side. Track separately if/when prioritised.
<!-- SECTION:NOTES:END -->
