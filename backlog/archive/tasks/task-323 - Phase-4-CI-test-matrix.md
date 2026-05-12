---
id: TASK-323
title: 'Phase 4: CI test matrix'
status: To Do
assignee: []
created_date: '2026-05-11 22:56'
updated_date: '2026-05-11 22:57'
labels:
  - testing
  - vm-coverage
  - ci
milestone: m-19
dependencies:
  - TASK-320
  - TASK-321
priority: medium
ordinal: 600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parent task for wiring the test harness into GitHub Actions.

**Tier 3 cannot run on GH-hosted `ubuntu-latest`** — the Azure-flavor kernel does not ship `dummy_hcd` (confirmed by TASK-320 spike). Tier 3 in CI requires one of:

**Option A — Self-hosted Linux runner**: a Debian/Ubuntu host with `linux-generic` kernel, dummy_hcd loaded, podkit dependencies pre-installed. Simplest path. Reuses the same provisioning as `tools/lima/virtual-ipod.yaml`. Cost: maintaining one host (could be a $5/mo VPS, a spare Mac mini running Linux in a VM, or a Hetzner box).

**Option B — Nested Lima/QEMU inside `ubuntu-latest`**: boot a generic-kernel Debian VM inside the GH runner using QEMU or a Lima-style wrapper, run Tier 3 inside. Slow (~3–5 min boot), keeps CI hosted, no extra hosting cost. Reuses `tools/lima/run-tests.sh` patterns.

**Decision to make in Phase 4 kick-off** (subtask): pick A or B. Both are viable. A is faster per-run + simpler; B has zero ops burden.

Matrix:
- `ubuntu-latest` — runs Tier 1 + Tier 2 (linux-tagged) **only**. Tier 3 dispatched to Option A or B.
- `macos-latest` — runs Tier 1 + Tier 2 (darwin-tagged). Tier 3 not applicable.
- `windows-latest` — deferred (future WSL2 work).

Turbo remote cache (Vercel Remote Cache free tier or similar) is **optional** but cuts CI runtime when local cache is cold.

Each PR runs the full matrix. Nightly cron run catches upstream OS/runner image drift.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Decision recorded (Option A self-hosted vs Option B nested Lima) with rationale in this task's notes
- [ ] #2 GH Actions workflow runs on every PR with ubuntu-latest + macos-latest jobs
- [ ] #3 ubuntu-latest job runs Tier 1 + Tier 2 (linux-tagged) and dispatches Tier 3 to the chosen option
- [ ] #4 Tier 3 in CI passes against the 3 starter personas
- [ ] #5 macos-latest job runs Tier 1 + Tier 2 darwin-tagged tests; skips Tier 3 cleanly with a single-line log
- [ ] #6 Nightly cron run is configured (catches runner image drift)
- [ ] #7 Average PR test wall time documented in agents/testing.md
- [ ] #8 If Option A chosen: runbook for the self-hosted runner host (provisioning, monitoring, secret rotation) lives in agents/
- [ ] #9 If Option B chosen: nested-VM boot is reliable and the cache for the inner VM image persists across CI runs
<!-- AC:END -->
