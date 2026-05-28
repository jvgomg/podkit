---
id: TASK-355.04
title: >-
  MP3 fires spurious `codec-changed` op after a source-file cover-swap without
  --check-artwork
status: Done
assignee: []
created_date: '2026-05-26 22:49'
updated_date: '2026-05-27 00:56'
labels:
  - bug
  - artwork
  - codec-detection
  - mp3
dependencies: []
references:
  - 'packages/podkit-core/src/sync/music/handler.ts:481'
  - 'packages/podkit-core/src/sync/music/pipeline.ts:2042'
  - test-packages/e2e-tests/src/features/art-matrix-change.test.ts
modified_files:
  - packages/podkit-core/src/sync/music/handler.ts
  - packages/podkit-core/src/sync/music/handler.test.ts
  - test-packages/e2e-tests/src/features/art-matrix-change.test.ts
parent_task_id: TASK-355
priority: low
ordinal: 64000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Symptom

The artwork-change matrix (`art-matrix-change.test.ts`) syncs the embedded-art fixture, swaps its files for the `-alt` variant (identical metadata, different cover bytes), and dry-runs a second sync. Without `--check-artwork`, the artwork swap is silently missed for every embed-capable format (FLAC, ALAC, AAC) — as expected, because the adapter doesn't compute `source.artworkHash`.

But MP3 produces a *different* operation on every second sync:

```json
{ "type": "upgrade-direct-copy", "reason": "codec-changed" }
```

No other embed-capable format does this. The codec hasn't actually changed (both files are LAME-encoded MP3). The matrix encodes this as current behaviour so the test doesn't break on the quirk, but it's flagged as a bug worth fixing.

## Where it comes from

`packages/podkit-core/src/sync/music/handler.ts:481-538` (`postProcessCodecChanges`) compares `syncTag.codec` against the target codec the classifier would pick now. The interesting branches:

```ts
} else if (syncTag.quality === 'copy') {
  // Copied tracks don't need codec change detection (they weren't transcoded)
  return null;
} else if (syncTag.quality === 'lossless') {
  existingCodec = 'alac';
} else {
  // Legacy lossy tag without codec → infer AAC
  existingCodec = 'aac';
}
```

For MP3 (direct-copy, compatible-lossy), the sync tag from the initial sync should have `quality: 'copy'` — and the early-return should skip the codec-changed comparison entirely. But the op is firing, which means either:

1. The MP3 track's sync tag was written without `quality: 'copy'` (maybe written by a different code path, or not written at all and the conditional falls through).
2. The sync tag has `quality` set but to something else (e.g. inferred 'lossy').
3. `inferredExistingCodec === 'aac'` and `targetCodec === 'mp3'` (because the classifier resolves to MP3 for an MP3 source), triggering codec-changed.

Most likely #3 combined with #1: when the lossy-copy path doesn't stamp `quality: 'copy'` into the sync tag, the codec-changed pass infers 'aac' for the existing codec, the classifier targets 'mp3' for the source, and the mismatch fires.

## Where to investigate

- Confirm whether `transferAddToIpod` writes a sync tag with `quality: 'copy'` for MP3 source tracks. Look at `packages/podkit-core/src/sync/music/pipeline.ts:2042-2044`:

  ```ts
  } else if (operation.type === 'add-direct-copy' || operation.type === 'add-optimized-copy') {
    this.device.writeSyncTag(track, { quality: 'copy', artworkHash: artHash });
  }
  ```

  Note: this branch is inside `if (artHash && this.syncTagConfig)`. Without `--check-artwork`, `artHash` is undefined → the sync tag is never written → the codec-changed pass falls through to the inference.

- Read `postProcessCodecChanges` carefully and trace what `existingCodec` and `targetCodec` resolve to for MP3 source when `device.syncTag` is undefined. If `syncTag` is undefined, the early `if (!syncTag) return null` at line 489 should catch it… unless the executor writes *some* sync tag (e.g. just bitrate/encoding) without the `quality` field.

## Definition of fix

- Second sync of an unchanged MP3 (or, in the change-detection case, a cover-swapped MP3) without `--check-artwork` produces zero ops.
- art-matrix-change.test.ts predictor: remove the MP3-specific `codec-changed` branch.
- Unit test added that asserts the codec-changed pass does not fire for an MP3 source that's currently direct-copied to MP3.

## Note

