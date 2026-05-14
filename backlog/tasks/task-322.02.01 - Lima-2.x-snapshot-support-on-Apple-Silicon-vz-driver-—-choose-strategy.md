---
id: TASK-322.02.01
title: Lima 2.x snapshot support on Apple Silicon (vz driver) — choose strategy
status: To Do
assignee: []
created_date: '2026-05-14 19:29'
labels:
  - testing
  - vm-coverage
  - lima
  - tier-3
milestone: m-19
dependencies: []
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
- [ ] #1 Decision recorded in an ADR (or appended to ADR-016) on which snapshot mechanism Tier-3 will use
- [ ] #2 Measured wall-time of applyState() under the chosen mechanism on Apple Silicon
- [ ] #3 Test VM yaml updated to specify the chosen driver explicitly (no implicit reliance on the user's default)
- [ ] #4 The `unimplemented` fallback in lima-test-vm-snapshots.ts is removed (or its scope is documented as a contingency for non-Apple-Silicon hosts)
- [ ] #5 tools/device-testing/lima/README.md documents the snapshot strategy and any platform-specific guidance
<!-- AC:END -->
