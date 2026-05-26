---
id: TASK-355.04
title: >-
  MP3 fires spurious `codec-changed` op after a source-file cover-swap without
  --check-artwork
status: To Do
assignee: []
created_date: '2026-05-26 22:49'
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
- [ ] #1 MP3 source tracks that haven't changed produce no ops on subsequent syncs without --check-artwork
- [ ] #2 art-matrix-change.test.ts predictor's MP3-specific branch removed
- [ ] #3 Root cause documented in a code comment at the fix site
- [ ] #4 Unit test added covering the codec-changed-on-unchanged-MP3 scenario
<!-- AC:END -->