Low priority because the user-visible impact is small — the op is `upgrade-direct-copy` which re-copies the file but doesn't transcode. It just makes incremental syncs slower than necessary for MP3 collections.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 MP3 source tracks that haven't changed produce no ops on subsequent syncs without --check-artwork
- [x] #2 art-matrix-change.test.ts predictor's MP3-specific branch removed
- [x] #3 Root cause documented in a code comment at the fix site
- [x] #4 Unit test added covering the codec-changed-on-unchanged-MP3 scenario
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Root cause

`postProcessCodecChanges` in `packages/podkit-core/src/sync/music/handler.ts:520-523` assumed any lossy source would be transcoded with `this.config.resolvedLossyCodec`:

```ts
} else if (!sourceLossless || this.config.resolvedQuality !== 'lossless') {
  // Lossy transcoding path
  targetCodec = resolvedLossyCodec;
}
```

But compatible-lossy sources (MP3 on an MP3-capable device) are direct-copied by the classifier, not transcoded. The pre-fix logic computed `existingCodec = 'mp3'` (from the sync tag) and `targetCodec = 'aac'` (the resolved fallback), then fired `codec-changed` on every subsequent sync because the comparison never matched.

The task hypothesis suspected an unwritten sync tag — that was wrong. `pipeline.ts:2078-2085` writes the copy tag at `addTrack` time regardless of `--check-artwork` (and `--check-artwork` was a red herring; the same spurious op fires with the flag on too). The actual bug was the assumption baked into the lossy branch.

The lossless branch at line 511-519 already does the right thing — it asks `this.classifier.classify(match.source)` and returns null when the action is not transcode. The lossy branch just didn't have the same check.

## Fix

`packages/podkit-core/src/sync/music/handler.ts:509-528`: collapse both branches around a single `classifier.classify(match.source)` call. If the action is not `transcode`, return null (copy-routed source — no codec change applicable). If it is transcode, take `targetCodec` from `classification.action.preset.targetCodec`, falling back to `resolvedLossyCodec` in the lossy case and `'alac'` in the lossless case (preserving the previous defaults).

Comment block at the fix site explains the why.

## Tests added

`packages/podkit-core/src/sync/music/handler.test.ts` — new `describe('postProcessCodecChanges')` block with two cases:
- **Regression test**: MP3 source + device supports `['mp3', 'aac']` + `resolvedLossyCodec: 'aac'` → classifier returns direct-copy → no `codec-changed` op (would have fired pre-fix).
- **Companion test**: MP3 source + device supports `['aac']` only → classifier returns transcode-to-AAC → `codec-changed` fires with from='mp3', to='aac' (pins the legitimate case so we don't over-suppress).

## Matrix predictor update

`test-packages/e2e-tests/src/features/art-matrix-change.test.ts`: removed the MP3 special-case branch that asserted `upgrade-direct-copy:codec-changed`. MP3 now falls through to the same "cover-swap silently missed" prediction as FLAC/ALAC/AAC/AIFF without `--check-artwork`.

## Verification

- `bun run test:unit --filter @podkit/core -- handler.test`: 164 pass (including the 2 new ones).
- `bun run test:e2e --filter @podkit/e2e-tests -- art-matrix`: host matrices both green.
- `bun run test:docker --filter @podkit/e2e-tests -- art-matrix.docker`: green (64/64 cells) — confirms docker behaviour also unchanged.
- `bun run typecheck` for `@podkit/core`, `@podkit/e2e-tests`: clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Real bug different from the task hypothesis. `postProcessCodecChanges` lossy branch in `handler.ts:520-523` assumed any lossy source would be transcoded with `resolvedLossyCodec`, but compatible-lossy sources (MP3 on an MP3-capable device) are direct-copied by the classifier. The sync tag write was a red herring — `pipeline.ts:2078-2085` already writes the copy tag at addTrack time regardless of `--check-artwork`.

Fix: collapse both branches in `postProcessCodecChanges` around a single `classifier.classify(match.source)` call. If the action isn't `transcode`, return null (copy-routed source — no codec change applicable). Symmetric with the lossless branch's existing check at line 511-519. Doc comment explains the why.

Tests added (handler.test.ts → new `postProcessCodecChanges` describe):
- Regression: MP3 source + device supports `['mp3','aac']` → no codec-changed op (would have fired pre-fix).
- Companion: MP3 source + device supports `['aac']` only → codec-changed fires with from='mp3', to='aac' (pins legitimate case).

Predictor: removed MP3 special-case from art-matrix-change.test.ts; MP3 now follows the same "silently missed without --check-artwork" rule as FLAC/ALAC/AAC/AIFF.

Verified: handler unit tests (164 pass), host matrices both green, docker matrix green (64/64), typecheck clean.
<!-- SECTION:FINAL_SUMMARY:END -->
