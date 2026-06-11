---
id: TASK-420
title: Refactor sync.ts via shared CLI primitives
status: To Do
assignee: []
created_date: '2026-06-11 15:19'
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

- [ ] #1 commands/sync-output-types.ts owns SyncOutput / ErrorInfo / WarningInfo / ScanWarningInfo / TransformInfo / UpdateBreakdown / VideoSummary
- [ ] #2 Inline render code in sync.ts moves into sync-presenter.ts (or a new sync-warnings-render.ts if presenter grows past ~1000 LoC)
- [ ] #3 sync.ts consumes utils/shell.ts shellQuote where it currently composes command suggestions
- [ ] #4 sync.ts consumes resolveDeviceContentPaths if it has its own content-paths resolution
- [ ] #5 Sync-specific triplications identified and extracted; document any not extracted in implementation notes with rationale
- [ ] #6 sync.test.ts text output is line-for-line unchanged before/after refactor
- [ ] #7 bun run typecheck / bun run test / bun run lint all pass
<!-- AC:END -->
