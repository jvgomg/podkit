---
id: TASK-321.06
title: SystemState fixture schema + initial registry
status: To Do
assignee: []
created_date: '2026-05-12 08:17'
labels:
  - testing
  - vm-coverage
  - foundation
  - fixtures
milestone: m-19
dependencies:
  - TASK-321.01
parent_task_id: TASK-321
priority: high
ordinal: 260
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Define the `SystemState` schema and populate an initial registry of 5–6 states inside `@podkit/device-testing` under `src/system-states/`. `SystemState` is the parallel concept to `DevicePersona`: it describes the host Linux environment that surrounds the podkit binary, not the USB device it talks to.

**Schema:**
```ts
interface SystemState {
  id: string;
  description: string;
  schemaVersion: number;
  // Environment flags
  ffmpeg: 'present' | 'missing';
  libgpod: 'present' | 'missing';       // runtime library, not -dev
  udevRule: 'present' | 'missing';      // /etc/udev/rules.d/51-libmtp.rules or similar
  sgPermissions: 'granted' | 'denied';  // /dev/sg* readable by running user
  configfs: 'mounted' | 'unmounted';    // /sys/kernel/config
  // Expected outcome — what `podkit doctor --scope system --format json` should emit for this state
  expectedDoctorSystemOutput: object;
}
```

**Initial registry (6 states):**

| ID | ffmpeg | libgpod | udevRule | sgPermissions | configfs | Purpose |
|----|--------|---------|----------|---------------|----------|---------|
| `healthy` | present | present | present | granted | mounted | Happy-path baseline |
| `no-ffmpeg` | missing | present | present | granted | mounted | Doctor flags missing transcoder |
| `no-libgpod` | present | missing | present | granted | mounted | Doctor flags missing iPod library |
| `no-udev` | present | present | missing | granted | mounted | Doctor flags missing udev rule |
| `no-sg-perms` | present | present | present | denied | mounted | Doctor flags permission error |
| `corrupt-configfs` | present | present | present | granted | unmounted | Doctor flags kernel config issue |

Each state's `expectedDoctorSystemOutput` is a JSON snapshot of what `podkit doctor --scope system --format json` emits when the state is active. These snapshots are the source of truth for doctor assertions in Tier 3 tests.

Lives alongside `DevicePersona` in `@podkit/device-testing/src/system-states/`. States are applied in the test VM via in-VM `apply-state.sh` (see TASK-322.02) or via VM snapshot restore (Option III approach — see ADR-016).

Depends on TASK-321.01 for the package scaffold and the `SystemState` type definition.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 SystemState type exported from @podkit/device-testing, matching schema above
- [ ] #2 Initial registry of 6 states exported from src/system-states/index.ts: healthy, no-ffmpeg, no-libgpod, no-udev, no-sg-perms, corrupt-configfs
- [ ] #3 Each state has a populated expectedDoctorSystemOutput JSON snapshot (synthesised to match expected doctor output; may be updated after first real VM run)
- [ ] #4 README in src/system-states/ explains how to add more states and how the snapshots are captured/updated
- [ ] #5 Smoke test asserts that the healthy state's expectedDoctorSystemOutput matches a known-good doctor JSON snapshot (golden file assertion)
- [ ] #6 All 6 states are accessible via the exported registry map (stateId → SystemState)
<!-- AC:END -->
