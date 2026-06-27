---
id: TASK-437.05
title: 'S4: bitrate.sync policy + config schema + CLI override'
status: In Progress
assignee: []
created_date: '2026-06-25 22:38'
updated_date: '2026-06-27 23:10'
labels:
  - sync
  - transcoding
  - quality
  - config
  - cli
dependencies:
  - TASK-437.02
  - TASK-437.03
  - TASK-437.04
references:
  - >-
    backlog/docs/doc-051 -
    Bidirectional-quality-change-extend-cap-enforcement-to-lossy-unify-the-quality-classifier.md
  - packages/podkit-cli/src/config/types.ts
  - packages/podkit-cli/src/commands/sync.ts
parent_task_id: TASK-437
priority: medium
ordinal: 197000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**AFK. Convergence point** — gates the up/down/source-down triggers from S1/S2/S3. See PRD doc-051.

Add the per-device `bitrate.sync` policy with five modes (`off | match-cap | match-all | up-only | down-only`, default `match-cap`) and a pure **policy gate** mapping `(direction, reason, mode) -> fire | suppress-log`, kept as a distinct testable concern from the classifier. Add the config schema + validation, the `--bitrate-sync=<mode>` one-run override (reuse the existing config-override pattern; guard unset-vs-explicit via option-source so Commander defaults aren't synthesised), and the opt-in source-bound `tolerance` config (default 0; the only place tolerance survives, on the ffprobe source comparison). Precondition classes bypass the gate (handled in S5); `skipUpgrades` remains the top veto above `bitrate.sync`.

**Context:** user stories 8 (match-all opt-in), 9 (up-only/down-only), 10 (off blocks bitrate), 11 (tolerance), 15 (--bitrate-sync override).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Config accepts [devices.<name>.bitrate].sync with the five values; default match-cap when unset; invalid values fail validation with a clear error
- [x] #2 Pure policy gate maps (direction, reason, mode) -> fire/suppress; unit-tested independently of the classifier
- [x] #3 Each mode behaves per the PRD table: match-cap (both, source-down suppressed), match-all (+source-down), up-only, down-only, off (no bitrate moves)
- [x] #4 --bitrate-sync=<mode> overrides device config for one run; only applies when explicitly passed (option-source guarded)
- [x] #5 Opt-in source-bound tolerance config (default 0) damps source-bound lossy comparison; legacy bitrateTolerance reinterpreted (DB-fallback role gone)
- [x] #6 Policy ladder honoured: skipUpgrades > bitrate.sync=off > bitrate moves
- [x] #7 Config schema validation tests + per-mode e2e (up-only suppresses down, down-only suppresses up, off blocks bitrate, match-all re-encodes source-down)
- [x] #8 Changeset added
- [x] #9 User docs updated (config reference for bitrate.sync + tolerance, CLI reference for --bitrate-sync)
- [x] #10 Architecture doc upgrades.md updated for the policy gate + ladder
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented the per-device bitrate.sync policy end to end.

Core (packages/podkit-core/src/sync/engine/upgrades.ts):
- Added `BitrateSyncMode` (+ `BITRATE_SYNC_MODES` const, single source of truth) and a pure gate `applyBitrateSyncPolicy(direction, reason, mode) -> 'fire'|'suppress-log'`. Preconditions (encoding-mismatch/lossless-boundary/format-mismatch) always fire; source-down fires only under match-all; up/down moves gated per mode. Exhaustive matrix test in new bitrate-sync-policy.test.ts (every reason x every mode).
- Threaded `policy` (default 'match-cap') into classifyQualityChange / classifyDeviceBound / classifySourceBound. Each bound computes its natural change, then `gateChange` derives `reEncodes` from the gate (suppressed changes are still returned so they can be reported). A change crossing INTO lossless (toLossless) always fires regardless of mode (handles the ALAC device-bound upgrade under off/down-only).
- Produced `encoding-mismatch` on the lossless sync-tag-exact path so a CBR<->VBR flip re-encodes for correctness even under off.
- Added source-bound tolerances (QualityTarget.toleranceUp/toleranceDown, default 0) applied ONLY to the lossy effective-target comparison in classifyLossyDeviceBound to damp ffprobe source-bitrate drift. The lossless DB-bitrate fallback + bitrateTolerance knob were left untouched (their removal is a later slice).

Handler (handler.ts): qualityTargetFromConfig forwards the tolerances; detectUpdates only routes a source-bound change to toUpdate when it fires (reEncodes); postProcessPresetChanges passes the policy to both bounds and now routes a policy-suppressed LOSSLESS change to reportOnlyQualityChanges too (the lossy branch already did). resolveUpgradeAction now also forces the re-encode bitrate for a match-all-followed source-down (idempotent: re-encodes to the source bitrate).

Config (packages/podkit-cli/src/config): nested `[bitrate]` (global) and `[devices.<name>.bitrate]` blocks with sync + toleranceUp/toleranceDown; parseBitrateBlock validates (invalid sync names the field + valid values; out-of-range tolerance rejected; non-table is a type error). resolve.ts resolves bitrateSync (device -> global -> 'match-cap') and the tolerances. ResolvedMusicConfig.bitrateSync wired through.

CLI (commands/sync.ts): `--bitrate-sync <mode>` value Option with .choices(BITRATE_SYNC_MODES); mirrors `--encoding` (no Commander default, so an unpassed flag is absent and the resolved device policy wins). Threaded through deriveSettings -> MusicContentConfig -> createMusicHandler.

Tests: gate matrix (36), classifier policy/tolerance/encoding-mismatch/ALAC-under-off cases (upgrades.test.ts), loader validation + resolve chain + sync option tests, and two new e2e (match-all follows source-down and converges; off freezes a cap-down and reports it suppressed) on the dummy iPod.

Deliverables: changeset (.changeset/bitrate-sync-policy.md, minor podkit + @podkit/core), docs (config-file.md + cli-commands.md), arch doc (documents/architecture/sync/upgrades.md §1a policy gate + ladder).

Gates: lint clean; build full-turbo; @podkit/core unit 3348 pass; podkit unit 1913 pass; e2e (dummy) upgrades/preset-change/mass-storage-sync/artwork-sync-tags 47 pass.

AC #5 left UNCHECKED deliberately: source-bound tolerance was added, but the DB-bitrate fallback was NOT removed and bitrateTolerance was NOT repurposed — the prompt scoped that removal to a later slice.

Self-review (dispatched a sonnet reviewer on the diff) surfaced a CRITICAL idempotency bug in the cap feature, now fixed: for a SAME-FAMILY lossy source above the cap (e.g. an AAC source re-encoded AAC->AAC on cap-down, so the device copy stays AAC), the cap-UNAWARE source bound fired `source-improved` against the device DB bitrate and `resolveUpgradeAction` routed it to a plain COPY of the over-cap source -> re-exceeding the cap and ping-ponging against the next sync's cap-down every other sync. (MP3 sources don't hit this: MP3->AAC cap-down makes the device cross-family, so the source bound goes null.) Fix: in MusicHandler.detectSourceQualityChange, suppress `source-improved` when a lossy cap applies and source.bitrate > cap — the cap-aware device bound owns that direction (re-encodes from the source to min(source,cap) using the authoritative sync-tag bitrate). Within-cap improvements (source <= cap) still fire and copy (quality preserved); no-cap (lossless target) keeps the legacy behaviour. Covered by two new deterministic handler unit tests (above-cap suppressed; within-cap fires). Also fixed a LOW finding: classifyLossyDeviceBound now treats source.bitrate===0 as unknown (`!sourceBitrate`), matching the source bound's truthy guard. (An AAC-fixture e2e for this was attempted but dropped — a synthetic source doesn't reliably reproduce an over-cap AAC copy on the dummy target; the existing MP3 cap-down idempotency e2e plus the new unit tests cover it.) Other review findings (JSON-vs-human breakdown of suppressed counts; legacy untagged-lossy opt-out; lossy encoding-mismatch) were judged pre-existing/by-design/out-of-scope and noted, not changed.

