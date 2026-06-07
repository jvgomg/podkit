---
id: TASK-395
title: >-
  iPod portable rescan re-fires upgrade-direct-copy with codec-changed on
  identical mp3 (TASK-380 finding)
status: Done
assignee: []
created_date: '2026-06-06 18:03'
updated_date: '2026-06-07 10:23'
labels:
  - bug
  - ipod
  - portable-mode
  - planner
  - rescan-convergence
dependencies: []
references:
  - test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts
  - packages/podkit-core/src/sync/engine/planner.ts
  - >-
    backlog/tasks/task-380 -
    Save-failure-matrix-test-suite-—-doc-041-§4.3-§7.3.md
modified_files:
  - packages/podkit-core/src/sync/music/handler.test.ts
  - test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts
priority: medium
ordinal: 109100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

Surfaced by TASK-380 Phase C.3 iPod cells (2026-06-06). For `ipod-{noart,artwork} × mp3 × prefer-copy × portable × track-readonly` cells, the second sync's dry-run re-fires `upgrade-direct-copy` with `reason: codec-changed` despite **identical mp3 codec on both sides** of the round-trip.

The matrix's other observations (typed `TagWriteError` warn-only via WarningSink, partialDeviceState, doctorSeesPodkitTmp) all match prediction. Only `rescanRefires: false (predicted) vs true (observed)` is wrong — the planner thinks the codec changed when it didn't.

## Repro

```bash
# inside the Lima podkit-device-harness VM
gpod-tool init <mount> --model 9160                    # iPod mini 1G
podkit sync -d <mount> --transfer-mode portable        # first sync: copies mp3
podkit sync -d <mount> --transfer-mode portable --dry-run --json
# → planner's operations[] contains:
#   { type: 'upgrade-direct-copy', reason: 'codec-changed', track: 'Artist - Title' }
# even though the source mp3 and the device's mp3 are byte-identical
```

## Investigation needed

1. **Where does the codec comparison live?** Search `packages/podkit-core/src/sync/engine/planner.ts` or `diff-utils.ts` for `codec-changed` reason emission.
2. **Compare source codec field vs device track codec field.** Is the source reporting `mp3` and the device reporting `MPEG audio` (or vice versa)? Tag-vs-actual mismatch?
3. **Is this iPod-specific or also reproducible on mass-storage portable?** Worker reports it's surfaced in iPod portable cells; mass-storage cells didn't fan this way.
4. **Is `codec-changed` ever justified on a same-codec round-trip?** Probably not — the reason should fire only when input + output codecs genuinely differ.

## Fix

Depends. Probably: the planner's codec-identity comparison normalises one side but not the other (e.g. ffprobe's `codec_name: mp3` vs libgpod's track-info field). Normalise both to the same canonical codec id before comparison.

## Why filed now

Real divergence surfaced by the matrix. Two iPod portable cells consistently RED on `rescanRefires`. Not a stale-binary artefact (the asymmetry is reproducible).

## Acceptance

- Root cause: which field differs (source vs device) and why
- Fix: planner emits `codec-changed` only when source codec genuinely differs from device codec
- Test pins iPod mp3 round-trip in portable mode (no `upgrade-direct-copy` on second dry-run)
- TASK-380 matrix cells flip GREEN on `rescanRefires`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Root cause documented: which side of the codec comparison reports a different label (ffprobe-side vs libgpod-side vs sync-tag-side)
- [x] #2 Planner codec-identity comparison normalises both sides to a canonical id before comparing
- [x] #3 Unit test pins the comparison: same mp3 codec, different label representations, must NOT emit codec-changed
- [x] #4 VM e2e test: iPod mp3 portable round-trip converges on second dry-run (no upgrade-direct-copy with codec-changed reason)
- [x] #5 TASK-380 matrix `ipod-{noart,artwork} × mp3 × prefer-copy × portable × track-readonly` cells flip GREEN on `rescanRefires`
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Result: pre-existing fix (TASK-355.04), regression test added

### Root cause (AC #1)
The planner's only emission of `codec-changed` is in `MusicHandler.postProcessCodecChanges` at `packages/podkit-core/src/sync/music/handler.ts:524-585`. On the matrix's `quality=max` + `lossy=['aac']` + `lossless=['source']` mp3 round-trip, the handler:

