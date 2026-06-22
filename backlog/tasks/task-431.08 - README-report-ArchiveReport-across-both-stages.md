---
id: TASK-431.08
title: README + report (ArchiveReport across both stages)
status: Done
assignee: []
created_date: '2026-06-22 11:03'
updated_date: '2026-06-22 17:16'
labels:
  - feature
  - ipod
  - archive
dependencies:
  - TASK-431.01
  - TASK-431.03
references:
  - backlog/docs/doc-047 - PRD-iPod-Archive-Command-device-archive.md
parent_task_id: TASK-431
ordinal: 162000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement `ArchiveReport`, an accumulator spanning both stages, and the README generator. Emit `report.md` + `report.json` listing: foreign files skipped, junk skipped (stage 1), and tracks with no audio, tracks with no artwork, and any copy/transform failures (stage 2). Generate `README.md` at the archive root with model, serial, generation, capacity, dump date, podkit version, and library stats (track/size/play-time totals, distinct artists/albums, date-added range, top artists). Non-interactive run → these files are the user's paper trail.

Spec: doc-047 (Stage 2 — report; README content; user stories 26-27).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 report.md + report.json enumerate foreign-skipped, junk-skipped, no-audio, no-artwork, and failure buckets
- [x] #2 README.md at archive root contains device identity, dump date, podkit version, and library stats
- [x] #3 Report aggregates events from both the dump and transform stages
- [x] #4 ArchiveReport tested for the markdown + JSON bucket contents
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented the cross-stage report + README slice.

New module `packages/ipod-archive/src/archive-report.ts`:
- `ArchiveReport` accumulator/renderer. Factories `forTransform(stage2)` (stage-1 absent) and `forDumpOnly(stage1)` (no stage-2); `withStage1(stage1)` returns a new instance folding stage-1 buckets in. `renderMarkdown()` groups buckets under headings with counts, lists, and truncates long lists to REPORT_MARKDOWN_LIST_CAP (50) with an "...and N more" note pointing at report.json; `toJson()` returns the full untruncated structure. Buckets match PRD US-27: stage 1 foreignSkipped/junkSkipped/dumpFailures; stage 2 noAudio/noArtwork/transformFailures/playlistFailures. Transform-only run renders the stage-1 section as "Not available (transform-only run)"; dump-only renders stage 2 as "Not run".
- `computeLibraryStats(tracks)` pure helper: total tracks, total size bytes, total duration ms, distinct (non-blank) artists/albums, earliest/latest timeAdded (null when no positive timeAdded), top-N (10) artists by count with alphabetical tie-break; nameless tracks roll up to "Unknown Artist" in top-N but are excluded from distinct-artist count.
- `renderReadme({identity, dumpDate, podkitVersion, stats})`: device identity card (model/modelNumber/serial/generation/capacity, each degrading to "—"), archive (dump date as UTC ISO instant, podkit version), library stats table + top-artists. `formatBytes` (binary units) / `formatDuration` (Dd HHh MMm SSs) exported helpers.
- Determinism: all sorts use a locale-independent code-point comparator (compareStable), not localeCompare; dates rendered in UTC.

Wiring:
- run-transform.ts: collects the track set during the existing loop (single read), computes stats, and writes README.md + report.md + report.json into archiveDir. New optional `opts.dumpReport: ReportStage1` threads stage-1 buckets in for a both-stages run; absent for standalone `--from-dump` (stage-1 marked not available). New TransformResult fields: readmePath, reportMarkdownPath, reportJsonPath. New exported filename consts.
- run-dump.ts: a `--dump-only` run now emits report.md + report.json at the named archive root via the same ArchiveReport renderer (DRY). New DumpResult fields: report (ReportStage1), reportMarkdownPath, reportJsonPath.
- CLI archive.ts: no new flags; dump + transform summaries now print the README/report paths; JSON output types gained the path fields.
- index.ts: exports the new module + new run-dump/run-transform symbols.

Cross-stage threading: the default both-stages run (CLI not yet fully wired for default) passes `runDump`'s `result.report` into `runTransform` via `opts.dumpReport`; the transform then renders a single unified report covering both stages. Standalone-transform limitation: a `--from-dump` run never saw the dump stage, so stage-1 info is genuinely unavailable — the report marks that section explicitly rather than implying nothing was skipped.

Tests:
- UNIT (archive-report.test.ts, 16 tests): computeLibraryStats totals/distinct/date-range/top-N + ties + Unknown-Artist rollup + whitespace-only names + timeAdded=0 + empty library; formatBytes/formatDuration (incl. interior-zero units); ArchiveReport populated buckets (md + json), determinism regardless of input order, all-empty "nothing skipped" report, transform-only stage-1-absent, dump-only no-stage-2, markdown truncation md-only (json full); renderReadme identity+stats+dumpDate present, and full degradation (null serial/empty identity, empty library).
- INTEGRATION: run-transform.integration.test.ts asserts README.md/report.md/report.json exist with expected sections — no-audio track in the no-audio bucket, both tracks in no-artwork, stats over the full catalogue (3), transform-only marks stage-1 not available; a second test asserts threaded `opts.dumpReport` folds the stage-1 buckets into the report. run-dump.integration.test.ts asserts a --dump-only run emits report.{md,json} listing the skipped foreign file + junk, with stage2=null.

Quality gates (all pass):
- bun run build --filter @podkit/ipod-archive --filter podkit — 12 successful
- bun run typecheck --filter @podkit/ipod-archive --filter podkit — 13 successful
- bun run lint — 0 warnings/0 errors
- bun run test:unit --filter @podkit/ipod-archive — 161 pass / 0 fail
- bun run test:integration --filter @podkit/ipod-archive — 46 pass / 0 fail

Self-review (sonnet agent) addressed: switched all sort keys off localeCompare to a stable code-point comparator (determinism on non-en hosts); replaced the dynamic `import('node:fs/promises')` mkdir in run-dump with the static import; added coverage for timeAdded=0, dumpDate rendering, and interior-zero formatDuration. Known minor (pre-existing, out of scope): a track added to noArtwork before writeTrack can also land in failures if extraction throws — both buckets would list it; left as-is since it predates this slice and belongs to the transform's bucketing logic.
<!-- SECTION:NOTES:END -->
