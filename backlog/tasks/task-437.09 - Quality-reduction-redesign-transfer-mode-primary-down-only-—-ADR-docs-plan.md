---
id: TASK-437.09
title: Quality reduction redesign — ADR-023 + principles + PRD (design & planning)
status: Done
assignee: []
created_date: '2026-06-29 17:03'
updated_date: '2026-06-30 16:53'
labels:
  - sync
  - transcoding
  - quality
  - design
  - planning
dependencies: []
references:
  - >-
    backlog/docs/doc-051 -
    Bidirectional-quality-change-extend-cap-enforcement-to-lossy-unify-the-quality-classifier.md
  - adr/adr-010-quality-preset-redesign.md
  - adr/adr-022-sync-tag-sole-quality-truth.md
  - backlog/docs/doc-011 - PRD-Transfer-Mode.md
  - backlog/docs/doc-012 - Spec-Transfer-Mode-Behavior-Matrix.md
  - backlog/docs/doc-036 - Codec-and-Container-Design-Principles.md
  - documents/architecture/sync/upgrades.md
  - packages/podkit-core/src/sync/music/classifier.ts
  - packages/podkit-core/src/sync/engine/upgrades.ts
  - test-packages/e2e-tests/src/matrix/codec-rules.ts
  - adr/adr-023-lossy-reduction-down-only.md
  - documents/principles/README.md
parent_task_id: TASK-437
priority: high
ordinal: 203000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Design + planning task (complete).** Produced the ADR, the new principles docs, and the implementation PRD; the implementation itself is TASK-453 + subtasks.

**Outcome / thesis reversal:** this task opened proposing "transfer-mode-primary" (transfer mode decides whether reduction happens). Design review (a grilling pass with the user) **reversed** that: transfer mode stays the metadata/artwork axis (doc-011/012) and lossy reduction is a **separate, user-overridable axis** for which transfer mode supplies only the default. Down-only; the quality preset is a hard ceiling; a single percentage source-proximity tolerance (drift is exact); codec efficiency confined to the preserve cross-codec case; no standalone CBR/VBR re-encode on lossy. Recorded as **ADR-023**.

Implementation is planned as **TASK-453** (main) + **TASK-453.01–.07** (green-first slices), per **PRD doc-055**.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Problem fully understood; root cause and supersession confirmed; the 'transfer-mode-primary' thesis was reversed in design review (transfer mode stays the metadata axis and sets the reduction default)
- [x] #2 ADR-023 written (adr/adr-023-lossy-reduction-down-only.md) and added to the ADR index
- [x] #3 Principles category created: documents/principles/ (README + library-safety + transfer-modes + transcoding)
- [x] #4 PRD doc-055 written (problem/solution, 23 user stories, deep-module design, full removal/refactor code+test inventory, test plan, green-first slice order)
- [x] #5 Implementation planned as TASK-453 (main) + 7 subtasks (453.01–.07); adding the codec matrix to the e2e gate is captured in 453.06
- [x] #6 Redundant superseded epic subtasks archived (437.03 cap-up; 437.05 bitrate.sync policy)
- [x] #7 User + architecture doc rewrites delegated to TASK-453.07 so they land with the code (never describing unbuilt behaviour)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Design & planning complete. Reversed the task's own "transfer-mode-primary" thesis after a grilling pass: the model is now two orthogonal axes — transfer mode (metadata/artwork, unchanged from doc-011/012) and an independent, user-overridable lossy-reduction axis (`[bitrate].reduce = auto|always|never`) that transfer mode only defaults. Down-only, cap-as-hard-ceiling, one percentage source-proximity tolerance (drift exact), codec-efficiency confined to preserve cross-codec, no standalone lossy CBR/VBR re-encode. Deliverables: ADR-023 (+ index), the new documents/principles/ tree (README, library-safety, transfer-modes, transcoding), and PRD doc-055 with the full removal/refactor inventory and a green-first slice plan. Implementation tracked under TASK-453 (+ 453.01–.07). Archived the genuinely-redundant superseded subtasks (437.03 cap-up, 437.05 bitrate.sync policy); 437.06/437.08 kept as history (reshaped, not removed). Branch feat/quality-change-bidirectional stays RED until TASK-453 lands.
<!-- SECTION:FINAL_SUMMARY:END -->
