---
id: TASK-361
title: >-
  Orphan detection coverage for adapter-failure debris (weird extensions,
  mid-write artefacts)
status: Done
assignee:
  - claude
created_date: '2026-05-30 09:59'
updated_date: '2026-05-30 17:49'
labels:
  - diagnostics
  - mass-storage
  - testing
dependencies: []
priority: low
ordinal: 84000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When a sync fails mid-write — e.g. the OGG-on-echo-mini abort that produced `.Audio file` extensions before TASK-358.01 — the broken files are silently invisible to the orphan-detection diagnostic. `isMediaExtension` only matches an allowlist (`.flac`, `.mp3`, `.m4a`, `.ogg`, `.wav`, …), so an extension that's nothing on that list is silently skipped. This is intentional for `cover.jpg` / `notes.txt`, but means historic broken writes leak storage forever.

Two things this task should produce:

1. **Investigate the real exposure** — search the codebase + a representative real device for what other adapter-failure debris might be on disk. Tag-write failures, partial transcode outputs, dropped temp files. Decide which classes are worth surfacing.

2. **Testing harness around the orphan + repair scenarios.** Today's orphan-detection tests parameterise over content layouts (musicDir, contentPaths, manifest shapes). They don't parameterise over **adapter-failure debris**: half-written files, files with weird extensions, files that the manifest references but the FS doesn't have, etc. Extend the matrix so a future adapter regression that leaves debris on disk has at least one test that flags it.

Probably also wants a `doctor --repair adapter-debris` (or extension to existing) that finds + offers to delete known-broken extensions. Out of scope here unless the investigation surfaces enough exposure to warrant it.

References: the original `.Audio file` bug was `getFileTypeLabel` falling through to `'Audio file'` for `.ogg`/`.wav`/`.aiff` sources — fixed in TASK-358.01. `isMediaExtension` lives in `packages/podkit-core/src/device/mass-storage-utils.ts`; orphan tests at `packages/podkit-core/src/diagnostics/checks/orphans-mass-storage*.test.ts`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Audit done: classes of adapter-failure debris listed (with which is/isn't currently detectable)
- [x] #2 Orphan-detection test matrix extended to cover debris scenarios — failures-leaving-files, weird-extension files, manifest/FS mismatch
- [x] #3 Decision recorded: does podkit add a debris-repair surface, or leave it to manual user cleanup?
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-05-30 (Claude): Audit done by an Explore agent (see TASK-364 and TASK-365 task bodies for the detailed punch list + line citations). Surfaced 8 debris classes — 3 P1 storage leaks (partial copies from non-atomic writes, malformed FFmpeg outputs, `.Audio file` legacy), 3 P2 self-cleaning, 2 P3 cosmetic. The P1 leaks share a root cause: files added to the manifest BEFORE the copy/transcode completes, so the orphan check trusts the manifest and skips them.

AC#2 satisfied by 3 pinning tests in orphans-mass-storage.test.ts ‘adapter-failure debris (current detection gaps)’: (a) `.Audio file` extension invisible to isMediaExtension allowlist; (b) manifest entries pointing to missing files not checked (one-way scan); (c) partial-write debris with recognized extension trusted because it's in the manifest. Each test pins the current (gap) behaviour against the specific detail field a future fix will populate (`debrisCount`, `missingTrackedFiles`) so the flip is unambiguous when the gap closes.

AC#3 decision: split into two follow-up tasks instead of one umbrella, because the implementation sites are orthogonal:
- TASK-364 (Medium): atomic file/manifest writes — closes the *production* gap that creates the debris in the first place. Targets `mass-storage-adapter.ts` copy + manifest writes and `pipeline.ts` FFmpeg output paths.
- TASK-365 (Low): extend orphan-detection to surface known-broken extensions + add a symmetric scan for phantom manifest entries. Closes the *detection* gap for debris that's already on disk (e.g. from pre-fix syncs).

Deliberately did not add `.Audio file` to the AUDIO_EXTENSIONS allowlist in this task. That would be a one-line fix but it would mix detection and production concerns and would also poison `isAudioExtension` for unrelated callers. The right shape is a separate `KNOWN_DEBRIS_EXTENSIONS` set surfaced through a separate detail field (TASK-365).

Pre-commit sonnet review caught two real false-pass risks: test #1 only asserted orphanCount=0 (a fix that flips status but uses a separate debrisCount field would satisfy the test without actually catching the debris); test #2 had the same shape for missingTrackedFiles. Added explicit `toBeUndefined()` assertions on those specific fields. Also corrected a misleading line-number comment (mass-storage-utils.ts:75 → :478 for `isMediaExtension`).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Investigated adapter-failure debris classes, extended the orphan-detection test matrix with 3 pinning tests for current detection gaps, and filed two scoped follow-up tasks (TASK-364 production fix via atomic writes; TASK-365 detection-side enhancement).

## Audit (AC#1)

8 debris classes surfaced via Explore agent. Three P1 storage-leak classes all share a root cause: files added to the manifest before the copy/transcode completes, so the orphan check trusts the manifest and skips them. Full punch list with `file:line` citations lives in the TASK-364 and TASK-365 bodies.

## Test matrix (AC#2)

Added `adapter-failure debris (current detection gaps)` describe block to `packages/podkit-core/src/diagnostics/checks/orphans-mass-storage.test.ts` with 3 pinning tests:

1. `.Audio file` legacy extension — pins that `isMediaExtension` skips it (`orphanCount: 0`, `debrisCount: undefined`).
2. Phantom manifest entry — pins that the one-way scan misses it (`orphanCount: 0`, `missingTrackedFiles: undefined`).
3. Partial write with recognized extension — pins that the manifest-trusts-bytes path can't catch it.

Each test asserts against the **specific detail field a future fix will populate**, so the flip is unambiguous and a fix that uses the wrong field can't satisfy the test.

## Decision (AC#3)

Two follow-up tasks rather than one umbrella:

- **TASK-364** (Medium, production-side): atomic file/manifest writes — closes the gap that creates debris in the first place.
- **TASK-365** (Low, detection-side): `KNOWN_DEBRIS_EXTENSIONS` allowlist + symmetric manifest scan — closes the gap for debris already on disk.

Rationale: orthogonal implementation sites, different priority, independent reviewability. Folding into one umbrella would blur the shipping signal.

Deliberately did not extend the `AUDIO_EXTENSIONS` allowlist in this task — that would poison `isAudioExtension` for unrelated callers. The right shape is a separate detail field.

## Tests

- `bun test packages/podkit-core/src/diagnostics/checks/orphans-mass-storage.test.ts` → 22 pass / 0 fail (was 19 + 3 new).
- typecheck + lint clean.

## Pre-commit review

Sonnet caught two real false-pass risks in the original pinning tests (assertions on the wrong field) and a misleading line-number comment. All addressed before commit.
<!-- SECTION:FINAL_SUMMARY:END -->
