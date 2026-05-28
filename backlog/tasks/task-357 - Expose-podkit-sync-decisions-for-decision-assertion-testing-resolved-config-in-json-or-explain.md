---
id: TASK-357
title: >-
  Expose podkit sync decisions for decision-assertion testing (resolved config
  in --json or --explain)
status: To Do
assignee: []
created_date: '2026-05-28 08:01'
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
- [ ] #1 PRD written choosing the exposure mechanism (JSON block vs sync-tag reader vs --explain) and the decision schema
- [ ] #2 podkit exposes resolved transfer mode + resolved codecs + per-track classification machine-readably
- [ ] #3 A test helper can read those decisions for a given sync
- [ ] #4 doc-039 updated to point the decision-assertion phase at the chosen mechanism
<!-- AC:END -->
