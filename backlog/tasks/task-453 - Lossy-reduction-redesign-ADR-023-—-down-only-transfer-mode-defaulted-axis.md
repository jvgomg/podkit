---
id: TASK-453
title: 'Lossy reduction redesign (ADR-023) — down-only, transfer-mode-defaulted axis'
status: Done
assignee: []
created_date: '2026-06-30 16:50'
updated_date: '2026-07-05 14:10'
labels:
  - sync
  - transcoding
  - quality
  - bitrate
  - refactor
dependencies: []
references:
  - adr/adr-023-lossy-reduction-down-only.md
  - >-
    backlog/docs/doc-055 -
    PRD-Lossy-Reduction-Redesign-—-Down-Only-Transfer-Mode-Defaulted-Axis.md
  - documents/principles/transcoding.md
  - documents/principles/transfer-modes.md
  - documents/principles/library-safety.md
priority: high
ordinal: 204000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implementation epic for the lossy quality-change redesign. **Design of record: ADR-023; full plan: PRD doc-055; principles: documents/principles/{transcoding,transfer-modes,library-safety}.md.**

Supersedes the lossy-cap machinery shipped under the TASK-437 epic (left RED on `feat/quality-change-bidirectional`). This is the rework that returns the branch to green and replaces the five-mode `[bitrate].sync` policy.

**The model (two orthogonal axes):**
- **Transfer mode** (`fast`/`optimised`/`portable`) stays the metadata/artwork axis (doc-011/012); it is NOT primary for bitrate — it only sets the default of axis 2.
- **Lossy reduction** = `[bitrate].reduce = auto | always | never` (auto follows the mode: optimised→convert, fast/portable→preserve). Down-only; the quality preset is a hard ceiling; reduce iff `source > cap×(1+tolerance)` (default 0.25, source-side only — recorded-vs-cap is exact). Target codec = resolved stack (never hardcoded AAC); codec efficiency only on a forced cross-codec preserve transcode. No standalone CBR/VBR re-encode on lossy. A track below a raised cap is reported, never auto-lifted.

**Anti-regression core:** the add path and the re-sync path share ONE pure decision function (`resolveLossyReduction`), so the 437.08-class add-vs-resync disagreement cannot recur.

**Removes (no deprecation):** `BitrateSyncMode`/`applyBitrateSyncPolicy`/the policy gate, `cap-up`, `source-improved`-up, the lossy `encoding-mismatch` branch, `[bitrate].sync`/`--bitrate-sync`/`PODKIT_BITRATE_SYNC`/`toleranceUp`/`toleranceDown`, and `bitrate-sync-policy.test.ts`. See doc-055 for the full code+test inventory.

Subtasks are tracer-bullet, green-first slices. Versioning: minor bump for `podkit` + `@podkit/core` (breaking config); changesets required.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## SHIM / DEVIATION / DEFERRED LEDGER (must reach zero by session end)

### SHIMS — temporary, MUST be removed
| # | Shim | Introduced | Removed by | Status |
|---|---|---|---|---|
| S1 | `BitrateSyncMode`/`BITRATE_SYNC_MODES` re-homed into `podkit-cli/config/types.ts`; `--bitrate-sync` flag inert | .02 | .03 | OPEN |
| S2 | `config.ts` core `bitrateSync` field retyped `string` (orphaned/unconsumed) | .02 | .03 | OPEN |
| S3 | TWO hardcoded `resolveReductionAxis('auto',...)` sites (classifier.ts + handler.ts) — axis-disagreement risk | .01/.02 | .03 (resolve axis ONCE in config, thread to both) | OPEN |
| S4 | classifier `LOSSY_REDUCTION_TOLERANCE = 0.25` hardcoded constant | .01 | .03 (config `[bitrate].tolerance` threads to add path) | OPEN |

