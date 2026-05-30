---
id: doc-040
title: PRD — Expose sync decisions in --json (TASK-357)
type: specification
created_date: '2026-05-30 22:21'
tags:
  - prd
  - cli
  - json
  - testing
  - sync-planner
  - task-357
---
## Problem Statement

The e2e matrix can today assert **outcomes** — did the right bytes/metadata land on the device? — but not **decisions**: did podkit make the right *choice* given the inputs?

Concrete examples the matrix needs:

- *"Given device D and codec config C and **no explicit** `--transfer-mode`, did podkit auto-select transfer mode M?"*
- *"For format F on device D under quality preset Q, did podkit pick `direct-copy` vs `transcode` — and if transcode, to which output codec?"*
- *"Was the lossy codec resolved from a CLI flag, a config setting, or the hardcoded default?"*

Today's `--json` surfaces some of this — top-level `codec`, `transferMode`, `codecPreference`, `quality` strings, plus per-operation `type` and `reason` — but with no attribution. Tests can't distinguish "user pinned this" from "podkit chose this". The matrix's `codec-rules.ts` reads `json.codec` as a first slice of decision assertion; the rest of the decision surface needs podkit changes.

This blocks the **decision-assertion** phase of TASK-356 (the matrix testing strategy in doc-039 §"Two assertion dimensions").

## Solution

Extend the `--json` sync output with a structured `decisions` block that surfaces each resolved sync-wide setting with **provenance attribution** (CLI / device-config / global-config / quality-inherited / default), and extend each per-operation entry with the resolved **inputCodec → outputCodec** mapping the planner chose.

The existing top-level decision fields (`codec`, `codecPreference`, `transferMode`, `quality`) are removed in favour of the new `decisions` block — only one JSON consumer (`matrix/codec-rules.ts:285`) reads them today, so the migration cost is bounded.

Per-track decisions ride on the existing `operations[]` array rather than a parallel structure — keeps the JSON one-pass-traversable and avoids the per-track key duplication a separate array would impose.

Composition with later increments: the schema is designed so a future `--explain` mode (richer machine-readable decision trace) can layer on without breaking matrix consumers; the per-track entries can grow additional fields (artwork hash decisions, normalisation source, etc.) without churn.

## User Stories

1. As a matrix-test author, I want to assert "podkit resolved `transferMode` to `fast` from the CLI flag" so I can pin auto-selection logic separately from user-override logic.
2. As a matrix-test author, I want to assert "the lossy codec was resolved from the device config (not the global default)" so a regression in config-inheritance order surfaces immediately.
3. As a matrix-test author, I want to read each operation's resolved `outputCodec` so I can assert the codec choice independently of the action type (transcode-to-AAC vs transcode-to-Opus is the same `add-transcode` op type today).
4. As a matrix-test author, I want the `decisions` block to be a structurally-comparable object so the harness's existing `diffCell` machinery (TASK-356.01 AC #4) diffs it cell-for-cell with zero new tooling.
5. As a downstream JSON consumer, I want a single canonical location for each resolved setting so I never have to guess whether the value at the top level was the resolved value or the user-supplied value.
6. As a podkit maintainer, I want each provenance source to be a well-defined enum value (already drawn from `ConfigSource` in `resolve.ts`) so the schema is stable as new config dimensions are added.
7. As a podkit maintainer, I want the new schema to be the *only* representation of decisions in `--json` so we don't ship two parallel sources of truth.
8. As a user running `podkit sync --json` for tooling, I want the decision provenance visible so I can diagnose unexpected behaviour ("why did this sync transcode to Opus?") from the JSON output alone.
9. As a matrix-test author, I want per-operation `inputCodec` set even for `direct-copy` ops so I can sanity-check that the input codec genuinely matched device-native (the reason no transcode fired).
10. As a future implementor of `podkit sync --explain`, I want today's `decisions` block to be a forward-compatible subset of whatever `--explain` produces so the matrix doesn't have to migrate twice.
11. As a podkit user, I want `--check-artwork`'s effective state surfaced in `decisions` so the no-detection warning (TASK-366) and the actual resolved boolean stay aligned.
12. As a future video-decision consumer, I want the schema to leave room for `videoCodec` / `videoQuality` decisions to slot in alongside the music ones without a structural change.

## Implementation Decisions

### Schema shape

- New top-level field: `decisions` on `SyncOutput`, containing one `ResolvedDecision<T>` per setting.
- `ResolvedDecision<T> = { value: T; source: DecisionSource }` — reuses the existing `ResolvedValue` pattern from `resolve.ts` and ships under a new test-stable name so the JSON shape is decoupled from the config-resolver type.
- `DecisionSource` extends the existing `ConfigSource` union with `'cli'` to capture command-line flag overrides; `'auto'` is reserved for future planner-driven choices but not introduced in this increment (no callers need it yet).

### Settings exposed in `decisions`

- `transferMode`, `quality` — direct mirrors of the resolved-config values.
- `lossyCodec`, `losslessCodec` — the resolved single-codec choices the executor will use.
- `lossyPreference`, `losslessPreference` — the full preference stacks (for assertions about ordering / inheritance).
- `checkArtwork` — boolean attribution for the TASK-366 flag.

### Top-level field removal

- The existing top-level `codec`, `codecPreference`, `transferMode`, `quality` fields on `SyncOutput` are removed. The single consumer (`matrix/codec-rules.ts:285`) migrates to `json.decisions.lossyCodec.value`. No test fixtures or production callers besides the matrix read these; the migration is contained.

