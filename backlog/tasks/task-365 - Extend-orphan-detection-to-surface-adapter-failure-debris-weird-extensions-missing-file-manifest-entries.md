---
id: TASK-365
title: >-
  Extend orphan-detection to surface adapter-failure debris (weird extensions,
  missing-file manifest entries)
status: To Do
assignee: []
created_date: '2026-05-30 17:46'
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
- [ ] #1 `KNOWN_DEBRIS_EXTENSIONS` set added with `.Audio file` as the first entry; orphan check surfaces these.
- [ ] #2 Symmetric scan added: orphan check also surfaces manifest entries with no matching file on disk.
- [ ] #3 Repair surface extended to (a) delete debris-extension files, (b) remove phantom manifest entries.
- [ ] #4 The two gap-pinning tests in orphans-mass-storage.test.ts are updated to assert the new behaviour (the partial-write test stays gap-pinned).
- [ ] #5 No false positives on the existing "should ignore non-media files" test (user-placed cover.jpg / notes.txt stay invisible).
<!-- SECTION:DESCRIPTION:END -->
<!-- AC:END -->
