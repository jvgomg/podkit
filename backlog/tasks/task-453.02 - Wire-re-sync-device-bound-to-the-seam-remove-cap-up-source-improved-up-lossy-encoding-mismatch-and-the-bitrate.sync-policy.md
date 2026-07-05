---
id: TASK-453.02
title: >-
  Wire re-sync device-bound to the seam; remove cap-up, source-improved-up,
  lossy encoding-mismatch, and the bitrate.sync policy
status: Done
assignee: []
created_date: '2026-06-30 16:51'
updated_date: '2026-07-05 14:10'
labels:
  - sync
  - transcoding
  - quality
  - refactor
dependencies: []
references:
  - adr/adr-023-lossy-reduction-down-only.md
  - >-
    backlog/docs/doc-055 -
    PRD-Lossy-Reduction-Redesign-—-Down-Only-Transfer-Mode-Defaulted-Axis.md
parent_task_id: TASK-453
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Slice 2. Prereq: slice 1 (the seam). Re-sync path uses the shared seam; delete the policy machinery. No deprecation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 classifyLossyDeviceBound reshaped to call resolveLossyReduction; emits a down-only reduction (or copy) from the seam; the recorded-bitrate-vs-cap comparison is exact (no tolerance on that side)
- [x] #2 cap-up reason and source-improved-as-upward-re-encode removed; classifySourceBound no longer produces an upward re-encode (re-rip folds into ordinary content-change)
- [x] #3 Standalone lossy encoding-mismatch branch removed; lossless-source encoding-mismatch and lossless-boundary preconditions and source-down-suppressed report-only retained
- [x] #4 BitrateSyncMode, BITRATE_SYNC_MODES, applyBitrateSyncPolicy, and gateChange's bitrate logic deleted; bitrate-sync-policy.test.ts deleted; index.ts exports updated
- [x] #5 Idempotency: a converted track re-syncs to a no-op (add and re-sync share the seam) — covered by a deterministic test
- [x] #6 upgrades.test.ts reworked to the new model; cap-up/source-improved/policy cases removed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented slice 2 (re-sync device-bound through the shared seam; policy machinery deleted). No deprecation, no commits.

Wired (core):
- `classifyLossyDeviceBound` (upgrades.ts) reshaped to call `resolveLossyReduction` with the device-side contract: `sourceBitrate` = the device's RECORDED sync-tag bitrate (the sole quality truth, deterministic), `deviceNative: true`, `cap` = `target.presetBitrate`, `axis` = `target.axis ?? 'convert'`, and `tolerance: 0` (EXACT). `{copy}` → null (in sync / no-op); `{transcode,bitrate}` → a down-only `cap-down`. The function no longer reads the source track at all (dropped the `source` param) — a degraded/re-ripped source is content-change, not a device-bound quality move.
- `QualityTarget` gained `axis?: ReductionAxis` (resolved in `qualityTargetFromConfig` via `resolveReductionAxis('auto', config.transferMode)` — the slice-3 `[bitrate].reduce` injection seam is marked there) and lost `toleranceUp`/`toleranceDown`.
- `classifyDeviceBound`/`computeDeviceBound` merged (gate removed), `classifySourceBound`/`computeSourceBound` merged.

Deleted (core): `BITRATE_SYNC_MODES`, `type BitrateSyncMode`, `applyBitrateSyncPolicy`, `gateChange`; the lossy `encoding-mismatch` branch; the `source-improved` source-bound block (+ `MIN_BITRATE_INCREASE_KBPS`/`MIN_BITRATE_MULTIPLIER`); `bitrate-sync-policy.test.ts`. `index.ts` drops `applyBitrateSyncPolicy`/`BITRATE_SYNC_MODES`/`BitrateSyncMode`. `mock-core.ts` drops the mirrored `BITRATE_SYNC_MODES`/`applyBitrateSyncPolicy`.

Handler: dropped `policy:`/`bitrateSync` threading into the classify calls and the dead source-improved over-cap suppression in `detectSourceQualityChange`; `resolveUpgradeAction` narrowed to `cap-down`/`cap-up` (the dead lossy `encoding-mismatch`/`source-down-suppressed` cases removed; `cap-up` kept because the adoption pass still emits it). Report-only plumbing (`reportOnlyQualityChanges`, `reEncodes:false`) kept per spec.

