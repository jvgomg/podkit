---
id: TASK-339
title: 'Tier-3 wall-time tripwire: revisit snapshot strategy if it exceeds 90s'
status: To Do
assignee: []
created_date: '2026-05-15 23:59'
labels:
  - testing
  - vm-coverage
  - tier-3
  - lima
milestone: m-19
dependencies:
  - TASK-322.02.01
priority: low
ordinal: 22700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-322.02.01 settled on `apply-state.sh-every-time` for Lima vz (no snapshots; sub-2s per state flip on Apple Silicon). That's fine for today's matrix (~6 SystemStates × ~3 starter personas ≈ 18 state changes per run, ~30s total overhead). It won't stay fine.

As TASK-307/308/301/302/etc Tier-3 sweeps land, the matrix expands:
- Per-check Tier-3 assertions across all SystemStates × applicable personas
- The doctor-coverage tasks (TASK-301..308) imply 50+ state-permutation invocations
- Phase 5 persona expansion (TASK-324) adds more personas

At 1.5s per state flip × 50+ flips, that's a minute+ of pure setup overhead per Tier-3 cycle. Sub-2s "feels acceptable" today; it'll feel painful as soon as the matrix breaks past ~30 cells.

## What to do

This task isn't "implement now" — it's a **tripwire** with a clear action.

1. Measure Tier-3 wall-clock on a populated VM with the full matrix.
2. If wall time exceeds **90 seconds** (or whatever threshold you pick — that's a reasonable signal), revisit TASK-322.02.01's options:
   - **Option A**: switch `test-vm.yaml` to `vmType: qemu`. QEMU snapshots work, sub-second restore — but boot is 30s vs 5s on vz.
   - **Option B**: APFS snapshots of the VZ disk image (macOS-native; requires `tmutil` or `apfsctl`).
   - **Option C**: keep apply-state.sh but parallelise state groups (run two VMs concurrently).
   - **Option D**: wait for upstream Lima to ship VZ snapshot support (track Lima releases).

## When to trigger

The tripwire isn't time-based — it's **work-based**. Concrete triggers:
- A developer's full Tier-3 run regularly takes > 2 minutes on Apple Silicon
- The CI smoke (if Tier-3 ever gets one) consistently times out
- Adding a new SystemState makes the suite "noticeably slower"

If none of those fire, this task stays To Do indefinitely — that's correct.

## Out of scope

- Reopening the TASK-322.02.01 decision unilaterally. The tripwire is a forcing function, not a default to do this work.
- Switching the test-vm.yaml driver as a default. That's the tripwire's first option, but only if measurements say so.

## References

- `backlog/tasks/task-322.02.01` — current decision + rejected alternatives
- `agents/testing.md` §"Doctor exit-code & overall-health semantics" — for warn-counts decision context
- `tools/device-testing/lima/test-vm.yaml` — VM config with `vmType: 'vz'` pinned
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Measure full Tier-3 wall-clock with the current matrix; record baseline in agents/device-testing.md or this task's notes
- [ ] #2 If baseline exceeds 90s, evaluate Options A-D and file the chosen implementation as a follow-up task
- [ ] #3 If baseline is under 90s, mark this task Won't Do with the measurement on record
- [ ] #4 Re-measure when adding > 5 new SystemStates or > 5 new personas, whichever happens first
<!-- AC:END -->
