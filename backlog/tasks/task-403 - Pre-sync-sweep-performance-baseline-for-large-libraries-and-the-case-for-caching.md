---
id: TASK-403
title: >-
  Pre-sync sweep performance baseline for large libraries (and the case for
  caching)
status: To Do
assignee: []
created_date: '2026-06-07 16:17'
labels:
  - performance
  - sync-engine
  - follow-up
dependencies:
  - TASK-398
references:
  - packages/podkit-core/src/diagnostics/scanners/
  - packages/podkit-core/src/sync/engine/pre-sync-sweep.ts
priority: low
ordinal: 119000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

TASK-398 added a full content-surface walk at the start of every `podkit sync`. The walker traverses every file under the configured content directories (mass-storage) or under `iPod_Control/` (iPod), keying on extension + dotfile rules.

For most users this is fast — a few hundred files, completes in tens of milliseconds. But:

- **Large iPod libraries.** A 120 GB Classic with ~25K tracks across 50 F-buckets means ~25K `readdir` entries. On a USB 2.0 HDD-backed iPod with NTFS or HFS+, the syscall overhead alone can push this into the seconds-to-tens-of-seconds range — added to every sync.
- **Mass-storage devices on slow buses.** Echo Mini over USB OTG, an SD-card-on-USB bridge with a deep music tree. Same shape.
- **Subsonic-on-Tailscale syncs.** Source scan already takes seconds; adding a device walk piles on.

This task: **measure**, then decide whether the added cost is acceptable or whether the sweep needs an opt-out / cache / coarser cadence.

## Scope

1. **Add a perf benchmark** (`*.perf.test.ts`) that walks a synthetic 25K-track tree and times `runPreSyncSweep`. Run on macOS HFS+, ext4, NTFS (via VM).
2. **Profile a real-world case** — sweep timing line in `podkit sync -v` output (under `--debug` or similar). Capture P50/P95/P99 across a few real syncs of the TERAPOD.
3. **Establish a budget.** If P95 exceeds, say, 5 s of added wall-clock on the largest realistic library, we need a mitigation:
   - **Cache mtime of "last clean scan" in `.podkit/state.json`.** If the device hasn't been written to since (compare `state.mtime` of the content dirs vs `cached.lastSweepAt`), skip the sweep.
   - **Coarser cadence.** Sweep only every N syncs.
   - **Background sweep.** Run the sweep async in parallel with `adapter.connect()` / diff computation; merge results into preliminaries when ready.
   - **--no-sweep opt-out flag.** Last-resort escape hatch.
4. **Document the chosen strategy.** Add a `Performance` subsection to `sync/planning.md` §6 or a sibling doc.

## Why deferred

No user complaints yet — small libraries are fast. But the cost is paid on EVERY sync, so it accumulates. Should be ahead-of-the-complaint, not behind.

## Acceptance

- Perf benchmark in `*.perf.test.ts` covering small (100 files), medium (1K), large (25K) libraries.
- Real-world P50/P95/P99 captured against TERAPOD or comparable.
- Decision: do we need a mitigation? If yes, which approach + ADR if material.
- If mitigation lands: `sync/planning.md` updated with the perf characteristics + strategy.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Perf benchmark covering small/medium/large library sizes added under *.perf.test.ts
- [ ] #2 Real-world P50/P95/P99 timings captured against a real iPod (TERAPOD or comparable)
- [ ] #3 Decision recorded: mitigation needed or not, with budget threshold
- [ ] #4 If mitigation lands: ADR or architecture doc subsection describes the approach
- [ ] #5 sync/planning.md §6 updated with performance characteristics + strategy
<!-- AC:END -->