Config: `bitrateSync` field retyped `string` (orphaned, unconsumed) — slice 3 removes the field; `toleranceUp/Down/bitrateTolerance` input fields left untouched (slice 3 / config surface).

DEVIATION (AC#2): `cap-up` is RETAINED in the union. ADR-023 removes only the LOSSY cap-up; the LOSSLESS device-bound (a lossless source re-encoded up to a higher preset, and the ALAC upgrade) legitimately still produces `cap-up`, so per the "prune only once nothing emits them" guard it stays. The substantive AC — no lossy up-encode, `classifySourceBound` emits no upward re-encode, `source-improved` gone — is met.

`source-down-suppressed` retained as a reserved report-only reason (like `format-mismatch`); the audio classifier no longer emits it in this slice — the below-raised-cap surfacing that repopulates it is slice 4.

CLITRANSITIONAL SHIM (outside core): the demo build transitively builds the `podkit` CLI, which imported the deleted `BITRATE_SYNC_MODES`/`BitrateSyncMode` from `@podkit/core`. To keep the core+demo gate green without implementing slice 3, those two symbols were re-homed locally into `packages/podkit-cli/src/config/types.ts` (the CLI surface `--bitrate-sync`/`[bitrate].sync` is unchanged); import sites in `resolve.ts`, `sync.ts`, `sync-presenter.ts` repointed off `@podkit/core`. Slice 3 removes this surface.

Reasons remaining in `QualityChangeReason`: `format-mismatch` (reserved), `encoding-mismatch` (lossless only), `lossless-boundary`, `cap-down`, `cap-up`, `source-down-suppressed` (reserved report-only). Lossless paths (lossless-boundary both directions, lossless encoding-mismatch, ALAC cap-up, sync-tag-exact) verified still firing via the reworked tests.

Gates: `bun run test:unit --filter @podkit/core` → 3355 pass / 0 fail. `bunx turbo run lint typecheck build --filter @podkit/core --filter @podkit/demo` → 15/15 clean. CLI unit suite (`--filter podkit`) → 1915 pass / 0 fail.

Team-lead review pass (post-worker): applied 4 fixes. (a) Zero recorded-bitrate guard — `classifyLossyDeviceBound` changed `encoded === undefined` to `!encoded` so a corrupt/third-party `bitrate=0` sync tag opts out instead of throwing in the seam; added a regression test. (b) Removed a task-ID slug ('437.08-class') from a docstring (code-agnostic-to-tasks rule). (c) Corrected the misleading 'single seam' axis comment in `qualityTargetFromConfig` — there are TWO hardcoded `resolveReductionAxis('auto', ...)` sites (here + classifier add path); both must move together in slice 3 or add/re-sync could disagree. (d) Marked the dormant `reEncodes:false` report-only branches in the handler as intentionally unreached pending the report-only surfacing slice (visible-deferred, not silently dead).

AC#2 clarification: only the LOSSY cap-up is removed. The lossless device-bound (lossless source → higher preset, ALAC upgrade) legitimately still emits `cap-up` — re-encoding a lossless source up loses no quality, per ADR-023 §3 ('lossless source → transcode to the preset') and the supersession map ('Removed: lossy cap-up'). `source-improved`-as-upward-re-encode is fully gone. Checked AC#2 on that basis.

DEFERRED to the report-only surfacing slice (slice 4) — flagged for its brief: `source-down-suppressed` is currently RESERVED/unproduced. The old `classifyLossyDeviceBound` produced it; the seam reshape dropped it (the seam only compares device-recorded vs cap). The bad-re-rip safety (keep the better device copy, report it — user story 12) must be re-homed as a source-vs-device check, alongside the below-raised-cap report.

KNOWN EDGE (non-blocking, flag for slice 4/6): a lossless device copy (ALAC, no bitrate in tag) against a now-lossy source + lossy target routes to the lossy device-bound and returns null (no recorded bitrate), so the `lossless-boundary` DOWN re-encode is skipped. Reachable only via an externally-imported ALAC whose source has always been lossy; mitigated by content-change (hash) detection. Left for a follow-up decision.
<!-- SECTION:NOTES:END -->
