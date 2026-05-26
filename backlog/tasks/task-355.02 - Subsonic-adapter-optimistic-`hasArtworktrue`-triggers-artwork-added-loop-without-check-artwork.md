---
id: TASK-355.02
title: >-
  Subsonic adapter optimistic `hasArtwork=true` triggers artwork-added loop
  without --check-artwork
status: To Do
assignee: []
created_date: '2026-05-26 22:49'
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
- [ ] #1 Subsonic sync without --check-artwork is idempotent across all art scenarios — second sync produces no artwork-added ops for tracks that haven't actually changed
- [ ] #2 art-matrix.docker.test.ts predictor updated to reflect the fix
- [ ] #3 Approach documented in a code comment at the adapter site (subsonic.ts:540-552)
- [ ] #4 Unit test added at packages/podkit-core/src/adapters/subsonic.test.ts asserting the new (loop-free) behaviour on a no-art track
<!-- AC:END -->