1. Reads `match.device.syncTag.codec === 'mp3'` (canonical, written by `fileTypeToAudioCodec('mp3', …)` in `transfer.ts:116`, persisted in the iTunesDB comment, round-tripped via `parseSyncTag`).
2. Classifies `match.source` through `MusicTrackClassifier`. For an MP3 source on a device with `mp3` in `supportedAudioCodecs`, classification short-circuits to `action.type === 'direct-copy'`.
3. The classifier short-circuit at `handler.ts:562-566` returns `null` BEFORE comparing codecs — no `codec-changed` reason fires.

The short-circuit landed in commit `621b10ab` (TASK-355.04 — "fix(artwork): deterministic album art + drop spurious MP3 codec-changed") on 2026-05-28. **The bug TASK-395 describes was already fixed before TASK-395 was filed.** The matrix's filing-time observation was a stale-binary artefact (the matrix landed in `b36811da` on 2026-06-07 11:56 BST; the binary refresh that picked up TASK-355.04 happened against a later commit).

There is no codec-label asymmetry to normalise — both sides (ffprobe-derived `source.codec` and syncTag `device.syncTag.codec`) already collapse to the canonical `AudioCodec` id `'mp3'` via `fileTypeToAudioCodec()` in `packages/podkit-core/src/sync/music/planner.ts:108-140`. The fix is *behavioural* (classifier short-circuit), not *structural* (normalisation table).

### Fix (AC #2)
Already in place at `handler.ts:562-566`. The classifier is the single source of truth for "would this source be transcoded or copied?", and a copy never triggers `codec-changed`. No code change needed.

### Pin (AC #3)
Added regression test in `packages/podkit-core/src/sync/music/handler.test.ts` — `postProcessCodecChanges` describe block:
> `'does not fire codec-changed for MP3 portable round-trip under quality=max + lossless=[source]'`

Existing test covered `quality='high'` only; new test covers the matrix's `quality='max'` + `lossless=['source']` config (which makes `resolvedLosslessStack` truthy and thus arms the `postProcessCodecChanges` gate). Verifies the classifier short-circuit holds for this previously-uncovered config slice.

### VM e2e (AC #4 + #5)
Verified by running the matrix with the `skipBug` fence removed and inspecting the diff body for both target cells (`ipod-noart` + `ipod-artwork × mp3 × prefer-copy × portable × track-readonly`). Observed:
- `dryOps: []` — the second-sync dry-run rescan emits **zero operations**, including no `upgrade-direct-copy` with `codec-changed` (rescanRefiresAddOrUpgrade observed=false, predicted=false → GREEN).

### Surprise — out-of-scope adjacent divergence
The two matrix cells still RED-fail with the fence removed, but on a **different** axis:
- `portableTagWarn: expected=true, observed=false`
- `doctorSeesPodkitTmp: expected=false, observed=null`

`portableTagWarn=false` is caused by commit `d03f5cfc` (TASK-376 — "atomic on-file writes for tag + picture mutations") on 2026-06-07 11:09 BST: `TagLibTagWriter.writeTags` now routes through `atomicWriteFileWithSync` (read-buffer → write-temp → renameat). The matrix's `chmod 0444` on the target audio file no longer trips an EACCES — the parent dir's write bit still lets `renameat()` succeed. The predicted `portableTagWarn: true` is now stale for the same reason: no failure path means no soft-warn fires.

This is an adjacent prediction-staleness gap in the matrix rules (`test-packages/e2e-vm-tests/src/matrix/save-failure-rules.ts:407-426`), not a planner bug. The fix is one of: (a) update the matrix prediction to `portableTagWarn: false` + drop the `TagWriteError` claim across all `track-readonly` cells; (b) change the fault to chmod the parent dir instead of the file (which the atomic rename actually depends on). Out of TASK-395 scope.

The `skipBug` fence stays in place with its reason updated to point at the new (TASK-376-introduced) divergence, so the next reader knows the codec-changed claim has been retired.

### Modified files
- `packages/podkit-core/src/sync/music/handler.test.ts` — regression test added
- `test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts` — skipBug reason updated to surface the actual (post-TASK-376) divergence

### Verification
- `bun run typecheck` (podkit-core + e2e-vm-tests) — green
- `bun run test:unit --filter @podkit/core` — 2909 pass / 0 fail / 5 skip
- Matrix dry-run on the two target cells confirms `dryOps: []`
<!-- SECTION:FINAL_SUMMARY:END -->
