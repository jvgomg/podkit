---
id: TASK-358.03
title: >-
  prefer-copy (quality=max) never converges on mass-storage (preset-upgrade
  loop)
status: To Do
assignee: []
created_date: '2026-05-28 21:13'
labels:
  - bug
  - mass-storage
  - sync
dependencies: []
references:
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
  - packages/podkit-core/src/metadata/sync-tags.ts
  - packages/podkit-core/src/sync/music/classifier.ts
  - test-packages/e2e-tests/src/features/preset-change.test.ts
parent_task_id: TASK-358
priority: medium
ordinal: 76000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
With `quality = "max"` + lossless stack `["source"]` (the "prefer-copy" pipeline) on a mass-storage device, the second sync re-fires `upgrade-transcode` with reason `preset-upgrade` for several tracks — the sync never converges. The sync tag written on the first pass does not match what the planner expects on the second pass, so it re-plans preset upgrades indefinitely.

This is a quality/preset-convergence defect, **not** an artwork one, so the artwork matrix does not catch it (it asserts artwork idempotency, which is unaffected). It is currently **uncaught by any test**: `preset-change.test.ts` exercises preset-change convergence on iPod only. A mass-storage arm of that test (or a dedicated preset-convergence matrix) would catch it and guard the fix.

Repro: sync the multi-format (or goldberg) fixture to a `type = "generic"` temp device with `quality = "max"` and `[codec] lossless = ["source"]`; dry-run again and observe `upgrade-transcode:preset-upgrade` ops.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A mass-storage sync at quality=max converges: the second sync plans no preset-upgrade
- [ ] #2 Root cause identified in sync-tag write/read or preset resolution on mass-storage and fixed
- [ ] #3 A regression test covers mass-storage preset-change convergence (extend preset-change.test.ts to mass-storage, or add a preset matrix)
<!-- AC:END -->