### DEFERRED — work parked for a later slice
| # | Deferred | Owner slice | Status |
|---|---|---|---|
| D1 | `source-down-suppressed` producer dropped (bad-re-rip safety, user story 12); handler `reEncodes:false` branches dormant | .04 | OPEN |
| D2 | `maxAudioBitrate` capability field not added; `deviceMax` passed undefined | .05 | OPEN |
| D3 | Adoption path (`postProcessSyncTagsTranscode`) keeps its own `min(source,cap)` — 3rd duplicated site not through seam | .05 | OPEN |
| D4 | Adoption pass may still emit lossy `cap-up` — verify when it routes through the seam | .05 | OPEN |
| D5 | Codec-matrix reference model not updated (optimised=convert); upgrades/preset-change e2e not rewritten; e2e-gate why-it-slipped diagnosis | .06 | OPEN |
| D6 | Docs (architecture upgrades.md + user docs) + changesets; supersede doc-051 | .07 | OPEN |

### KNOWN EDGE — needs a decision before end
| # | Edge | Decide in | Status |
|---|---|---|---|
| E1 | Lossless device copy (ALAC, no tag bitrate) + lossy source + lossy target → `lossless-boundary` DOWN skipped (routes to lossy device-bound → null) | .04/.06 | OPEN |

### DEVIATIONS — accepted as PERMANENT + correct (document, do not 'fix')
- `cap-up` retained for lossless/ALAC upgrades (ADR-023 §3; only lossy cap-up removed).
- preserve-necessity target may exceed source raw kbps (quality-match, ADR §5).
- `transferMode` value is `optimized` (codebase spelling) vs ADR prose `optimised`.

### PRE-EXISTING DEBT (not introduced here; clean up opportunistically)
- `commands/sync.ts` unused imports (red-branch debt; relates to .04 output vocab).
- `upgrades.ts` `TASK-142` comment (unrelated function; leave unless touched).

LEDGER UPDATE (after .03): S1 (CLI sync shim + --bitrate-sync) → DONE. S2 (orphaned core bitrateSync field) → DONE. S3 (two hardcoded resolveReductionAxis sites) → DONE — axis now resolved ONCE in resolveMusicConfig, threaded to classifier ctx + qualityTargetFromConfig; grep confirms one production call site. S4 (LOSSY_REDUCTION_TOLERANCE const) → DONE — config [bitrate].tolerance threads to the add path; re-sync keeps tolerance:0. New surface: [bitrate].reduce/tolerance (global→device→CLI→env PODKIT_BITRATE_REDUCE/PODKIT_BITRATE_TOLERANCE), loader rejects removed keys with a clear message. Gates: core 3365, CLI 1920, full typecheck 42/42. OPEN remaining: D1-D6, E1.

FOR SLICE .06 (from .03 review) — e2e `features/upgrades.test.ts` lines ~1250-1641 `describe('self-healing sync: bitrate-sync policy modes')` must be rewritten: (a) `match-all follows degraded source down` (1251-1335) → DELETE/replace — no equivalent in reduce axis; assert source-down is NOT followed by default. (b) `CBR/VBR flip under off` (1337-1449) → rewrite — a lossy CBR flip now produces NO update regardless of flag (ADR §6). (c) `lossless→lossy boundary under off` (1451-1550) → map to `--bitrate-reduce never` (lossless paths ignore the axis, boundary still fires). (d) `off freezes a cap-down` (1552-1640) → map to `--bitrate-reduce never`. .03 review confirmed single-axis guarantee, clean break, cascade all SOLID.

