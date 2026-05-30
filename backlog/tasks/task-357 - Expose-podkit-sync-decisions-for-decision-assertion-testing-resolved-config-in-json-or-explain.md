---
id: TASK-357
title: >-
  Expose podkit sync decisions for decision-assertion testing (resolved config
  in --json or --explain)
status: Done
assignee: []
created_date: '2026-05-28 08:01'
updated_date: '2026-05-30 22:45'
labels:
  - prd
  - cli
  - json
  - testing
  - sync-planner
dependencies: []
references:
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
  - backlog/docs/doc-014 - Spec-Operation-Types-Sync-Tags.md
priority: low
ordinal: 72000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Prerequisite capability for the "decision assertions" dimension of the e2e matrix strategy (doc-039 §"Two assertion dimensions", phase 6). Tracked separately from TASK-356 because it requires a podkit change, not test code.

## Problem

The matrix can today assert *outcomes* (did the right bytes/metadata land?) but not *decisions* (did podkit make the right choice given the inputs?). Example the user wants: "given device D + codec config C and NO explicit transfer mode, did podkit auto-select transfer mode M?" and "did it pick direct-copy vs transcode for format F on device D?". podkit doesn't currently expose its resolved decisions in a machine-readable form.

## Options (doc-039, in rough effort order)

1. **Extend `--json` sync output** with a `resolved`/`decisions` block: chosen transfer mode, resolved lossy/lossless codec, per-track classification (action + reason). Cheapest; reuses the existing dry-run JSON path. Likely the first increment.
2. **Sync-tag inspection helper** — a test-side reader of the persisted `[podkit:v1 …]` comment tags (quality/codec/transfer); see doc-014. Partial helper exists in `artwork-sync-tags.test.ts`. Asserts decisions were *persisted* correctly.
3. **`podkit sync --explain` / plan-dump** — a dedicated machine-readable decision trace. Cleanest long-term, largest change.

## Definition

Write a short PRD (use the write-a-prd skill) choosing the increment and schema, then implement. The matrix harness already leaves a seam: `observe()` is designed to return a `decisions` block alongside outcomes (TASK-356.01 AC). Once this lands, a follow-up TASK-356 phase can add decision-assertion cells.

Blocks: the decision-assertion phase of TASK-356.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 PRD written choosing the exposure mechanism (JSON block vs sync-tag reader vs --explain) and the decision schema
- [x] #2 podkit exposes resolved transfer mode + resolved codecs + per-track classification machine-readably
- [x] #3 A test helper can read those decisions for a given sync
- [x] #4 doc-039 updated to point the decision-assertion phase at the chosen mechanism
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-05-30 (Claude / Opus 4.7): Landed in commit `b26aafcc` — "feat(sync): expose --json decisions block with provenance attribution". PRD: doc-040.

