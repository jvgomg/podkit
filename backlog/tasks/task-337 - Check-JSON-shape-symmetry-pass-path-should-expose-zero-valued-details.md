---
id: TASK-337
title: 'Check JSON shape symmetry: pass-path should expose zero-valued details'
status: To Do
assignee: []
created_date: '2026-05-15 22:16'
labels:
  - doctor
  - diagnostics
  - json-shape
milestone: m-19
dependencies:
  - TASK-304
  - TASK-305
  - TASK-306
priority: low
ordinal: 22500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surfaced in parallel by three Phase-5d workers (TASK-304, 305, 306). The pass path on three device-scope checks returns no `details` object, so JSON consumers expecting `details.orphanCount === 0` see `undefined` instead. Warn/fail paths populate `details`; pass should too.

## Anchors

- `packages/podkit-core/src/diagnostics/checks/orphans.ts:130-136` — pass-path returns no details
- `packages/podkit-core/src/diagnostics/checks/orphans-mass-storage.ts:244-250` — same pattern
- `packages/podkit-core/src/diagnostics/checks/artwork.ts:42-48` — pass + "no ArtworkDB" path

## Fix

Each affected check's pass branch returns the canonical zero-valued details object that matches its warn/fail shape:
- orphan-files / orphan-files-mass-storage: `{ orphanCount: 0, wastedBytes: 0, orphans: [] }`
- artwork: `{ totalEntries, corruptEntries: 0, healthyEntries: <total>, corruptPercent: 0 }` (where `totalEntries` is read from ArtworkDB if present, else 0)

## Test updates

Each check's matrix test (`orphans-matrix.test.ts`, `orphans-mass-storage-matrix.test.ts`, `artwork-matrix.test.ts`) currently pins the current behaviour (`details === undefined` on pass). Update those assertions to the new zero-valued shape once the check change lands.

## Out of scope

- Restructuring the diagnostics framework to make pass-details mandatory across all checks — this is a per-check fix.
- Other consumers (the human-readable text output) — they already handle the missing-details case fine; the gap is JSON-only.

Tiny scope, but it removes an asymmetry that bites every JSON consumer of these specific checks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 orphans.ts pass branch returns details.{orphanCount: 0, wastedBytes: 0, orphans: []}
- [ ] #2 orphans-mass-storage.ts pass branch returns the same shape
- [ ] #3 artwork.ts pass branch returns details.{totalEntries, corruptEntries: 0, healthyEntries, corruptPercent: 0}
- [ ] #4 TASK-304/305/306 matrix tests' pass-path assertions updated from `details === undefined` to the zero-valued shape
- [ ] #5 No regressions in the human-readable text output (the renderer should already tolerate either present-with-zeros or absent details)
<!-- AC:END -->
