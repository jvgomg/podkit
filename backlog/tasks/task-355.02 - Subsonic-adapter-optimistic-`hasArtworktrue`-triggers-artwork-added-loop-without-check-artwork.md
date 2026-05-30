---
id: TASK-355.02
title: >-
  Subsonic adapter optimistic `hasArtwork=true` triggers artwork-added loop
  without --check-artwork
status: Done
assignee:
  - claude
created_date: '2026-05-26 22:49'
updated_date: '2026-05-30 14:23'
labels:
  - bug
  - artwork
  - subsonic
  - sync-loop
dependencies:
  - TASK-142
references:
  - 'packages/podkit-core/src/adapters/subsonic.ts:540'
  - 'packages/podkit-core/src/sync/engine/upgrades.ts:274'
  - test-packages/e2e-tests/src/features/art-matrix.docker.test.ts
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
parent_task_id: TASK-355
priority: high
ordinal: 62000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Symptom

When syncing from a Subsonic/Navidrome source *without* `--check-artwork`, every cell where the downloaded source file has no embedded art but Navidrome reports a `coverArt` ID produces an `artwork-added` upgrade on every second sync. The sync is never idempotent — running it five times re-transfers the file five times.

The art-matrix.docker.test.ts predictor encodes this as current behaviour. Affected cells:

- All scenario-A cells (no art anywhere) — Navidrome serves a placeholder, the adapter trusts the non-empty `coverArt` ID and sets `hasArtwork=true`.
- All sidecar cells (C-sidecar, D-both) where the format can't embed in the file body — `cover.jpg` is served via `/getCoverArt` but never threaded into the audio stream.
- Embedded scenarios for formats that can't carry attached_pic (WAV/OGG/Opus) when no embed-capable sibling poisons the album cache the right way.

## Root cause

`packages/podkit-core/src/adapters/subsonic.ts:540-552`:

```ts
if (this.checkArtwork && song.coverArt) {
  const artworkInfo = await this.fetchArtworkInfo(song.coverArt);
  hasArtwork = artworkInfo.hasArtwork;
  artworkHash = artworkInfo.hash;
} else if (song.coverArt) {
  // coverArt ID exists but we're not fetching — optimistically report true.
  hasArtwork = true;
} else {
  hasArtwork = false;
}
```

Without `--check-artwork`, the adapter trusts the coverArt ID. Navidrome populates that field for every track in every album (it generates an album-level placeholder if nothing else), so `source.hasArtwork` is true for tracks that have no real art. `detectUpgrades` then sees source=true && device=false, has no `artworkHash` to compare via the syncTag escape hatch, and fires `artwork-added` indefinitely.

## Why the existing escape hatch doesn't help

The artwork-added rule in `packages/podkit-core/src/sync/engine/upgrades.ts:274-283` falls back to the syncTag hash only when `source.artworkHash` is set. Without `--check-artwork` the hash is undefined, so the rule degrades to "fire whenever asymmetric" — exactly the loop.

## Suggested directions (pick one in the fix)

1. **Drop optimistic-true**: set `hasArtwork = undefined` when `coverArt` is present but the adapter isn't fetching. Downstream `detectUpgrades` treats `undefined` as "don't compare", short-circuiting the loop. Downside: tracks with real embedded art that survives the stream lose their `hasArtwork=true` signal.
2. **Always validate at connect time**: probe Navidrome's placeholder hash on connect (already done when `--check-artwork` is on at `subsonic.ts:317-322`), and gate the optimistic-true on whether the server is known to return per-track real art. Heavier but more accurate.
3. **Force `--check-artwork` behaviour on Subsonic by default**: small change, fixes the loop, costs an HTTP call per album. Worth measuring.

Whichever path is picked, the matrix must be updated to reflect the new behaviour.

## Related

