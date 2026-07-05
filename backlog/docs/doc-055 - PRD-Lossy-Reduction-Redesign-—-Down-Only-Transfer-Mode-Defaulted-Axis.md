---
id: doc-055
title: 'PRD: Lossy Reduction Redesign — Down-Only, Transfer-Mode-Defaulted Axis'
type: specification
created_date: '2026-06-30 11:56'
tags:
  - sync
  - transcoding
  - quality
  - bitrate
  - refactor
  - adr-023
---
## Status

Planned. Implements **ADR-023** (Lossy Reduction Is a Down-Only, Transfer-Mode-Defaulted Axis). Supersedes the lossy cap-enforcement portion of doc-051 and reshapes the bitrate-sync machinery the epic shipped on `feat/quality-change-bidirectional` (left RED on purpose). Principle-level statements: `documents/principles/transcoding.md`, `documents/principles/transfer-modes.md`, `documents/principles/library-safety.md`.

## Problem Statement

A user syncing a music collection wants podkit to make sensible, safe decisions about whether to shrink lossy audio:

- "I picked a quality tier to control the size of files podkit *makes* — I did not ask it to silently re-encode the MP3s and AACs it could just copy." (The shipped epic broke this: device-native lossy sources were transcoded down to the cap on first add, even same-codec AAC→AAC — 16 codec-matrix cells regressed.)
- "If podkit ever does shrink a lossy file, it must never make it *bigger* or degrade it for no space gain. I'm especially nervous about VBR." (The shipped epic could re-encode VBR→CBR at the same nominal bitrate, growing the file and stacking a lossy loss.)
- "Re-compressing a lossy file to a *higher* bitrate is pointless — it can't recover quality. Don't do it." (The epic re-encoded up.)
- "When podkit *won't* do something — because it would degrade my audio, or because I'd need to opt in — I want to be told, not left guessing."
- "I want one clear knob for 'shrink to fit more songs' vs 'keep my quality', with a sensible default, not a five-value policy enum I have to reason about."

Underneath: the epic conflated **transfer mode** (a metadata/artwork concern) with the **bitrate** decision, added a five-mode `[bitrate].sync` policy that re-encodes in both directions, and duplicated the core `min(source, cap)` decision across three code sites that can disagree (the root cause of the add-vs-resync regression).

## Solution

Two **orthogonal axes**, each owning one concern:

1. **Transfer mode** (`fast`/`optimised`/`portable`) stays the metadata/artwork strategy it was designed to be. It does not decide bitrate — it only supplies the *default* for axis 2.
2. **Lossy reduction** becomes its own axis: `[bitrate].reduce = auto | always | never`. `always` = **convert** (shrink over-cap lossy), `never` = **preserve** (copy untouched), `auto` (default) follows the transfer mode (`optimised`→convert, `fast`/`portable`→preserve). An explicit value overrides the mode's lean.

Reduction is **down-only** and the quality preset is a **hard ceiling**. A reduction fires only when the source meaningfully exceeds the cap (a percentage tolerance, default 25%, on the wobbly source bitrate; the deterministic recorded bitrate is compared exactly). The target codec is the user's resolved preference stack (never hardcoded AAC). Codec efficiency is honoured in exactly one place — matching quality on a *forced* cross-codec transcode. A lossy file is never grown: standalone CBR/VBR re-encodes are removed on the lossy path. A track left below a *raised* cap is reported (with `--force-transcode` to lift), never auto-upgraded.

The whole decision collapses into **one pure function** shared by the add path and the re-sync path, so a track is never decided two different ways.

## User Stories

