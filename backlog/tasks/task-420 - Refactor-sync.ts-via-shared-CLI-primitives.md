---
id: TASK-420
title: Refactor sync.ts via shared CLI primitives
status: Done
assignee: []
created_date: '2026-06-11 15:19'
updated_date: '2026-06-12 08:08'
labels:
  - tech-debt
  - refactor
  - cli
  - sync
dependencies:
  - TASK-345
references:
  - packages/podkit-cli/src/commands/sync.ts
  - packages/podkit-cli/src/commands/sync-presenter.ts
  - packages/podkit-cli/src/commands/music-presenter.ts
  - packages/podkit-cli/src/commands/video-presenter.ts
ordinal: 135000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sibling task to TASK-345. Sync.ts is 1658 LoC and shares the same archetype (mixed parsing / orchestration / JSON envelope / rendering) but with its own preserved state (decisions, transforms, plan, warnings). Bundling it into TASK-345 risks the original "split-oversized" framing the maintainer rejected.

Pick this up **after** TASK-345 PR 2 lands so the primitives are available.

## Goals

1. Consume the primitives landed by TASK-345:
   - `utils/shell.ts` (`shellQuote`)
   - `commands/resolvers/content-paths.ts` (`resolveDeviceContentPaths`)
   - Any new `OutputContext.progress` API if TASK-345.C ships first
2. Extract JSON envelopes (`SyncOutput`, `ErrorInfo`, `WarningInfo`, `ScanWarningInfo`, `TransformInfo`, `UpdateBreakdown`, `VideoSummary` from `sync.ts:155-249`) into `commands/sync-output-types.ts`.
3. Move inline render into the existing `commands/sync-presenter.ts` (already class-based — extend, don't fork).
4. Identify sync-specific triplications (likely: scan-warning rendering, transform-warning rendering, error-table rendering) and extract `commands/sync-warnings-render.ts` if a fourth caller surfaces or duplication is severe.

## Constraints

- sync-presenter.ts is already 750+ LoC; if it grows past ~1000 LoC, split it (probably by content-type — music vs video presenter render).
- `sync.test.ts` is the behaviour gate; line-for-line text output unchanged before/after.

## Acceptance Criteria
<!-- AC:BEGIN -->
Listed below.
<!-- SECTION:DESCRIPTION:END -->

- [x] #1 commands/sync-output-types.ts owns SyncOutput / ErrorInfo / WarningInfo / ScanWarningInfo / TransformInfo / UpdateBreakdown / VideoSummary
- [x] #2 Inline render code in sync.ts moves into sync-presenter.ts (or a new sync-warnings-render.ts if presenter grows past ~1000 LoC)
- [ ] #3 sync.ts consumes utils/shell.ts shellQuote where it currently composes command suggestions
- [ ] #4 sync.ts consumes resolveDeviceContentPaths if it has its own content-paths resolution
- [x] #5 Sync-specific triplications identified and extracted; document any not extracted in implementation notes with rationale
- [x] #6 sync.test.ts text output is line-for-line unchanged before/after refactor
- [x] #7 bun run typecheck / bun run test / bun run lint all pass
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
5 of 7 ACs met directly. ACs #3 (`shellQuote`) and #4 (`resolveDeviceContentPaths`) verified not-applicable: sync.ts doesn't compose user-input-interpolated shell suggestions and doesn't have its own content-paths resolution (it reads `openResult.contentPaths` already resolved by `openDevice` upstream).

## Changes

**`packages/podkit-cli/src/commands/sync-output-types.ts`** (NEW): pure type module owning `SyncOutput`, `ErrorInfo`, `WarningInfo`, `ScanWarningInfo`, `TransformInfo`, `UpdateBreakdown`, `VideoSummary`. ~210 LoC moved out of `sync.ts`. The types are imported back into `sync.ts` (used internally) AND re-exported via `export type {...} from './sync-output-types.js'` so consumers (`types.ts` test surface, `music-presenter.ts`, `video-presenter.ts`) keep their `from './sync.js'` imports working.

**`packages/podkit-cli/src/commands/sync-summary-render.ts`** (NEW): orchestrator-level helpers `printInterruptedSummary` + `printSuccessSummary` + private `printExecuteWarnings`. Lives separately from `sync-presenter.ts` because `MusicPresenter` / `VideoPresenter` implement the polymorphic per-collection `ContentTypePresenter` contract; the summary block is one-shot orchestrator-level — different abstraction.

**`packages/podkit-cli/src/commands/sync-summary-render.test.ts`** (NEW): 15 tests pinning interrupted/success summary shape, totals copy, warnings grouping by type, verbose-mode expansion (single-track / multi-track / empty-tracks hints), non-verbose "(re-run with -v for details)" nudge, plan-phase warning filtering, dry-run no-op.

**`packages/podkit-cli/src/commands/sync.ts`**: inline summary blocks (~50 LoC) replaced with helper calls. Unused `formatNumber` import dropped.

## ACs explicitly N/A

- **#3 shellQuote consumer**: sync.ts's only `podkit doctor --repair X` suggestions use fixed strings — no user-input interpolation that would need shell escaping. Verified by grep.
- **#4 resolveDeviceContentPaths**: sync.ts reads `openResult.contentPaths`, which `openDevice` already resolved via the PR-1 helper. No duplicate cascade in sync.ts.

## Deferred (documented)

The music + video collection loops (~40 LoC each) duplicate the "create config / call genericSyncCollection / accumulate totals / handle interrupt" pattern. Extracting requires threading a presenter-specific config builder closure, which adds noise to the call site and obscures the music-vs-video distinction (music has extra `artworkMissingBaseline` + `transferModeMismatch` accumulators). The duplication is real but the abstraction cost exceeds the benefit at the current shape — leaving inline.

The local `formatPreambleBytes` (sync.ts) is another mini `formatBytes` duplicate. Used at exactly one call site; replacing with canonical `formatBytes` could shift output text (`1023 B` → `1023.0 B`). Skipped to avoid snapshot drift risk — separately addressable.

## Verification

- `bun run typecheck` — clean monorepo-wide
- `bun run lint` — 0 warnings, 0 errors (948 files)
- `bun run test:unit` — pass
- `bun run test:integration` — 69 pass, 0 fail
- Sonnet review:
  - Behaviour-equivalence confirmed (the `else if (executeWarnings.length > 0)` guard in the original was redundant — code already returned early for the empty case — and is correctly collapsed to `else` in the helper).
  - Soft circular import `sync.ts ↔ sync-summary-render.ts` (via `formatDuration`) broken by importing `formatDurationSeconds` directly from `output/index.js`.
  - Re-export strategy complete; all 10 `from './sync.js'` consumers continue to resolve.

## Net

- `sync.ts`: 1464 → 1416 LoC (~50 LoC out)
- 2 new modules + 1 new test file
- Convention §2a (TASK-421) already in place — no progress writes touched here, but sync.ts had none to begin with.
<!-- SECTION:FINAL_SUMMARY:END -->