Final gates after the fix: lint clean; build full-turbo; @podkit/core unit 3351 pass / 5 skip / 0 fail; podkit unit 1913 pass / 0 fail; e2e (dummy) 47 pass across upgrades/preset-change/mass-storage-sync/artwork-sync-tags.

A second, more thorough background reviewer caught THREE build-breakers my initial targeted gates (build + test:unit on core/podkit only) missed because they surface only under the FULL `turbo run typecheck` (build tsconfigs exclude test files; the demo package was outside my filter). All fixed and verified:
1. mergeConfigs (loader.ts) never merged the new `bitrate` field, so a GLOBAL `[bitrate]` block was silently dropped and the policy fell back to match-cap on every run. Added a field-by-field merge (later layer wins, untouched tolerances preserved) + a mergeConfigs regression test.
2. Several test object literals were missing the newly-required fields after I extended the interfaces: MusicContentConfig in sync-aggregation.test.ts (effectiveBitrateSync/toleranceUp/toleranceDown), ResolvedDeviceSettings in device/info-render.test.ts (bitrateSync/toleranceUp/toleranceDown), and two ResolvedMusicConfig literals in classifier.test.ts (bitrateSync). Plus a string-narrowing fix in my loader test loop (`as const`).
3. The demo mock (packages/demo/src/mock-core.ts) lacked the new VALUE exports applyBitrateSyncPolicy + BITRATE_SYNC_MODES, failing its static export-completeness check. Added both.

