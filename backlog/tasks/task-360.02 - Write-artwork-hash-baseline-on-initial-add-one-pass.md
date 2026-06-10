---
id: TASK-360.02
title: Write artwork-hash baseline on initial add (one-pass)
status: To Do
assignee: []
created_date: '2026-05-28 21:28'
updated_date: '2026-06-09 23:33'
labels:
  - artwork
  - sync
dependencies: []
references:
  - test-packages/e2e-tests/src/features/artwork-change.docker.test.ts
  - packages/podkit-core/src/metadata/sync-tags.ts
parent_task_id: TASK-360
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`features/artwork-change.docker.test.ts:294-318` works around a limitation: a first sync (even with `--check-artwork`) adds tracks without writing the artwork-hash baseline, so a second `--force-sync-tags` pass is needed before artwork-change detection works.

`packages/podkit-core/src/sync/music/handler.ts:677` gates baseline write on `--force-sync-tags`.

## Decision

Write artwork-hash baseline on initial add. First-run users get artwork-change detection on their next sync without an opt-in flag. Small perf cost on first sync (hash computation) is acceptable.

## References

- test-packages/e2e-tests/src/features/artwork-change.docker.test.ts:294-318
- packages/podkit-core/src/metadata/sync-tags.ts
- packages/podkit-core/src/sync/music/handler.ts:677
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Update the baseline-write gate in `sync/music/handler.ts` so the artwork-hash baseline is written on initial track add when artwork is present (no `--force-sync-tags` required)
- [x] #2 Remove the two-pass workaround in `artwork-change.docker.test.ts:294-318`; assert that artwork-change detection fires on the second sync without needing `--force-sync-tags`
- [x] #3 Add unit test: first sync writes baseline; second sync with changed artwork detects the change and re-syncs without `--force-sync-tags`
- [ ] #4 Update release notes / changelog noting that artwork-change detection now works first-run
- [x] #5 `--force-sync-tags` semantics preserved for forced re-baseline use cases (no regression)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation

Investigated the gate at `handler.ts:677` (`postProcessSyncTags`). The gate fires only on `existing` matches and requires `--force-sync-tags` — by design. It is NOT the gate that controls baselines on initial add.

The initial-add baseline write actually lives in `transfer.ts:175-184` (TASK-372/383 era). For both `add-direct-copy`/`add-optimized-copy` and `add-transcode`, after `transferArtwork` returns a non-undefined hash, `writeSyncTag(track, { artworkHash })` lands the baseline. This already runs without `--force-sync-tags`. The docker test's two-pass workaround was stale — it predates the transfer.ts artwork-hash append.

### Changes

- `packages/podkit-core/src/sync/music/handler.ts` — added a doc-comment on `postProcessSyncTags` clarifying the split: initial-add baselines come from `transfer.ts`; this pass is for backfilling rescans only, opt-in via `--force-sync-tags`. Gate semantics unchanged.
- `packages/podkit-core/src/sync/music/pipeline.test.ts` — three new contract tests in the `artworkSink` describe:
  1. `add-direct-copy` + `source.artworkHash` + database sink → baseline written on first sync, prefers `source.artworkHash` over `extractedHash`.
  2. `add-transcode` + `source.artworkHash` → baseline written on first sync (mock adapter round-trips `trackInput.syncTag` so the path mirrors a real adapter).
  3. No `source.artworkHash` + no extracted bytes → no baseline written (only baseline when there is something to baseline).
- `packages/podkit-core/src/sync/music/handler.test.ts` — two new tests under `postProcessSyncTags`:
  - Lossy existing track without baseline is NOT rescanned when `forceSyncTags` is false (preserves existing semantics).
  - Lossy existing track WITH `forceSyncTags` true is rescanned, sync-tag-write op carries the source `artworkHash`.
- `test-packages/e2e-tests/src/features/artwork-change.docker.test.ts` — replaced the two-pass workaround at Step 2 with a single dry-run assertion that the initial sync is already idempotent. Comment explains the contract change.

### Quality gates

- `bun run test:unit --filter @podkit/core` — 3136 pass, 0 fail.
- `bun run test:unit --filter podkit` — 1407 pass, 0 fail.
- `bun run build` — succeeds.
- `bun test test-packages/e2e-tests/src/features/artwork-change.docker.test.ts` — 3/3 pass with workaround removed (Docker + Navidrome required).
- `bunx oxlint` on touched files — clean.

### Notes for TASK-360.03

TASK-360.03 touches the same `handler.ts` (bitrate population on the copy path). The gate-clarifying comment I added is informational only and does not change any control flow — it should not conflict with the bitrate work.
<!-- SECTION:NOTES:END -->