TASK-142 covers the executor-side fallback for fetching artwork via `adapter.getArtwork()` when extractArtwork returns null. That's complementary — once 142 lands, sidecar/no-embed sources can actually be embedded into the device file, which would change `device.hasArtwork` and break a different set of asymmetries. Coordinate the two if both are picked up around the same time.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Subsonic sync without --check-artwork is idempotent across all art scenarios — second sync produces no artwork-added ops for tracks that haven't actually changed
- [x] #2 art-matrix.docker.test.ts predictor updated to reflect the fix
- [x] #3 Approach documented in a code comment at the adapter site (subsonic.ts:540-552)
- [x] #4 Unit test added at packages/podkit-core/src/adapters/subsonic.test.ts asserting the new (loop-free) behaviour on a no-art track
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-05-28: Stays an independent production bug fix (not blocked by the TASK-356 harness work). Two freshness notes after TASK-355.03 landed: (1) the affected-cell list above is now narrower — WAV/OGG/Opus carry embedded art in the fixtures and the album cache no longer poisons, so the remaining loop is primarily the scenario-A 'no real art but Navidrome reports a placeholder coverArt ID' case. (2) AC#2 'update art-matrix.docker.test.ts predictor' — if TASK-356.01 lands first, that predictor will live in a shared `.rules.ts` module, not inline in the docker test file; update it there. The core root cause (optimistic hasArtwork=true on a placeholder coverArt ID) is unchanged.

2026-05-30 (Claude): Direction 1 picked — adapter sets `hasArtwork = undefined` when `coverArt` is present but `checkArtwork` is off. The CollectionTrack contract already documents undefined as "treated as unknown — no upgrade triggered", and detectUpgrades' strict `=== true` short-circuits cleanly. No engine changes needed.

Changes:
- packages/podkit-core/src/adapters/subsonic.ts: removed optimistic-true branch in mapSongToTrack; updated the class JSDoc and the inline comment block at the decision site.
- packages/podkit-core/src/adapters/subsonic.test.ts: updated the fast-path test to assert `undefined`; added a new `loop-free artwork (TASK-355.02)` describe asserting (a) hasArtwork=undefined for a coverArt-present/checkArtwork-off track and (b) detectUpgrades returns no `artwork-added` reason for an undefined source vs device=false pair.
- packages/podkit-core/src/adapters/subsonic.integration.test.ts: updated the matching assertion from `true` to `undefined`.
- test-packages/e2e-tests/src/matrix/artwork-rules.ts: rewrote predictSubsonic. Without checkArtwork every cell is now idempotent; with checkArtwork the existing model is unchanged.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Subsonic adapter no longer fires `artwork-added` every sync for tracks whose source server (Navidrome) reports a `coverArt` ID for placeholder-only albums. Without `--check-artwork` the adapter now leaves `source.hasArtwork` undefined; detectUpgrades' strict `=== true` rule short-circuits, so syncs are idempotent. With `--check-artwork` behaviour is unchanged: the adapter fetches each cover, filters Navidrome's placeholder, and writes a syncTag hash that converges genuine source/device mismatches.

## Files

- packages/podkit-core/src/adapters/subsonic.ts — fix + docs
- packages/podkit-core/src/adapters/subsonic.test.ts — updated fast-path test + new TASK-355.02 loop-free describe
- packages/podkit-core/src/adapters/subsonic.integration.test.ts — updated matching assertion
- test-packages/e2e-tests/src/matrix/artwork-rules.ts — rewrote predictSubsonic

## Tests

- bun run typecheck --filter @podkit/core ✓
- bun run typecheck --filter @podkit/e2e-tests ✓
- bunx oxlint touched files ✓
- bun test packages/podkit-core/src/adapters/subsonic.test.ts → 41 pass / 0 fail
- bun run test:unit --filter @podkit/core → 2812 pass / 0 fail
- bun run test:integration --filter @podkit/core → 12 files pass
- bun test --path-ignore-patterns= packages/podkit-core/src/adapters/subsonic.integration.test.ts → 29 pass / 0 fail
- bun run test:e2e:docker → 4 pass / 0 fail (art-matrix.docker.test.ts 64s, predictor-vs-observation contract)

## Risks / follow-ups

- TASK-142 (executor adapter fallback) is complementary. Once it lands, sidecar/no-embed sources will start getting art on the *add* path — a behaviour gain, not a regression. predictSubsonic will need a follow-up tweak then (the `deviceHasArtwork = sourceEmbedsArt(...)` line assumes only file-body embed reaches the device; that assumption changes when the executor can fetch from the adapter).
- A track on device with no art whose source has real embed will no longer trigger artwork-added without `--check-artwork`. The user can opt into `--check-artwork` to get artwork-change detection. Deliberate trade per the task body's "drop optimistic-true" direction.
<!-- SECTION:FINAL_SUMMARY:END -->
