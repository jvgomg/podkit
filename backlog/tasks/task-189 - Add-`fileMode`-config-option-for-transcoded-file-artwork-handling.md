---
id: TASK-189
title: Add `fileMode` config option for transcoded file artwork handling
status: Done
assignee: []
created_date: '2026-03-23 11:33'
updated_date: '2026-03-23 11:48'
labels:
  - feature
  - config
  - transcoding
dependencies: []
references:
  - packages/podkit-core/src/transcode/types.ts
  - packages/podkit-core/src/transcode/ffmpeg.ts
  - packages/podkit-core/src/sync/sync-tags.ts
  - packages/podkit-core/src/sync/music-executor.ts
  - packages/podkit-cli/src/config/types.ts
  - packages/podkit-cli/src/config/loader.ts
  - packages/podkit-cli/src/commands/sync.ts
  - packages/podkit-cli/src/commands/sync-presenter.ts
  - packages/podkit-cli/src/commands/music-presenter.ts
  - packages/podkit-cli/src/output/tips.ts
  - packages/podkit-cli/src/commands/init.ts
documentation:
  - docs/reference/config-file.md
  - docs/reference/environment-variables.md
  - docs/reference/cli-commands.md
  - docs/reference/sync-tags.md
  - docs/user-guide/configuration.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a `fileMode: "optimized" | "portable"` config option that controls whether embedded artwork is stripped from or preserved in transcoded files.

**Context:** When podkit transcodes FLAC→AAC/ALAC, the FFmpeg args had a bug: both `-c:v copy -disposition:v attached_pic` (copy artwork) and `-vn` (strip video) were present. These contradict each other — `-vn` wins, so artwork was accidentally stripped. iPods read artwork from their internal database (via `track.setArtworkFromData()`), not from embedded file data, so embedded artwork is dead weight on a capacity-constrained device.

**What was implemented:**
- `FileMode` type (`'optimized' | 'portable'`) in `@podkit/core` with `FILE_MODES` array and `isValidFileMode()` validator
- Fixed the FFmpeg arg bug: `optimized` (default) emits `-vn` only, `portable` emits `-c:v copy -disposition:v attached_pic` only
- `fileMode` threaded through: config types → loader (file/env/device) → merge → CLI flag (`--file-mode`) → `deriveSettings()` → `MusicContentConfig` → executor → transcoder + sync tags
- `mode=optimized|portable` field in sync tags (informational only — does NOT trigger re-transcoding via `syncTagMatchesConfig`)
- `FILE_MODE_MISMATCH_TIP` in tips framework counting existing tracks whose sync tag mode differs from current setting
- Config template, documentation (config-file, env-vars, cli-commands, sync-tags, user-guide, docker-compose)
- Tests: FFmpeg args (AAC + ALAC, both modes), sync tags (parse/format/round-trip/comparison ignores fileMode), config loader (file/env/device/merge), tips

**What remains (3 INCOMPLETE items in acceptance criteria).**

Only affects transcoded files. Direct-copy formats (MP3, M4A) are left as-is. No config migration needed — new optional field with sensible default.

---

**Detail for INCOMPLETE item 1 — Legacy sync tag handling:**

`collectPostDiffData()` in `music-presenter.ts` compares `syncTag.fileMode !== effectiveFileMode`. Tracks synced before this feature have `fileMode === undefined`, which won't equal `'optimized'`, so ALL existing tracks will be counted as mismatches on first sync. Fix: treat `undefined` as `'optimized'` (matching the old buggy behavior where `-vn` won) so the tip only fires when a user actually changes to `portable`. Change the comparison in `collectPostDiffData` to: `const tagMode = syncTag?.fileMode ?? 'optimized'; if (tagMode !== effectiveFileMode)` instead of `if (syncTag && syncTag.fileMode !== effectiveFileMode)`.

**Detail for INCOMPLETE item 2 — `--force-transcode` scope:**

The mismatch tip tells users to run `--force-transcode` to update file mode, but `--force-transcode` re-transcodes ALL lossless-source tracks, not just file-mode mismatches. Options: (a) add a more targeted flag like `--force-file-mode`, (b) adjust the tip wording to clarify blast radius (e.g. "Use --force-transcode to re-transcode all tracks, including updating file mode"), or (c) accept the current behavior as good enough. At minimum the tip should be clear about what `--force-transcode` does.

**Detail for INCOMPLETE item 3 — Changeset:**

User-facing changes to `podkit` and `@podkit/core` require a changeset before merging. Run `bunx changeset` and create a minor changeset for both packages. Summary: "Add fileMode config option to control embedded artwork in transcoded files. Fixes contradicting FFmpeg args." Minor bump per project convention (new feature, no breaking change).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 DONE: `FileMode` type defined in `@podkit/core` with `FILE_MODES` array and `isValidFileMode()` validator, exported from core index
- [ ] #2 DONE: FFmpeg bug fixed — `buildTranscodeArgs()` and `buildAlacArgs()` no longer emit contradicting `-c:v copy` + `-vn`
- [ ] #3 DONE: `fileMode` accepted from config file (global + per-device), `PODKIT_FILE_MODE` env var, and `--file-mode` CLI flag
- [ ] #4 DONE: `fileMode` threaded through executor to `FFmpegTranscoder.transcode()` and stored in sync tags as `mode=` field
- [ ] #5 DONE: `syncTagMatchesConfig()` ignores `fileMode` — informational only, does not trigger re-transcoding
- [ ] #6 DONE: `FILE_MODE_MISMATCH_TIP` fires when existing tracks have a different `mode` than current `fileMode`
- [ ] #7 DONE: All tests pass — FFmpeg args, sync tags, config loader, tips, e2e
- [ ] #8 DONE: Documentation updated — config-file, env-vars, cli-commands, sync-tags, user-guide, docker-compose
- [x] #9 INCOMPLETE: Fix legacy sync tag handling — treat missing `fileMode` as `'optimized'` so existing users don't see false mismatch tip. See description for detail.
- [x] #10 INCOMPLETE: Clarify `--force-transcode` scope in tip message, or consider a targeted flag. See description for detail.
- [x] #11 INCOMPLETE: Create changeset via `bunx changeset` — minor bump for `podkit` and `@podkit/core`. See description for detail.
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Completed the three remaining items:

**#9 — Legacy sync tag handling:** Changed `collectPostDiffData()` in `music-presenter.ts` to treat missing `fileMode` in sync tags as `'optimized'` (`syncTag.fileMode ?? 'optimized'`). This prevents false mismatch tips for existing users whose tracks were synced before the `fileMode` feature was introduced.

**#10 — Tip message clarity:** Updated `FILE_MODE_MISMATCH_TIP` to say "re-transcode all lossless-source tracks" instead of "re-transcode them", clarifying that `--force-transcode` affects all lossless-source tracks, not just file-mode mismatches.

**#11 — Changeset:** Created `.changeset/file-mode-config.md` with minor bumps for `podkit` and `@podkit/core`.

All 58 podkit-cli tests pass. Follow-up work tracked in TASK-190 (ALAC fileMode support) and TASK-191 (investigate fileMode for direct-copy formats).
<!-- SECTION:FINAL_SUMMARY:END -->