LEDGER UPDATE (after .04): D1 (source-down-suppressed) → DONE — re-homed into classifySourceBound as `source.bitrate < recorded×(1−tolerance)`; report-only (reEncodes:false), keeps device copy, NO operation (test-pinned); dormant handler branches reactivated, DORMANT note removed. E1 (ALAC device copy + lossy source boundary) → DONE (pending review) — worker added a lossless-device-copy guard in classifyDeviceBound emitting lossless-boundary down for a lossy source/target, +2 tests. Below-cap (AC#1) → added new `below-cap` reason, discriminator = sync-tag preset tier strictly below target tier (excludes quality=copy device-native, same-tier wobble, recorded==cap); aggregate low-noise CLI line; `--force-transcode` lifts + suppresses the report. Vocab: `quality-change-below-cap` breakdown key + formatter; presenter splits report-only by reason. PRE-EXISTING DEBT (sync.ts unused imports) → CLEANED (8 unused removed). QualityChangeReason now: format-mismatch(reserved), encoding-mismatch, lossless-boundary, cap-down, cap-up, source-down-suppressed, below-cap. Gates: core 3376, CLI 1923, full typecheck 42/42 (confirmed after core dist rebuild). NEW minor edge E2: a source-down track with a concurrent artwork/metadata change lands in toUpdate for that change so its source-down report is skipped that run (audio still correctly kept) — low-noise, acceptable. OPEN remaining: D2,D3,D4,D5,D6 (+ confirm E1 in review).

LEDGER UPDATE (after .05): D2 (maxAudioBitrate) → DONE — optional field added to DeviceCapabilities, threaded to BOTH seam call sites (add path via ClassifierContext.deviceMaxBitrate; re-sync via QualityTarget.deviceMax); NO device profile populates it; tests prove present=clamps/absent=unbounded. D3 (adoption dedup) → DONE — postProcessSyncTagsTranscode now routes its lossy target through resolveLossyReduction; grep proves the seam is the SOLE min(source,cap) lossy site (the ffmpeg-prediction Math.min is a video pixel clamp). D4 (adoption reason) → DONE — old code mislabelled direction from the unreliable DB bitrate (a reduction could read as cap-up); now derives from seam-target-vs-source → cap-down for an over-cap reduction; test-pinned. New e2e features/lossy-preserve-efficiency.test.ts (preserve>convert efficiency fingerprint, ≤cap, re-sync no-op). Behavioural refinement to VERIFY in review: adoption of a within-tolerance device-native lossy track is now TAG-ONLY (no needless re-encode) vs the old always-transcode. Gates: core 3384, full 42/42. OPEN remaining: D5 (.06), D6 (.07). E1 confirmed DONE in .04 review. E2→TASK-454.

LEDGER UPDATE (after .06 + .07): D5 (codec matrix + e2e + gate) → DONE — full branch GREEN (unit 37/37, typecheck/lint/build 42/42, e2e 36/36; codec matrix 80 pass). Gate forensics: matrix existed pre-437.08 and IS in the suffix gate; 437.08 slipped because its verification never ran test:e2e AND the reference model had no reduction dimension (now added, asserts convert+preserve both ways). One cell flipped (MA147/aac/optimized→transcode). Idempotency pinned (convert). D6 (docs+changesets) → DONE — architecture upgrades.md rewritten, 7 user docs updated, doc-051 superseded, changeset (minor podkit+@podkit/core) added + stale changesets removed; docs-site build passes.

OPEN FIX BATCH (from .05 review — found in e2e-untested bands; must close for 'perfect'): B1 idempotency in the (cap, cap×tol] band — a within-tolerance over-cap device-native source is COPIED on add but the re-sync device-bound (tolerance:0) REDUCES it = add/re-sync disagreement. Principled fix: re-sync applies config tolerance for a COPY-quality tag, exact(0) for a CONVERTED preset tag. B2 forced below-cap lift must clamp target to min(source,cap) (never inflate a lossy source up). S4 adoption copy tag stamps artworkHash without transferring artwork → pass undefined. S5 detectSourceQualityChange (match-loop) doesn't thread config.reductionTolerance. S6 unconfigured mass-storage (supportedAudioCodecs undefined) → adoption treats device-native AAC/MP3 as necessity-transcode. N7 losslessBoundaryDown helper orphaned classifyDeviceBound's JSDoc (my edit) — reorder. B3 (source-down keeps an over-cap copy) ACCEPTED as correct (only re-encode source is the worse re-rip) — surface, don't force-degrade.

FIX BATCH CLOSED (post-.05-review, done by team-lead directly after the fix sub-agent hit a spend limit). All TDD (failing test first), full gate green after each. B1 (band idempotency) → DONE: QualityTarget gained reductionTolerance; classifyLossyDeviceBound now uses config tolerance for a COPY-quality tag (re-evaluates like the add path → within-tolerance copy stays copied) and EXACT 0 for a CONVERTED preset tag (lowered cap applies fully). transfer.ts confirmed copy tags carry the source bitrate, so this was a real add-vs-resync split. +3 unit cases. B2 (forced lift inflate) → DONE: lift target clamped to min(source,cap); +test (source 192 < cap 256 → lift to 192 not 256). S4 (adoption artworkHash) → DONE: pass undefined so artwork-added still fires. S5 (tolerance threading) → DONE: detectSourceQualityChange threads config.reductionTolerance. S6 (unconfigured device adoption) → DONE: adoption deviceNative now mirrors the classifier (isDeviceCompatible OR categorizeSource==='compatible-lossy'), so mp3/aac on an undeclared-codec device are COPIED not necessity-transcoded; 3 adoption unit tests had encoded the pre-fix inconsistency → updated (genuine over-tolerance reduction fixtures; efficiency test switched to a real incompatible vorbis source). The .05 opus efficiency e2e is unaffected (opus is genuinely incompatible). N7 (orphaned JSDoc) → DONE: losslessBoundaryDown moved above the classifyDeviceBound doc. N8 (tier-order drift) → DONE: QUALITY_TIER_ORDER + REDUCED_TAG_QUALITIES now DERIVED from QUALITY_PRESETS (a new preset can't silently drop out). B3 → ACCEPTED (source-down keeps an over-cap copy; the only re-encode source is the worse re-rip). N10 → deferred to a follow-up (cosmetic: adoption labels a same-bitrate forced codec transcode as cap-up; honest fix needs vocab+resolveUpgradeAction+presenter changes, disproportionate this late). FINAL GATE: unit 37/37, typecheck/lint/build 42/42, e2e 36/36. ALL SHIMS (S1-S4) and DEFERRED (D1-D6) CLOSED. Edges E1 DONE, E2→TASK-454, E3(N10)→follow-up.

POST-COMPLETION HARDENING (user follow-up: 'anything else' + 'no deprecation/shims'). (1) Real-device smoke — skipped per user. (2) IDEMPOTENCY SWEEP added: new e2e `features/reduction-idempotency.test.ts` — real sync + re-sync asserting `completed===0` and no add/upgrade churn across 5 convergence-critical scenarios: convert-reduce, TOLERANCE-BAND COPY (the B1 fix, previously uncovered end-to-end), preserve-copy, lossless, and raised-cap→below-cap (report-only, no churn). The codec matrix is dry-run-only so it structurally couldn't prove this; `isStableNoFileOp` was an unused helper. (3) DOCS: `docs/user-guide/transcoding/audio.md` now explicitly states files can sit up to 25% above the cap under convert (the tolerance is anti-churn, not a hard trim) + points to `tolerance=0` for exact enforcement (config-file.md already had it). (4) ARTWORK DOWNGRADE CHECK: confirmed a REAL (narrow, pre-existing) silent downgrade — a source-down track that also needs artwork-added gets its audio re-copied from the worse source (artwork-added is a file-replacement) → filed TASK-457 with fix options. DEPRECATION/SHIM SWEEP: clean — S1-S4 gone, policy machinery deleted, `--bitrate-sync` gone; only the clean-break loader REJECTION of removed keys remains (correct, not deprecation); pre-existing unrelated 'legacy' markers (ALAC/codec-inference/normalization) are out of scope. Also fixed: `@podkit/device-types` was missing from the changeset for the `maxAudioBitrate` field → added (patch). Filed TASK-456 (N9: convert-necessity ignores deviceMax, latent). Gate: typecheck/lint/build 42/42, docs 68 pages, e2e green (incl. new sweep).
<!-- SECTION:NOTES:END -->
