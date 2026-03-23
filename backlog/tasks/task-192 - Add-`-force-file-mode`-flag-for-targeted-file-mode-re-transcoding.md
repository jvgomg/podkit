---
id: TASK-192
title: Add `--force-file-mode` flag for targeted file mode re-transcoding
status: To Do
assignee: []
created_date: '2026-03-23 11:59'
labels:
  - feature
  - cli
  - transcoding
dependencies:
  - TASK-189
references:
  - packages/podkit-core/src/sync/music-differ.ts
  - packages/podkit-core/src/sync/upgrades.ts
  - packages/podkit-cli/src/commands/sync.ts
  - packages/podkit-cli/src/output/tips.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Currently, when a user changes `fileMode` (e.g., from `optimized` to `portable`), the only way to update existing tracks is `--force-transcode`, which re-transcodes ALL lossless-source tracks — not just those with a mismatched file mode. For large collections this is wasteful.

Add a `--force-file-mode` flag that only re-transcodes tracks whose sync tag `mode` field doesn't match the current `fileMode` setting. This would:
1. Check each existing track's sync tag for `mode=` mismatch
2. Move only mismatched tracks into `toUpdate` with a new `'force-file-mode'` reason
3. Re-transcode those tracks with the current `fileMode` setting
4. Update the `FILE_MODE_MISMATCH_TIP` to recommend `--force-file-mode` instead of `--force-transcode`

This is analogous to how `--force-sync-tags` and `--force-metadata` target specific aspects rather than forcing a full re-process.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `--force-file-mode` CLI flag accepted by sync command
- [ ] #2 `--force-file-mode` only re-transcodes tracks with mismatched sync tag `mode` field
- [ ] #3 Compatible-lossy (MP3, AAC) tracks are unaffected
- [ ] #4 Tip updated to recommend `--force-file-mode` instead of `--force-transcode`
- [ ] #5 Config file and env var support (`forceFileMode`, `PODKIT_FORCE_FILE_MODE`)
- [ ] #6 Shell completions updated
- [ ] #7 Tests cover targeted re-transcode vs full re-transcode behavior
<!-- AC:END -->