### Per-operation decisions

- Each entry of `operations[]` gains optional `inputCodec` and `outputCodec` fields (string codec names — `flac`, `aac`, `opus`, etc.).
- `inputCodec` is set from the source track's codec for every op type that has one (add/upgrade variants).
- `outputCodec` is set from the planner's resolved output codec for the same op types; for `remove` / `update-metadata` / `update-sync-tag` / `relocate` it stays undefined.
- The existing `reason` field on operations is unchanged.

### Construction site

- `music-presenter.ts` builds the `decisions` block from the already-resolved `MusicContentConfig` (it already has `resolvedLossyCodec`, `effectiveTransferMode`, etc.). The provenance source is captured by piping the existing `ResolvedDeviceSettings` (`resolve.ts`) through the presenter, plus tracking whether each setting came from a CLI flag in `sync.ts`.
- `video-presenter.ts` does not populate `decisions` in this increment (video doesn't currently emit codec/transferMode at top level either).

### Config source extension

- `resolve.ts` `ConfigSource` gains `'cli'`. The resolve functions stay unchanged — `'cli'` attribution is layered in `sync.ts` when CLI options override the resolved value, before the presenter sees it.

### Backward compatibility

- The top-level field removal is the only breaking change. It is documented in the commit message and the changeset. Since the only consumer is internal (matrix tests), no user-facing breakage.

## Testing Decisions

### What makes a good test for this feature

- **Test observable JSON shape, not internal data flow.** Run `podkit sync --json --dry-run` (or call the presenter directly) and assert against the JSON output.
- **Assert attribution, not just values.** A test that only checks `decisions.transferMode.value === 'fast'` regresses to outcome-assertion. The point is `source: 'cli'` vs `source: 'config'` etc.
- **Test the CLI override layer.** Most attribution logic lives there; the resolver tests already cover the inheritance chain.

### Modules tested

- **music-presenter** (unit): given a resolved config + CLI-override flags, builds the correct `decisions` block. Sweep over (transferMode CLI / config / default) × (codec CLI / config / default).
- **resolve.ts** (existing tests, updated): the new `'cli'` source enum value is accepted in switch/exhaustiveness checks.
- **sync.ts** CLI override path (integration): a sync invocation with `--transfer-mode fast` produces `decisions.transferMode.source === 'cli'`; without the flag, source is `'default'` or `'config'`.
- **matrix harness** (cell-for-cell parity): `codec-rules.ts` switches from `json.codec` to `json.decisions.lossyCodec.value` and all existing matrix cells stay green.

### Prior art

- `packages/podkit-cli/src/config/resolve.test.ts` — existing ResolvedValue / ConfigSource test patterns. The new `'cli'` source extension follows the same shape.
- `packages/podkit-cli/src/commands/music-presenter.ts` — existing JSON-construction code. Test pattern: build a minimal context, invoke the JSON builder, assert object shape.
- `test-packages/e2e-tests/src/matrix/codec-rules.ts` — the consumer migration. Update plus run the existing codec matrix to verify no behaviour change.

## Out of Scope

- **`'auto'` source attribution.** When the planner picks a transfer mode based on device capabilities (rather than user/config), it currently doesn't expose that choice. This first increment uses the existing CLI-vs-config-vs-default sources only; auto-attribution is a follow-up if needed.
- **`podkit sync --explain` command.** Option 3 from the task description — a dedicated decision-trace mode. Tracked separately; the schema in this PRD is forward-compatible with whatever shape `--explain` adopts.
- **Sync-tag inspection helper.** Option 2 from the task description — a test-side reader for the persisted `[podkit:v1 ...]` comment tags. Different concern (asserts decisions were *persisted* correctly, not *made* correctly). Partial helper already exists in `artwork-sync-tags.test.ts`.
- **Video decisions.** Video sync doesn't surface codec/transferMode at top level today. Slot is reserved in the schema (e.g. `decisions.videoTransferMode`) but no implementation work in this increment.
- **Decision-assertion matrix cells.** The matrix harness consumes the new `decisions` block via the existing `diffCell` seam, but adding new cells that assert specific provenance is a TASK-356 follow-up phase.

## Further Notes

- `doc-039` ("E2E Sync Matrix Testing Strategy") § "Two assertion dimensions" explicitly notes the harness's decisions seam (TASK-356.01 AC #4). This PRD's `decisions` block is the first concrete consumer of that seam. Update `doc-039` after landing to point the decision-assertion phase at this mechanism.
- The CLI override attribution layer is the trickiest piece — `sync.ts` currently does `options.transferMode ?? resolveDeviceSettings(...).transferMode.value`, which silently drops provenance. The fix wraps that pattern: if `options.transferMode` is set, emit `{ value: options.transferMode, source: 'cli' }`; otherwise pass the resolved value through.
- The schema follows the existing `ResolvedValue<T>` shape in `resolve.ts` for visual + structural consistency. We could rename to `ResolvedDecision` for JSON-stability semantics, but keeping the type literal under a different name in the JSON-facing layer keeps internal `resolve.ts` callers from accidentally depending on the JSON shape.
- Per-operation `inputCodec` / `outputCodec` are deliberately just codec name strings, not nested objects. The `reason` field on the operation captures the *why*; the codec fields capture the *what*. Future expansion (e.g. `inputArtworkSlots`, `outputArtworkSlots`) can add more `*Codec`-style flat fields without restructuring.
