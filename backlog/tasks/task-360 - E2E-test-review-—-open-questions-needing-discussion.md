---
id: TASK-360
title: E2E test review — open questions needing discussion
status: Done
assignee: []
created_date: '2026-05-28 21:27'
updated_date: '2026-06-11 07:43'
labels:
  - testing
  - e2e
  - needs-discussion
dependencies: []
references:
  - agents/testing.md
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
priority: medium
ordinal: 78000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
During TASK-356.04 we reviewed every non-matrix e2e test for captured bugs and assertion quality. This umbrella collects the findings that surfaced **podkit behaviours with design uncertainty** — places where a test froze a limitation or surprising behaviour, but the *right* fix needs a product/design decision before a developer can act. These are for collaboration, not immediate implementation.

Subtasks are status "Draft" = not ready to implement; each needs a decision on intended behaviour first. Once resolved, promote to "To Do" (and likely move the fix into the relevant package, plus tighten the e2e test that froze the old behaviour).
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Umbrella closed. All 5 subtasks resolved with the design decisions made + landed in main:

- **TASK-360.01** (commit `2331c7c7`) — Doctor's non-repair path is read-only. Verified by hash-stability tests; tightened assertions; documented in `documents/architecture/conventions.md` §10.
- **TASK-360.02** (commit `2a644afa`) — Artwork-hash baseline was already written on initial add via `transfer.ts`. Pinned the contract with tests; removed stale docker workaround.
- **TASK-360.03** (commit `2a644afa`) — Closed a latent **infinite-loop bug** in the quality-upgrade path (`transferUpgradeToIpod` was writing undefined bitrate on direct-copy upgrades, so the same upgrade re-fired every sync forever). Added `--force-sync-tags` bitrate backfill. New architecture doc `sync/upgrades.md`.
- **TASK-360.04** (commit `59726b1f`) — `podkit device add` refuses fully-empty identity by default; `--force` flag added. Partial-cascade warning narrowed after reviewer feedback.
- **TASK-360.05** (commit `785ad57a`) — Per-track source-file validity probe before album cache. Corrupt files get deterministic bucket + structured reason in doctor JSON.

Three changesets filed (patch + patch + minor). All 4 test suites green: `bun run test`, `test:e2e`, `test:e2e:docker`, `test:vm` — 3142 unit + 33 e2e + 5 docker-e2e + 184 vm tests pass.

Filed **TASK-419** to extend TASK-360.03 to bidirectional quality-change (cap-lowering downgrade with `[devices.<name>.bitrate].sync` config + `--bitrate-sync` CLI override).

Filed draft-009 (Subsonic placeholder heuristic) as WAI in the archive.
<!-- SECTION:FINAL_SUMMARY:END -->
