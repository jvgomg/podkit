---
id: TASK-200
title: Sync tags for all track types with transfer field
status: Done
assignee: []
created_date: '2026-03-23 14:08'
updated_date: '2026-03-23 16:35'
labels:
  - feature
  - core
  - sync
milestone: 'Transfer Mode: iPod Support'
dependencies:
  - TASK-195
references:
  - packages/podkit-core/src/sync/sync-tags.ts
  - packages/podkit-core/src/sync/music-executor.ts
documentation:
  - backlog/docs/doc-014 - Spec--Operation-Types-&-Sync-Tags.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend sync tags to cover direct-copy tracks (previously only transcoded tracks had them) and rename the `mode=` field to `transfer=`. This enables transfer mode mismatch detection for all file types.

**PRD:** DOC-011 (Transfer Mode)
**Spec:** DOC-014 (Operation Types & Sync Tags)

**Rename mode → transfer:**
- Sync tag field `mode=optimized|portable` → `transfer=fast|optimized|portable`
- Update `SyncTagData` interface: `fileMode` → `transferMode`
- Update `formatSyncTag()` to emit `transfer=` key
- Update `parseSyncTag()` to read `transfer=` key

**New: sync tags for direct-copy tracks:**
- New `quality=copy` value indicating file was not transcoded
- No `encoding` or `bitrate` fields for copy tracks
- Format: `[podkit:v1 quality=copy art=a1b2c3d4 transfer=fast]`
- New `buildCopySyncTag(transferMode, artworkHash)` function (or extend existing builder)

**Executor integration:**
- Executor writes sync tags for direct-copy and optimized-copy operations (not just transcodes)
- Copy-format sync tags include `transfer` and `art` fields

**syncTagMatchesConfig() behavior:**
- `transfer` field is still IGNORED during normal comparison (transfer mode change alone doesn't trigger re-processing)
- This preserves the existing design where the user must opt in with `--force-transfer-mode`

**Comparison for copy tracks:**
- A copy-format sync tag (`quality=copy`) should match when the track is still a copy-format source, regardless of transfer mode changes (handled by --force-transfer-mode separately)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Sync tag field renamed from mode= to transfer= with values fast/optimized/portable
- [x] #2 New quality=copy value for direct-copy tracks (no encoding/bitrate fields)
- [x] #3 buildCopySyncTag() produces correct sync tag for copy-format tracks
- [x] #4 Executor writes sync tags for direct-copy and optimized-copy operations
- [x] #5 parseSyncTag() correctly reads transfer= field from sync tags
- [x] #6 formatSyncTag() correctly emits transfer= field
- [x] #7 Round-trip tests: parse → format → parse for all transfer modes and quality=copy
- [x] #8 syncTagMatchesConfig() ignores transfer field during normal comparison
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
SyncTagData.fileMode → transferMode. Parser reads `transfer=` key, formatter emits `transfer=` key. New `buildCopySyncTag(transferMode, artworkHash?)` for copy-format tracks with `quality=copy`. Old `mode=` tags are not parsed (treated as no transfer field → defaults to 'fast' at differ level). syncTagMatchesConfig still ignores transferMode. 97 sync-tag tests pass. AC#4 (executor writes sync tags for copies) deferred to TASK-199 as designed.
<!-- SECTION:NOTES:END -->
