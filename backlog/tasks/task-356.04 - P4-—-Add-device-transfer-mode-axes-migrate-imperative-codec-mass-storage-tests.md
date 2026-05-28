---
id: TASK-356.04
title: >-
  P4 — Add device + transfer-mode axes; migrate imperative codec/mass-storage
  tests
status: To Do
assignee: []
created_date: '2026-05-28 08:00'
updated_date: '2026-05-28 11:46'
labels:
  - testing
  - e2e
  - matrix
  - device
  - transfer-mode
dependencies:
  - TASK-356.01
  - TASK-356.03
references:
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
  - test-packages/e2e-tests/src/features/codec-preference.test.ts
  - test-packages/e2e-tests/src/features/mass-storage-sync.test.ts
  - test-packages/e2e-tests/src/features/preset-change.test.ts
parent_task_id: TASK-356
priority: medium
ordinal: 70000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-039 phase 5. With the harness (P1) and SyncTarget (P3) in place, promote device and transfer mode to real matrix axes and fold the existing imperative feature tests into concern matrices.

## Scope

- Add `device` axis: run the relevant concern matrices across `[ipod-MA147, mass-storage-echo-mini, mass-storage-generic]`; `predict()` keys off `target.capabilities`, not a hardcoded model.
- Add `transferMode` axis: `fast | optimized | portable`.
- Extend the `skip(cell)` predicate to prune redundant/impossible combos (e.g. transfer mode is a no-op on non-embedded-art devices; subsonic needs docker).
- Migrate `codec-preference.test.ts` and `mass-storage-sync.test.ts` (and codec/quality assertions from `preset-change.test.ts`) into concern matrices on the harness. Delete the bespoke per-file device-config plumbing now that P3's target generates it.

Depends on P1 (harness) and P3 (SyncTarget).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 device is a matrix axis spanning iPod + mass-storage presets; predict() keys off target.capabilities
- [ ] #2 transferMode (fast/optimized/portable) is a matrix axis
- [ ] #3 skip() prunes redundant/impossible/env-gated device×mode combos
- [ ] #4 codec-preference + mass-storage-sync imperative tests migrated into concern matrices (old files removed or reduced to non-matrix smoke)
- [ ] #5 Full suite green
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Design forks for whoever picks this up (2026-05-28, after P1/P2/P3)

1. **Add `skip(cell)` to the harness first.** `MatrixDef` in `matrix/harness.ts` has NO skip predicate yet (P1 didn't need it). Add `skip?: (cell) => string | null` and have `defineArtworkMatrix` emit `it.skip` (or skip the assert) for skipped cells. Needed before the device×transfer product explodes (~3,500 cells full).

2. **Device axis wiring.** Make the artwork matrix run across `[ipod-MA147, mass-storage echo-mini, mass-storage generic]`. `predictDirectory` currently closes over a hardcoded `HOST_IPOD_CAPS` (`ipodCapabilitiesForModel('MA147')`) in `artwork-rules.ts` — replace with `target.capabilities` carried on the cell (add `capabilities` to the cell, or pass the target into predict). The sync config must include `target.deviceConfig()` for mass-storage (the `[devices.*] type=… path=…` block); `observeStaticArtwork` already takes a `configPath`, so extend the config builder to merge the device fragment and address `--device <deviceConfig.name>` for mass-storage (vs `--device <path>` for iPod).

3. **`deviceAction()` mass-storage exception.** `MASS_STORAGE_UNSUPPORTED_OUTPUT_CODECS = ['wav','aiff']` (in `@podkit/devices-mass-storage`): podkit transcodes WAV/AIFF on mass-storage even when the firmware lists them, because tag-writing is unreliable. iPod is exempt. Add a branch to `deviceAction` keyed on target kind (or pass a flag) so mass-storage WAV/AIFF → transcode.

4. **artwork storage model.** Mass-storage presets use `artworkSources: ['embedded']` (echo-mini/generic) or `['sidecar','embedded']` (rockbox); iPod uses `['database']`. `artworkReaches()` already gates on `artworkSources.length > 0`, fine for default transfer mode. Embedded-art devices + `optimized` transfer mode STRIP art — but transfer mode is P5, not here.

5. **Migrate imperative tests last.** Fold `codec-preference.test.ts` + `mass-storage-sync.test.ts` into concern matrices and delete their bespoke `writeEchoMiniConfig`/`writeCodecConfig` TOML now that `MassStorageTarget.deviceConfig()` generates it. This is the bulk of the churn; do it after the axis wiring is green so you have a working reference.

6. **Gotchas:** each (device × pipeline) combo must sync onto a FRESH target (idempotency); docker cells can't share a file with host (runner gates on `*.docker.test.ts`); mass-storage `getTracks()` reads tags+art via ffprobe (already implemented in `targets/mass-storage.ts`).
<!-- SECTION:NOTES:END -->
