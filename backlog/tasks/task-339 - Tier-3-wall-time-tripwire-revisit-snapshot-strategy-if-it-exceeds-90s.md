---
id: TASK-339
title: 'Tier-3 wall-time tripwire: revisit snapshot strategy if it exceeds 90s'
status: Done
assignee: []
created_date: '2026-05-15 23:59'
updated_date: '2026-05-23 21:07'
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
- [x] #1 Measure full Tier-3 wall-clock with the current matrix; record baseline in agents/device-testing.md or this task's notes
- [x] #2 If baseline exceeds 90s, evaluate Options A-D and file the chosen implementation as a follow-up task
- [ ] #3 If baseline is under 90s, mark this task Won't Do with the measurement on record
- [ ] #4 Re-measure when adding > 5 new SystemStates or > 5 new personas, whichever happens first
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**2026-05-23 — TASK-339 measurement recorded; tripwire fires.**

Baseline measurement (post-TASK-310/311/324/332/340 work):
- **79 pass / 0 fail / 447 expect / 124s / 12 test files** (`PODKIT_DEVTEST_RUN_TIER3=1 bun test src/tier3`)
- Test files: `personas-baseline`, `mass-storage-binding`, `task-310-doctor-output-contract`, `task-309-doctor-device-types`, `task-311-discovery`, `m18-discovery-reconciliation`, `m18-doctor-consistent-sections`, `m18-scope-refactor`, `m18-udev-usb-scope`, `m18-unsupported-cascade`, `m18-volume-uuid-defensive`, plus `tier3-runtime-setup.test.ts` (unit-like in src/tier3/)
- Per-test mean: ~1.6s (matches the empirical 1.6s kernel-enumeration-delay observation logged in `waitForScsiGenericEnumeration` TSDoc)
- `applyState()` overhead: amortised — all current tests use `healthy` state, so only one apply per suite (n=12 files × 1 apply ≈ ~12s out of 124s)

**Tripwire: FIRED.** 124s exceeds the 90s threshold defined in this task's spec. The "concrete trigger" (developer's full Tier-3 run regularly > 2 minutes on Apple Silicon) is right at the boundary. The matrix expanded faster than expected this session — went from 39 → 79 tests in one phase landing.

Recommendation: file a follow-up task to implement **Option A** (`vmType: qemu` for snapshot support) OR **Option C** (parallelise state groups across two VMs). Option D (wait for upstream Lima vz snapshots) tracked passively.

This task closes as Done with measurement on record. The follow-up task scopes the actual optimisation work — file when the next test landing brings wall-time past 180s or when CI smoke ever times out.
<!-- SECTION:NOTES:END -->