1. As a user with a mixed MP3/AAC/FLAC collection on the default settings, I want my device-native MP3s and AACs copied untouched, so that podkit never degrades audio it could simply transfer.
2. As a user who chose `optimised` to fit more songs on a small device, I want over-cap lossy files shrunk to my quality tier, so that I reclaim space.
3. As a user who chose `optimised` but does **not** want any re-encoding, I want to set `reduce = never`, so that podkit strips artwork/metadata to save space but never touches my audio bitrate.
4. As a user who wants the fastest possible sync but still wants to shrink large lossy files, I want `fast` + `reduce = always`, so that I get speed-of-sync handling with reduction.
5. As a user on `portable`, I want my files kept self-contained (artwork preserved) even when a reduction or a forced transcode happens, so that they're usable outside the device.
6. As a user, I want podkit to never re-encode a lossy file to a *higher* bitrate, so that it never wastes space on quality it cannot recover.
7. As a user with VBR files, I want podkit to never re-encode them just to flip CBR/VBR mode, so that my files never grow and never lose quality for a cosmetic change.
8. As a user, I want any reduction to land strictly below a source that exceeds the cap, so that a "reduction" always actually saves space.
9. As a user, I do **not** want a source that's only slightly above the cap re-encoded, so that podkit doesn't churn audio for a trivial space saving (a percentage tolerance).
10. As a user who lowers my quality cap, I want already-synced tracks re-encoded down to the new cap on the next sync, so that the change applies deterministically.
11. As a user who *raises* my quality cap, I want already-reduced tracks left as they are but *reported*, with a clear `--force-transcode` path to lift them, so that I'm not surprised by silent inaction and have an explicit way to upgrade.
12. As a user whose source file degraded below the device copy (a bad re-rip), I want podkit to keep the better device copy and report it, so that I'm not silently downgraded.
13. As a user with a non-AAC device codec stack (e.g. Opus on Rockbox), I want reductions and forced transcodes to target *my* resolved codec, not a hardcoded AAC, so that podkit respects my device and preferences.
14. As a user with an Opus source on a device that can't play Opus, on `preserve`, I want the forced transcode to match the source's *quality* in the target codec (efficiency-aware) rather than blindly matching kbps, so that I lose as little as possible to the unavoidable re-encode.
15. As a user on `convert` with a forced cross-codec transcode, I want it capped (shrunk), so that "convert" means shrink everywhere consistently.
16. As a user who set `quality=low`, I want that to be a real ceiling even under `preserve`, so that I never get files above the quality I asked for.
17. As a user reading `--dry-run` JSON, I want a clear, current reason vocabulary (no removed `cap-up`/`source-improved` strings), so that my tooling reflects what podkit actually does.
18. As a user, I want one documented `[bitrate].reduce` + `[bitrate].tolerance` config (global, per-device, CLI, env), so that I have powerful but simple control.
19. As a user upgrading from the old `[bitrate].sync` config, I want a clear changelog and validation error pointing me to the new options, so that I'm not silently broken.
20. As a contributor, I want the add path and the re-sync path to share one reduction function, so that a track is never decided two ways and the 437.08-class regression cannot recur.
21. As a contributor, I want the bitrate decision in one exhaustively-tested pure module, so that I can change policy with confidence.
22. As a contributor, I want all the removed `[bitrate].sync` policy code and tests deleted (no deprecation, no dead code), so that the codebase reflects exactly one model.
23. As a maintainer, I want the codec matrix added to the standard e2e gate, so that a copy-vs-transcode regression like 437.08 is caught before merge.

## Implementation Decisions

### New deep modules (the heart of the refactor)

