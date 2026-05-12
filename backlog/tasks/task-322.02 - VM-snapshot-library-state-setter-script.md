---
id: TASK-322.02
title: VM snapshot library + state-setter script
status: To Do
assignee: []
created_date: '2026-05-12 08:18'
labels:
  - testing
  - vm-coverage
  - lima
  - tier-3
milestone: m-19
dependencies:
  - TASK-322.01
  - TASK-321.06
parent_task_id: TASK-322
priority: high
ordinal: 420
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement Option III snapshot-based state layering: one base Lima test VM with all needed packages installed, plus named QEMU snapshots for each `SystemState`. Restoring a snapshot takes <1s (qemu-img internal operation) and is the primary state-change mechanism for Tier 3 tests.

**Named snapshots** correspond 1:1 with `SystemState` registry entries (TASK-321.06):
- `base-healthy`
- `base-no-ffmpeg`
- `base-no-libgpod`
- `base-no-udev`
- `base-no-sg-perms`
- `base-corrupt-configfs`

**Components:**

1. **`apply-state.sh`** — in-VM script (committed to `tools/device-testing/scripts/apply-state.sh`) that mutates the VM to match a given `SystemState` via apt, chmod, file moves, and kernel module manipulation. Used when a snapshot for a state is missing (first run or after VM reprovision). Idempotent.

2. **Snapshot create wrappers** — TypeScript helpers in `@podkit/device-testing` (or a small shell wrapper) that:
   - Call `limactl shell <vm> sudo qemu-img snapshot -c <name>` to create a named snapshot
   - Call `limactl shell <vm> sudo qemu-img snapshot -a <name>` to restore a named snapshot
   - Handle VM pause/resume as required by qemu-img snapshot operations

3. **State initialisation flow:**
   - On first run, if snapshot `base-<state-id>` doesn't exist: boot VM, call `apply-state.sh <state-id>`, create snapshot
   - On subsequent runs: restore snapshot directly (no apt/chmod involved)
   - Snapshot cache lives on host alongside the binary turbo cache

4. **Snapshot artefacts** — named snapshots are QEMU disk images internal to Lima's VM disk; they're not cached as separate files, but the creation step is skipped on Turbo cache hit if inputs haven't changed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 tools/device-testing/scripts/apply-state.sh exists, accepts a SystemState id argument, and correctly mutates the VM (apt remove/install, chmod, modprobe/rmmod, etc.) to match that state
- [ ] #2 apply-state.sh is idempotent: running it twice with the same argument produces the same VM state
- [ ] #3 TypeScript snapshot helpers exported from @podkit/device-testing: createSnapshot(vmName, snapshotName), restoreSnapshot(vmName, snapshotName), snapshotExists(vmName, snapshotName)
- [ ] #4 State initialisation flow works end-to-end: fresh VM boots, apply-state.sh runs, snapshot created; second run restores snapshot without re-applying
- [ ] #5 All 6 SystemState snapshots (base-healthy through base-corrupt-configfs) can be created from a freshly provisioned test VM
- [ ] #6 Snapshot restore completes in under 2 seconds on the macOS host (measured)
- [ ] #7 README documents the snapshot lifecycle and how to reprovision if snapshots become stale
<!-- AC:END -->
