---
id: TASK-322.02.01
title: Lima 2.x snapshot support on Apple Silicon (vz driver) — choose strategy
status: In Progress
assignee: []
created_date: '2026-05-14 19:29'
updated_date: '2026-05-14 20:41'
labels:
  - testing
  - vm-coverage
  - lima
  - tier-3
milestone: m-19
dependencies: []
modified_files:
  - adr/adr-016-linux-vm-test-harness.md
  - tools/device-testing/lima/test-vm.yaml
  - tools/device-testing/lima/README.md
parent_task_id: TASK-322.02
priority: medium
ordinal: 21500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Resolve the snapshot-strategy gap surfaced on 2026-05-14 during the first end-to-end live-VM smoke of the Tier-3 harness.

**What we found:**
- Lima 2.1.1's default driver on Apple Silicon is `vz` (Apple's Virtualization framework).
- `limactl snapshot {create,apply,delete,list}` exits 1 with `level=fatal msg=unimplemented` on the `vz` driver. Snapshots are QEMU-only in Lima 2.x.
- ADR-016 §"Snapshot-based state layering" assumed snapshot restore would be the per-test fast path (~1s vs. ~30s for apt-mutation). On `vz`, no snapshots = every applyState call runs `apply-state.sh` in full.

**Workaround already landed (TASK-322.02 patch):**
`snapshotExists()` / `createSnapshot()` / `restoreSnapshot()` detect the "unimplemented" stderr and degrade silently — `applyState` falls back to apply-state.sh-every-time. Functional but slow. Acceptable for low test counts; not acceptable for the full doctor matrix (TASK-307–311, dozens of state-permutation invocations).

**Options to evaluate:**

1. **Switch test VM to `vmType: qemu` on Apple Silicon.** QEMU supports snapshots. Boot is much slower than VZ (~30s vs ~5s) but snapshot restore stays at the ~1s target. Verify QEMU-on-aarch64 ships dummy_hcd + FunctionFS modules under the same path.
2. **Use Lima's `tools/copy-images.sh` + manual `qcow2` snapshots out-of-band.** Drop the `limactl snapshot` dependency entirely. Pause the VM, snapshot the disk image with `qemu-img snapshot -c`, resume. Coordinate with Lima's lifecycle management — risk of file-locking conflicts.
3. **APFS snapshots of the VZ disk image.** macOS-native, very fast clones. Requires `tmutil` or `apfsctl` — adds a macOS dependency that the Lima abstraction is meant to hide.
4. **Stay with apply-state.sh-every-time + parallelise across test groups.** No snapshots. Each group's `applyState` does the full apt remove/install. Cost: ~30s per state change. Acceptable if the doctor matrix is small (single-digit state permutations); painful at ~50+.
5. **Wait for upstream Lima to ship VZ snapshot support.** Lima's roadmap mentions VZ snapshots as a planned feature. Verify the current upstream status and timeline.

**Decision criteria:**
- Wall-time budget for the doctor matrix (TASK-307–311 needs the full state grid).
- Operational complexity (file locking, lifecycle management).
- Compatibility with `dummy_hcd` + FunctionFS module loading.

**References:**
- `packages/device-testing/src/runners/lima-test-vm-snapshots.ts` — current fallback
- `tools/device-testing/lima/test-vm.yaml` — VM config (currently no explicit `vmType`)
- ADR-016 §"Snapshot-based state layering"
- `limactl info` on 2026-05-14: version 2.1.1, drivers list empty, VM uses `vz`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Decision recorded in an ADR (or appended to ADR-016) on which snapshot mechanism Tier-3 will use
- [x] #2 Measured wall-time of applyState() under the chosen mechanism on Apple Silicon
- [x] #3 Test VM yaml updated to specify the chosen driver explicitly (no implicit reliance on the user's default)
- [ ] #4 The `unimplemented` fallback in lima-test-vm-snapshots.ts is removed (or its scope is documented as a contingency for non-Apple-Silicon hosts)
- [x] #5 tools/device-testing/lima/README.md documents the snapshot strategy and any platform-specific guidance
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Decision: stay with `apply-state.sh`-every-time on Apple Silicon `vz`.**

Measurements on `podkit-test-vm` (aarch64, Debian 12.10, package cache warm):
- `apt-get install --reinstall ffmpeg` → **740ms**
- `apt-get purge libgpod4 libgpod-common && apt-get install …` → **860ms total** (purge 412ms, install 444ms)

Current matrix: 6 SystemStates. Even at the worst case (~1s per state restore, ~6 restores per full pass) the state-mutation overhead is well inside the test budget.

Lima docs (`/lima-vm/lima` via Context7) confirm snapshots are QEMU-only in 2.x; `vz` snapshot support is not on the near-term roadmap. The existing `isSnapshotUnsupported()` fallback in `lima-test-vm-snapshots.ts` is kept — it lets the snapshot fast path light up automatically on Linux hosts or a future `vmType: qemu` opt-in without test-code changes (so AC #4 is intentionally NOT done — the fallback is now documented as a contingency, not a defect).

**Rejected alternatives** (rationale in the ADR appendix):
- Switch to `vmType: qemu`: +25s cold-boot tax for no per-test win at current scale.
- Out-of-band `qemu-img snapshot`: pause/resume + file-locking complexity.
- APFS snapshots: leaks macOS tooling through the Lima abstraction.
- Wait for upstream Lima VZ snapshots: not blocking.

**Revisit trigger:** doctor matrix > 20 states OR per-state apt-replay cost > 5s.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Resolved the snapshot-strategy gap in favour of staying with `apply-state.sh`-every-time on Apple Silicon `vz`. Measured per-state mutation cost (~740–860ms) is sub-2-second on the warm-cache test VM, well inside the test budget for the current 6-state matrix. ADR-016 §"Test speed strategy" appendix records the decision and the rejected alternatives. `test-vm.yaml` now pins `vmType: vz` explicitly so the choice is not implicit. `lima/README.md` documents the Apple-Silicon caveat at the top of the snapshot-lifecycle section. The `isSnapshotUnsupported()` fallback in `lima-test-vm-snapshots.ts` is retained: it makes the snapshot fast path light up automatically on Linux hosts or a future `vmType: qemu` opt-in. Revisit trigger noted: matrix > 20 states OR per-state cost > 5s.
<!-- SECTION:FINAL_SUMMARY:END -->
