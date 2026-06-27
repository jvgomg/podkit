---
id: TASK-437.06
title: 'S5: Precondition re-encodes — CBR/VBR flip + lossy/lossless boundary'
status: In Progress
assignee: []
created_date: '2026-06-25 22:38'
updated_date: '2026-06-27 21:25'
labels:
  - sync
  - transcoding
  - quality
dependencies:
  - TASK-437.01
references:
  - >-
    backlog/docs/doc-051 -
    Bidirectional-quality-change-extend-cap-enforcement-to-lossy-unify-the-quality-classifier.md
parent_task_id: TASK-437
priority: medium
ordinal: 198000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**AFK.** See PRD doc-051.

Treat encoding-mode flips (CBR↔VBR) and the lossy↔lossless boundary as **precondition classes** — they re-encode for correctness regardless of bitrate policy, so they fire even when `bitrate.sync = off`, and bypass the policy gate. CBR/VBR is read from the sync-tag `encoding` (libgpod exposes no VBR signal); the lossy/lossless axis is observable from codec (DB filetype + source probe). Direction still tags the result (lossy→lossless = up; lossless→lossy = down) for display. `skipUpgrades` (additive-only) still vetoes even these.

**Context:** user stories 4 (encoding-mode flip re-encodes), 5 (lossy/lossless boundary re-encodes both directions).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Switching device encoding mode (CBR<->VBR) re-encodes existing tracks to the new mode; fires even at bitrate.sync=off
- [x] #2 Lossy->lossless target change re-encodes up; lossless->lossy transcodes down to cap; both fire even at bitrate.sync=off
- [x] #3 Precondition classes bypass the policy gate but are vetoed by skipUpgrades (additive-only)
- [x] #4 Classifier unit tests cover encoding-mismatch + lossless-boundary (both directions) and the off-bypass + skipUpgrades-veto
- [x] #5 E2E in upgrades.test.ts: encoding flip and lossless-boundary each re-encode under off; skipUpgrades blocks them
- [x] #6 Changeset added
- [x] #7 User docs updated (encoding mode + lossy/lossless are correctness, not bitrate policy)
- [x] #8 Architecture doc upgrades.md updated for precondition classes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Already in place before this change (preceding slice)

- The policy gate (`applyBitrateSyncPolicy`) already returned `'fire'` for all three precondition reasons (`encoding-mismatch`, `lossless-boundary`, `format-mismatch`), bypassing bitrate policy.
- The **lossless** sync-tag-exact path already emitted `encoding-mismatch` on a CBR/VBR flip, with an `off`-bypass unit test.
- `lossless-boundary` **up** (lossy→lossless, source bound) and the ALAC device-bound crossing-into-lossless already fired under `off`.
- `skipUpgrades` already vetoed all file-replacement reasons (in `detectUpdates` filter + `postProcessPresetChanges` early return).
- Architecture doc already had the policy-gate + ladder; config-file.md already stated format/encoding corrections fire in every mode incl. `off` and that `skipUpgrades` outranks `sync`.

## Added by this change (the gaps)

1. **Lossy CBR↔VBR flip** — `classifyLossyDeviceBound` now emits `encoding-mismatch` when the device's recorded sync-tag `encoding` differs from the target (only for tracks podkit transcoded — a copy tag clears `encoding`, so faithful copies are not re-encoded). Re-encode targets `min(source, cap)` for idempotency; a coincident cap move shares the single re-encode.
2. **lossless→lossy boundary (down)** — `computeDeviceBound` now detects a still-lossless device copy + lossy target and returns `lossless-boundary` direction `down` (a precondition) instead of a policy-gated `cap-down`. Losslessness read tag-first via new `isDeviceCopyLossless` (quality=lossless→lossless, lossy transcode tag→lossy, copy/untagged→filetype) so a lossy transcode on a lossless-looking container isn't misread.
3. **`format-only` direction** — pure encoding flips (no tier/bitrate move) now tag `format-only`. Refactored `syncTagDirection`→`qualityMoveDirection` (returns null when nothing moved). Drive-by fix from review: the cap-branch direction fallback now resolves from effective bitrates (absent tag bitrate = preset nominal) so a newly-added lower custom bitrate at the same tier is labelled `cap-down`, not mislabelled `cap-up` (which would wrongly suppress it under `off`/`up-only`).
4. **Handler routing** — `resolveUpgradeAction` adds `encoding-mismatch` to its lossy re-encode set so a device-native lossy source is transcoded (not copied) at `min(source, cap)` with the new encoding → idempotent.

## Tests added
- Classifier units: lossy encoding flip (format-only, + coincident cap-up/cap-down keeping direction, + fires under every mode), copy-with-no-encoding opt-out, lossless-boundary down (tagged / untagged / copy-ALAC / tag-authoritative-not-misread / in-sync), custom-bitrate cap-down direction regression.
- E2E (dummy iPod, upgrades.test.ts): a lossy encoding-mode flip and a lossless→lossy boundary each re-encode under `--bitrate-sync off`, `--skip-upgrades` blocks both, and a re-sync is a no-op (idempotent).

## Gates (all green)
lint clean; full `turbo run typecheck` 36/36; `@podkit/core` unit 3364 pass; `podkit` unit 1915 pass; e2e dummy upgrades+preset-change+mass-storage-sync+artwork-sync-tags 49 pass.

## Notes / scope
- `format-mismatch` (codec) remains reserved — codec changes are handled by the separate `postProcessCodecChanges` pass.
- Lossy encoding-mismatch only fires for tracks with a recorded bitrate (the `encoded` guard). A lossy transcode written without a bitrate override (e.g. OGG→AAC at a bare preset, no custom/cap) records `encoding` but no `bitrate`, so it's opted out — documented in upgrades.md §7 alongside the untagged opt-out.

Team-lead review pass (Sonnet) + fixes: caught a correctness bug — the new lossy encoding-mismatch path fired BEFORE the source-down guard, so a CBR<->VBR flip on a track whose source had since degraded below the cap would re-encode the better device copy down to the worse source (e.g. 128 kbps VBR -> 100 kbps CBR). Fixed in classifyLossyDeviceBound: when the flip's direction is 'down' and sourceBitrate < cap, classify as source-down-suppressed instead so the policy gate decides — match-cap keeps the better copy, match-all follows the source down (and that re-encode still adopts the new encoding mode). Up/format-only flips still fire (no degradation). Added a regression unit test (kept under match-cap, followed under match-all) and refreshed two stale JSDoc blocks that still said encoding-mismatch was lossless-path-only. Reviewer verified idempotency of both new paths (encoding flip writes new mode+bitrate; lossless->lossy writes lossy tag), the off-bypass, skipUpgrades veto, lossless cap-down still policy-gated, and the cap-direction fallback fix — all correct. Left NIT (format-only bucketed under quality-change-up in presenter) as-is: pre-existing, no regression, JSON direction field is honest. Documented eligibility limit unchanged (lossy encoding flip needs a recorded sync-tag bitrate; a bare-preset transcode below cap records no bitrate and is opted out — closing it = universal lossy bitrate recording, out of scope here). Gates green: lint 0/0, full typecheck 36/36, @podkit/core unit 3370 pass, podkit cli unit pass, e2e dummy 49 pass.
<!-- SECTION:NOTES:END -->
