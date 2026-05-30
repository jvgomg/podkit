---
id: TASK-361
title: >-
  Orphan detection coverage for adapter-failure debris (weird extensions,
  mid-write artefacts)
status: To Do
assignee: []
created_date: '2026-05-30 09:59'
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
- [ ] #1 Audit done: classes of adapter-failure debris listed (with which is/isn't currently detectable)
- [ ] #2 Orphan-detection test matrix extended to cover debris scenarios — failures-leaving-files, weird-extension files, manifest/FS mismatch
- [ ] #3 Decision recorded: does podkit add a debris-repair surface, or leave it to manual user cleanup?
<!-- AC:END -->
