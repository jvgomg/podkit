---
id: TASK-321.06
title: SystemState fixture schema + initial registry
status: Done
assignee: []
created_date: '2026-05-12 08:17'
updated_date: '2026-05-13 17:24'
labels:
  - testing
  - vm-coverage
  - foundation
  - fixtures
milestone: m-19
dependencies:
  - TASK-321.01
modified_files:
  - packages/device-testing/src/system-states/healthy.ts
  - packages/device-testing/src/system-states/no-ffmpeg.ts
  - packages/device-testing/src/system-states/no-libgpod.ts
  - packages/device-testing/src/system-states/no-udev.ts
  - packages/device-testing/src/system-states/no-sg-perms.ts
  - packages/device-testing/src/system-states/corrupt-configfs.ts
  - packages/device-testing/src/system-states/index.ts
  - packages/device-testing/src/system-states/system-states.test.ts
  - >-
    packages/device-testing/src/system-states/__fixtures__/healthy-doctor-output.golden.json
  - packages/device-testing/src/system-states/README.md
  - packages/device-testing/src/index.ts
  - packages/device-testing/src/runtime.test.ts
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
- [x] #1 SystemState type exported from @podkit/device-testing, matching schema above
- [x] #2 Initial registry of 6 states exported from src/system-states/index.ts: healthy, no-ffmpeg, no-libgpod, no-udev, no-sg-perms, corrupt-configfs
- [x] #3 Each state has a populated expectedDoctorSystemOutput JSON snapshot (synthesised to match expected doctor output; may be updated after first real VM run)
- [x] #4 README in src/system-states/ explains how to add more states and how the snapshots are captured/updated
- [x] #5 Smoke test asserts that the healthy state's expectedDoctorSystemOutput matches a known-good doctor JSON snapshot (golden file assertion)
- [x] #6 All 6 states are accessible via the exported registry map (stateId → SystemState)
<!-- AC:END -->



## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Each state lives in its own file (`healthy.ts`, `no-ffmpeg.ts`, `no-libgpod.ts`, `no-udev.ts`, `no-sg-perms.ts`, `corrupt-configfs.ts`). The index.ts populates the Map at module load and named-exports all six states. The main `src/index.ts` re-exports them. Golden file for `healthy` is at `__fixtures__/healthy-doctor-output.golden.json`.

Check IDs used in `expectedDoctorSystemOutput`:
- `ffmpeg` — future check for FFmpeg binary presence (not yet in diagnostics registry)
- `codec-encoders` — maps to existing `codecEncodersCheck` (id: 'codec-encoders')
- `video-encoder` — maps to existing `videoEncoderCheck` (id: 'video-encoder')
- `libgpod-runtime` — future check for libgpod availability (not yet in diagnostics registry)
- `inquiry-methods` — maps to existing `inquiryMethodsCheck` (id: 'inquiry-methods'), covers sg permissions
- `udev-rule` — maps to existing `udevRuleCheck` (id: 'udev-rule'), used as detection check (currently repairOnly; future detection check will share the ID)
- `configfs-mount` — future check for configfs mount (not yet in diagnostics registry)

The `no-sg-perms` state uses `overallStatus: 'warn'` (not 'fail') because the `inquiry-methods` check returns 'warn' when sg nodes are present but not readable — USB inquiry still works for most devices.

Updated `runtime.test.ts` (in `src/`, not `src/__tests__/`) to reflect the registry now has 6 entries instead of 0. All expectedDoctorSystemOutput values are v0 synthesised; will be updated from real VM runs in TASK-322.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Populated the `systemStates` registry with 6 named states (`healthy`, `no-ffmpeg`, `no-libgpod`, `no-udev`, `no-sg-perms`, `corrupt-configfs`) and shipped a golden-snapshot smoke test with 81 passing assertions.
<!-- SECTION:FINAL_SUMMARY:END -->
