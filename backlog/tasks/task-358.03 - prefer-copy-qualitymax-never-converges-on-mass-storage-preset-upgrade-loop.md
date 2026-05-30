---
id: TASK-358.03
title: >-
  prefer-copy (quality=max) never converges on mass-storage (preset-upgrade
  loop)
status: Done
assignee: []
created_date: '2026-05-28 21:13'
updated_date: '2026-05-30 11:44'
labels:
  - bug
  - mass-storage
  - sync
dependencies: []
references:
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
  - packages/podkit-core/src/metadata/sync-tags.ts
  - packages/podkit-core/src/sync/music/classifier.ts
  - test-packages/e2e-tests/src/features/preset-change.test.ts
parent_task_id: TASK-358
priority: medium
ordinal: 76000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
With `quality = "max"` + lossless stack `["source"]` (the "prefer-copy" pipeline) on a mass-storage device, the second sync re-fires `upgrade-transcode` with reason `preset-upgrade` for several tracks — the sync never converges. The sync tag written on the first pass does not match what the planner expects on the second pass, so it re-plans preset upgrades indefinitely.

This is a quality/preset-convergence defect, **not** an artwork one, so the artwork matrix does not catch it (it asserts artwork idempotency, which is unaffected). It is currently **uncaught by any test**: `preset-change.test.ts` exercises preset-change convergence on iPod only. A mass-storage arm of that test (or a dedicated preset-convergence matrix) would catch it and guard the fix.

Repro: sync the multi-format (or goldberg) fixture to a `type = "generic"` temp device with `quality = "max"` and `[codec] lossless = ["source"]`; dry-run again and observe `upgrade-transcode:preset-upgrade` ops.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A mass-storage sync at quality=max converges: the second sync plans no preset-upgrade
- [x] #2 Root cause identified in sync-tag write/read or preset resolution on mass-storage and fixed
- [x] #3 A regression test covers mass-storage preset-change convergence (extend preset-change.test.ts to mass-storage, or add a preset matrix)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause was in `postProcessPresetChanges` (`packages/podkit-core/src/sync/music/handler.ts`): `expectedSyncTag` was built once from `this.config.resolvedQuality` (the user's *intent*, e.g. `'lossless'` under `quality = "max"` + `lossless = ["source"]`). On mass-storage, the classifier falls back per-track to `lossy: 'high'` when the lossless stack can't satisfy a given source — e.g. WAV/AIFF/ALAC on `generic` (caps: aac/mp3/flac). The track's persisted syncTag therefore correctly read `quality=high`, but the detector compared it to a config-wide `quality=lossless` expectation and flagged a phantom `preset-upgrade` forever.

**Fix.** Build `expectedSyncTag` per-track from the classifier's actual decision, not from the config-wide resolvedQuality. When the classifier returns a `transcode` action, use `action.preset.name` / `targetCodec` / `bitrateOverride`; when it returns a copy action and the device track also has `syncTag.quality === 'copy'`, the in-sync short-circuit already handled it.

**Repro before fix.** `quality=max` + `lossless=["source"]` + `generic` device + multi-format-embedded fixture → second dry-run reports `tracksToUpgrade: 3 / preset-upgrade: 3` for WAV/AIFF/ALAC.
**After fix.** Same setup → second dry-run reports `tracksToUpgrade: 0 / tracksExisting: 8`.

**Regression test.** Added a mass-storage arm to `test-packages/e2e-tests/src/features/preset-change.test.ts` that sets up exactly the loop conditions and asserts `breakdown['preset-upgrade'] === 0` on the second dry-run. Verified the test fails on `main` without the fix (manual revert + re-run).

**Verification:** unit 2812/2812; preset-change e2e 6/6 (5 existing + 1 new mass-storage); full host e2e 31/31; art-matrix.docker 1/1; typecheck + oxlint clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Preset-change detector was comparing each track's persisted syncTag against the **config-wide** `resolvedQuality` instead of the **per-track** classifier decision. On mass-storage, the lossless stack falls back to `high` per-track when no lossless target matches the device's codecs (WAV/AIFF/ALAC on `generic`), so syncTag `quality=high` was misread as a mismatch against config `quality=lossless` — re-firing `preset-upgrade` forever.

Fix: build `expectedSyncTag` per-track from `classifier.classify(source).action`. For transcode actions, the action's preset name + targetCodec + bitrateOverride match exactly what was written; for copy actions, the existing `quality=copy` short-circuit handles it.

New regression test in `preset-change.test.ts` (mass-storage arm with `quality=max` + `lossless=["source"]` + generic preset) catches the bug in the absence of the fix.
<!-- SECTION:FINAL_SUMMARY:END -->