**Mechanism chosen (AC #1)**: Option 1 from the task description — extend `--json` output. Cheapest of the three options, reuses the dry-run JSON path, and the matrix harness's `diffCell` structural object-diffing already handles the `decisions` block with no harness changes. Forward-compatible with a future `--explain` (option 3) and with the sync-tag inspection helper (option 2); those remain follow-ups.

**Schema (AC #2 + AC #3)**

New top-level `decisions` field on `SyncOutput`:
- `transferMode`, `quality`, `lossyCodec`, `losslessCodec`, `lossyPreference`, `losslessPreference`, `checkArtwork` — each a `ResolvedDecision<T> = { value, source }`.
- `DecisionSource = ConfigSource | 'cli'` — extends `resolve.ts`'s existing union with the CLI-overlay layer attribution.
- Operations[] entries gain optional `inputCodec` and `outputCodec` (source-track codec → planner-resolved output codec). `upgrade-artwork` omits both — parallel to `update-metadata`.

The previous top-level `codec`, `codecPreference`, `transferMode`, `quality` fields are removed from `SyncOutput`. Only one JSON consumer (`test-packages/e2e-tests/src/matrix/codec-rules.ts:285`) read them; migrated to `json.decisions.lossyCodec.value`. No user-facing tooling consumed them.

The `decisions` block appears in BOTH the dry-run JSON path (built by music-presenter) AND the non-dry-run aggregate (captured per-collection inside the music loop and hoisted into the top-level emit at sync.ts:1276) — sonnet caught the original dry-run-only emit as a P1.

**Modules**

- New `packages/podkit-cli/src/commands/sync-decisions.ts` — deep module: defines types + pure `buildSyncDecisions(input)` + pure `codecsForOp(op, resolvedLossy)`. No I/O, fully unit-testable.
- `sync.ts` (commands) — builds the decisions block at MusicContentConfig construction time, threads through the presenter. Adds `losslessStack` lookup + normalises the 'source' sentinel to null for `losslessCodec.value`.
- `sync-presenter.ts` — `MusicContentConfig.decisions?: SyncDecisions`.
- `music-presenter.ts` — emits `decisions: config.decisions` in JSON; populates per-op `inputCodec`/`outputCodec` via `codecsForOp`.

**Coverage**

- `sync-decisions.test.ts` (NEW, 15 unit tests over the pure functions):
  - CLI flag wins over resolved config.
  - Absent CLI flag carries through resolved attribution.
  - `audioQuality` CLI takes priority over generic `quality`.
  - **Explicit `--no-check-artwork` is distinguishable from absent flag** (the `!== undefined` trap).
  - `codecPreferenceFromConfig` boolean correctly flips lossy/lossless preference source.
  - `losslessCodec` defaults to null when undefined input.
  - `losslessCodec` preserves null when caller normalises 'source' sentinel.
  - Per-op codec derivation for every op type (transcode/copy/optimized-copy/upgrade variants/no-codec ops).
- Existing matrix tests (`codec-rules.ts` consumer migration) green.

**Sonnet review caught and fixed**

1. **P1**: `losslessCodec.value` emitted `'source'` string instead of `null` when the default lossless stack `['source', 'flac', 'alac']` was used — `losslessStack[0]` is `'source'`. Now `sync.ts` normalises the sentinel to null before passing to `buildSyncDecisions`; the preference array itself keeps `'source'` for ordering assertions.
2. **P1**: `decisions` only appeared in the dry-run JSON path; the non-dry-run aggregate emit at `sync.ts:1276` omitted it entirely. Captured per-collection `lastDecisions` and included it.
3. **P2**: `codecPreferenceFromConfig` used `.length` so `[codec] lossy = []` in config (user explicitly suppressing defaults) was misattributed as `'default'`. Now checks key presence with `!== undefined`.
4. **P3**: `upgrade-artwork` emitted only `inputCodec` (no matching `outputCodec`) — visually inconsistent. Now omits both.

**doc-039 update (AC #4)**

§ "Two assertion dimensions" updated to point at the landed mechanism (`json.decisions.*`) and the in-operation `inputCodec`/`outputCodec` fields. Cross-references PRD doc-040.

**Out of scope (follow-ups)**

- `'auto'` source attribution — when the planner picks a transfer mode based on device capabilities. Not introduced because no callers need it yet (the resolver already distinguishes config-vs-default, which is enough for current matrix needs).
- `podkit sync --explain` — the dedicated decision-trace mode. Schema in this PRD is forward-compatible.
- Sync-tag inspection helper (asserts decisions were *persisted* correctly, not *made* correctly). Different concern.
- Video decisions (`videoTransferMode`, `videoQuality`). Slot reserved in the schema; no implementation needed in this increment.
- Adding decision-assertion *cells* to the matrix — that's the TASK-356 follow-up phase. The mechanism is in place.

**Gates**

typecheck (all), oxlint (touched files), unit (1336 + 68 across podkit-cli + others), integration (69), e2e non-docker (31 / 0), e2e docker (5 / 0) — all green on macOS.
<!-- SECTION:NOTES:END -->