- **`resolveLossyReduction` (pure, the core deep module).** Encapsulates the entire ADR-023 target-bitrate table behind a small interface: given the (lossy) source codec+bitrate, whether the device plays it natively, the resolved target codec, the cap, the reduction axis (`convert`/`preserve`), an optional device max bitrate, and the percentage tolerance — it returns either `{ action: 'copy' }` or `{ action: 'transcode', bitrate }`. It owns: down-only, the cap as a hard ceiling, the percentage tolerance on the source side, and the **only** use of the codec-efficiency table (the preserve + forced-cross-codec row). Lossless sources never enter it. This single function **replaces three duplicated `min(source, cap)` decision sites** (the add-path classifier, the re-sync device-bound, and the handler's adoption path).
- **`resolveReductionAxis` (pure, tiny).** Maps `(reduce: 'auto'|'always'|'never', transferMode)` → `'convert' | 'preserve'`. Pins the default mapping (`auto`: optimised→convert, fast/portable→preserve) in one testable place.
- **Codec-efficiency table** (constant data, `aac 1.0 / opus 0.75 / vorbis 0.90 / mp3 1.30`), consumed only by `resolveLossyReduction`, behind the same seam so a future per-device or user override is a non-breaking addition.

### Code to REMOVE (no deprecation — deleted outright)

- `BitrateSyncMode`, `BITRATE_SYNC_MODES`, `applyBitrateSyncPolicy`, and the bitrate portion of `gateChange` (the policy gate) in the engine upgrades module.
- The `cap-up` reason and the `source-improved`-as-upward-re-encode behaviour; the standalone lossy `encoding-mismatch` branch. (`lossless-boundary`, the lossless-source `encoding-mismatch`, and `source-down-suppressed` report-only remain.)
- The `[bitrate].sync` five-mode enum, the `--bitrate-sync` CLI flag, the `PODKIT_BITRATE_SYNC` env var, and `toleranceUp`/`toleranceDown` on the `[bitrate]` config block.
- The legacy flat `bitrateTolerance` knob **for audio** (verify video's `detectBitratePresetMismatch` no longer reads it before removing; if video needs a tolerance it keeps its own constant). `detectBitratePresetMismatch` / `DEFAULT_VBR_TOLERANCE` survive for **video only**.
- The dedicated policy test suite (`bitrate-sync-policy.test.ts`) is deleted with the policy.

### Code to MODIFY (thin adapters over the new seam)

- **Add path** (music classifier) and **re-sync path** (engine device-bound) and **adoption path** (music handler) all collapse to a `resolveLossyReduction` call; the device-bound sheds its lossy cap-up/encoding branches and emits a reduction from the seam.
- **Config**: the `[bitrate]` schema gains `reduce` + `tolerance` and loses `sync`/`toleranceUp`/`toleranceDown`; the loader validates the new shape; resolution computes the axis via `resolveReductionAxis(reduce, transferMode)` and threads `tolerance`; `ResolvedMusicConfig` carries the axis + tolerance instead of `bitrateSync`. Env defaults gain `PODKIT_BITRATE_REDUCE` / `PODKIT_BITRATE_TOLERANCE`.
- **CLI**: `--bitrate-reduce <auto|always|never>` and `--bitrate-tolerance <fraction>` replace `--bitrate-sync`; threading and decision-source attribution updated.
- **Output vocabulary**: the sync JSON reason set and the music presenter drop `cap-up`/`source-improved`; the report-only channel keeps surfacing `source-down-suppressed` and adds the **below-raised-cap** report ("N tracks below your quality target; `--force-transcode`"). Formatters and the demo mock-core follow.
- **Device capabilities**: an optional `maxAudioBitrate?` field (absent → unbounded → preserve-necessity targets the source bitrate). No device populates it yet.
- **Upgrade routing** (handler `resolveUpgradeAction`) keeps consuming `qualityChange.targetBitrate` as the preset `bitrateOverride`; the change now originates from the seam.

### Behavioural rules (from ADR-023)

- Reduce iff `source > cap × (1 + tolerance)` (default `0.25`); the recorded-bitrate-vs-cap comparison is exact.
- Target bitrate table: native+preserve→copy; native+convert→cap; necessity+preserve→`min(round(source × eff[T]/eff[S]), cap, deviceMax)`; necessity+convert→`min(source, cap)`; lossless→preset.
- A convert records the **nominal** target in the sync tag (not the measured VBR output) for idempotency.

## Testing Decisions

Good tests here verify **external behaviour** — the decision a function returns, the operation the planner emits, the sync tag written, the JSON/text the CLI prints — not internal wiring. The user's directive: **good tests for everything**, and the deleted policy's tests go with it.

- **`resolveLossyReduction` — exhaustive unit matrix (highest priority).** Every row of the table × every edge: source at/below cap, just inside vs just outside the tolerance, device-native vs forced (necessity), `convert` vs `preserve`, `deviceMax` clamp present/absent, and the efficiency math for each `(source, target)` codec pair. Down-only and cap-ceiling invariants asserted (no output above cap except never; no output above source). Prior art: the existing `upgrades.test.ts` quality matrix and `bitrate-sync-policy.test.ts` table style (the latter's coverage migrates here).
- **`resolveReductionAxis` — full 3×3** (`reduce` × `transferMode`) truth table.
- **Classifier / device-bound / handler adapters** — shrink to "calls the seam, routes copy vs transcode, builds the right preset `bitrateOverride`, writes the right sync tag." Reuse the existing `classifier.test.ts` / `upgrades.test.ts` / `handler.test.ts` factories; delete the cap-up/source-improved/policy cases.
- **Config** — `loader.test.ts` (validate `reduce`/`tolerance`, reject the removed keys with a clear error), `resolve.test.ts` (axis resolution global→device→CLI, default `auto`→mode lean, `tolerance` default 0.25).
- **CLI** — `sync.test.ts` (the new flags thread through; `--bitrate-sync` is gone), presenter/formatter tests for the new reason vocabulary and the below-raised-cap report.
- **E2E (the integration pins)** — `features/upgrades.test.ts` and `features/preset-change.test.ts` rewritten to the new model (down-only, convert/preserve, report-only); the **codec matrix** (`matrix/`) gains optimised=convert expectations and is **added to the standard e2e gate set** so the 437.08 copy-vs-transcode regression is caught. An idempotency pin: convert a track, re-sync, assert no second operation (add path and re-sync agree).
- **Branch returns to green**: implementing `preserve` as the default for `fast`/`portable` restores the 16 regressed copy cells first; the optimised cells then assert convert.

## Out of Scope

- **Video** quality/bitrate detection — unchanged; `detectBitratePresetMismatch` + the VBR tolerance stay for video (no sync tags, reliable container bitrate). Video symmetry is doc-054, separate.
- **Codec-efficiency-weighted *tolerance*** and a **VBR/CBR efficiency sub-factor** — deferred (ADR-023 "considered and deferred"); v1 uses raw kbps for space decisions and the per-codec table only for preserve-necessity.
- **Per-device `maxAudioBitrate` data** — the capability seam is added; no device profile populates it yet.
- **Lossless→lossless and lossy→lossless (re-rip) detection** — unchanged; out of scope.
- **Config migration** from `[bitrate].sync` — none; clean break with a validation error and changelog note (matches the project's no-deprecation policy).
- **Adopting untagged tracks** — unchanged (ADR-022 `--force-sync-tags-transcode`).

## Further Notes

- **Versioning**: minor bump for `podkit` and `@podkit/core` (breaking config change, per the project's minor-for-CLI-breaking policy). Changesets required.
- **Docs to update in the same work** (AC of the parent design task): `docs/reference/{config-file,cli-commands,environment-variables}.md`, `docs/user-guide/{syncing/upgrades,transcoding/audio}.md`, `docs/troubleshooting/common-issues.md`, `docs/developers/quality-preset-testing.md`, and the architecture doc `documents/architecture/sync/upgrades.md` (rewrite for the two-axis, down-only model). Mark doc-051's lossy-cap portion superseded by ADR-023.
- **Suggested slice order** (tracer-bullet, green-first): (1) extract `resolveLossyReduction` + `resolveReductionAxis` with full unit tests, wire the **add path** to it with `preserve` default → restores the 16 regressed cells; (2) wire the **re-sync** device-bound to the seam, remove `cap-up`/`source-improved`/lossy-`encoding-mismatch` + the policy + its test; (3) config + CLI + env swap (`reduce`/`tolerance`), delete `[bitrate].sync`/tolerances; (4) below-raised-cap report-only + output vocabulary; (5) `maxAudioBitrate` capability seam + efficiency table fully exercised; (6) codec-matrix expectations + add to the e2e gate; (7) docs + changesets.
- **Anti-regression principle**: one pure decision function, one test matrix, shared by add and re-sync — the structural fix that makes the original bug class impossible.
