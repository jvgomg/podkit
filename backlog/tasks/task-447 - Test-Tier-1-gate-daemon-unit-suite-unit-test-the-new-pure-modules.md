---
id: TASK-447
title: 'Test Tier 1: gate daemon unit suite + unit-test the new pure modules'
status: Done
assignee: []
created_date: '2026-06-27 19:05'
updated_date: '2026-07-07 22:56'
labels:
  - docker
  - daemon
  - testing
milestone: m-22
dependencies:
  - TASK-444
  - TASK-445
  - TASK-441
references:
  - backlog/docs/doc-053 - podkit-docker-testing-strategy.md
priority: high
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tier 1 of the docker testing strategy. The ~69 existing daemon unit tests run but are not gated in the quality pipeline (the daemon's `test` script is a no-op). Gate them, then add isolation tests for the new pure modules from doc-052: unknown-model sync guard, device-registry resolver, readiness classifier, mass-storage ENV mapper, container device-access probe.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Existing daemon unit suite runs and gates in `bun run quality`
- [x] #2 Unit tests added for: unknown-model guard, device-registry resolver, readiness classifier, mass-storage ENV mapper, device-access probe
- [x] #3 All five modules tested via external behavior (inputs -> outputs/typed errors), no implementation coupling
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#1 (gate daemon suite) — DONE / verified already satisfied. The premise ("daemon `test` script is a no-op → not gated") conflated the repo-wide `test: "true"` aggregator with the real `test:unit` runner. The daemon already has `test:unit: bun test`, which is in the turbo graph `bun run quality` executes (qa → qa:test → test → test:unit). Verified: `bunx turbo run test:unit --filter=@podkit/daemon` runs the suite (now 84 pass). No script change needed.

AC#2/#3 — of the 5 doc-052 pure modules, ownership is split and most don't exist yet:
- unknown-model sync guard → TASK-440 (done; table-tested in @podkit/core).
- readiness classifier → BUILT HERE: packages/podkit-daemon/src/readiness-classifier.ts (pure classifyReadiness + formatReadinessNotification), table-tested (13 cases), and wired into sync-orchestrator's hard-error branch (notify-and-skip with actionable guidance; daemon never mutates the device). Added `code` to cli-runner SyncOutput so the CLI's typed error code reaches the daemon. +2 orchestrator tests. AC#3-style (external behavior).
- mass-storage ENV mapper → TASK-444 (not done) — its Tier-1 test lands there.
- container device-access probe → TASK-445 (not done) — its Tier-1 test lands there.
- device-registry resolver → had NO owning task; created TASK-452 (resolver + daemon config-load + sync-by-name) — its Tier-1 test lands there.

So AC#2/#3 complete incrementally as 444/445/452 land (dependencies set). 447 stays In Progress as the Tier-1 aggregation: gating done + guard/classifier tested now.

Sonnet review applied: moved `syncFailed = true` into the generic-error sub-branch only (a clean needs-setup skip was wrongly logged "completed with errors"); added a title assertion to the needs-setup orchestrator test; documented the reserved IPOD_NEEDS_INIT branch.

Also fixed a lint violation that TASK-439 had left (my per-package lint filter missed the root `//#lint`): the `__complete commands` null-parent guard used `process.stderr.write` (breaks the CLI-writes-through-OutputContext convention) — now `throw`s so Commander surfaces it.

Changeset added (@podkit/daemon patch) for the user-facing notification/skip behavior change. Verification: 84 daemon tests pass, daemon typecheck clean, root `//#lint` 0/0, completions tests 53 green.

Update: TASK-452 was a duplicate of TASK-441 and has been archived; the device-registry resolver + its Tier-1 unit tests landed via TASK-441 (device-registry-resolver.test.ts, 14 table tests, external-behavior style). AC#2 now waits only on TASK-444 (ENV mapper) and TASK-445 (device-access probe).

Update: mass-storage ENV mapper + its Tier-1 unit tests landed via TASK-444 (CLI env-device.test.ts, 7 table tests; daemon env-device.test.ts, 5 tests; external-behavior style). AC#2 now waits only on TASK-445 (container device-access probe).

Complete: with TASK-445 landed (container device-access probe, 11 table tests in packages/podkit-cli/src/commands/container-probe.test.ts), all five doc-052 pure modules now have isolation tests — unknown-model guard (TASK-440, @podkit/core), readiness classifier (here, 13 cases), device-registry resolver (TASK-441, 14 cases), mass-storage ENV mapper (TASK-444, 7 CLI + 5 daemon cases), device-access probe (TASK-445). All tested via external behavior (inputs → outputs/typed errors); modules live where their consumers are (core/CLI/daemon), not all in the daemon package as originally sketched. Tier-1 aggregation done.
<!-- SECTION:NOTES:END -->