Also applied two cheap correctness/doc fixes from the review: refreshed the stale QualityChangeReason / classifyQualityChange JSDoc (encoding-mismatch IS produced now; match-all follows source-down) and softened the detectUpdates comment that over-promised report-only surfacing for untagged tracks. Remaining low-severity review notes (gateChange in-place mutation on fresh objects, duplicate reportOnly push block, source-down-suppressed reason name under match-all) were judged acceptable and left as-is.

Final gates: lint clean; FULL `turbo run typecheck` 36/36; @podkit/core unit 3351 pass / 5 skip / 0 fail; podkit unit 1914 pass / 0 fail; e2e (dummy) 47 pass.

Team-lead review pass (Sonnet) + fixes: caught that mergeConfigs deep-merged the global [bitrate] block but still spread the per-device [devices.x.bitrate] block wholesale — a later config layer overriding one bitrate field (e.g. sync) would clobber another layer's tolerances. Fixed with field-by-field device-bitrate merge + a regression test mirroring the global-block test. Reviewer verified idempotency (same-family lossy cap oscillation fix, match-all source-down target bitrate), the full 35-cell gate table, off-lets-preconditions-fire, skipUpgrades-above-gate, and the CLI option-source guard — all correct. Pre-existing dead param loadCliConfig(globalOpts) left as-is (unrelated to this change; would ripple an exported signature across all call-sites). Gates green: lint 0/0, full typecheck 36/36, @podkit/core 3351 pass, podkit cli unit pass, e2e dummy 47 pass (upgrades/preset-change/mass-storage-sync/artwork-sync-tags).

AC#5 retro-checked now satisfied: the source-bound tolerance landed in this slice, and the legacy bitrateTolerance reinterpretation (DB-fallback role gone) was completed in the sibling slice that removed the DB-bitrate fallback — bitrateTolerance is now wired as the symmetric fallback for the source-bound toleranceUp/toleranceDown in qualityTargetFromConfig (toleranceUp ?? bitrateTolerance, toleranceDown ?? bitrateTolerance), and QualityTarget no longer carries a fallback bitrateTolerance. The DB-bitrate fallback path is gone for audio.
<!-- SECTION:NOTES:END -->
