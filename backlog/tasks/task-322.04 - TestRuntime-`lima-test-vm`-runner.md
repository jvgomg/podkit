---
id: TASK-322.04
title: TestRuntime `lima-test-vm` runner
status: To Do
assignee: []
created_date: '2026-05-12 08:19'
updated_date: '2026-05-12 11:54'
labels:
  - testing
  - vm-coverage
  - lima
  - tier-3
milestone: m-19
dependencies:
  - TASK-322.01
  - TASK-322.02
  - TASK-322.03
  - TASK-321.01
parent_task_id: TASK-322
priority: high
ordinal: 440
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the `lima-test-vm` backend for the `TestRuntime` interface (defined in TASK-321.01) inside `@podkit/device-testing/src/runners/lima-test-vm.ts`. This runner is used on macOS dev hosts and is the primary Tier 3 runtime for developers who don't have a bare-metal Linux machine.

**Interface implementation:**

```ts
class LimaTestVmRuntime implements TestRuntime {
  id = 'lima-test-vm' as const

  async isAvailable(): Promise<boolean>
  // Returns true if: Lima is installed (limactl in PATH) AND the test VM instance exists

  async prepare(): Promise<void>
  // 1. Boots the test VM if not already running (limactl start device-testing-test-vm)
  // 2. Calls transferBinary() to ensure the latest podkit binary is at /usr/local/bin/podkit

  async applyState(state: SystemState): Promise<void>
  // Restores the named QEMU snapshot (restoreSnapshot(vmName, `base-${state.id}`))
  // Falls back to apply-state.sh + snapshot creation if the snapshot doesn't exist yet

  async run(command: string, opts?: RunOpts): Promise<RunResult>
  // Executes `limactl shell <vm> /usr/local/bin/podkit <command>` (or the full command string)
  // Captures stdout, stderr, exit code

  async teardown(): Promise<void>
  // Restores the `base-healthy` snapshot (leaves VM in clean state for next test run)
  // Does NOT shut down the VM (shutdown is too slow for per-test teardown)
}
```

Register this runner in the runner registry alongside `local-linux`.

**Opt-in detection:** `bun run test` calls `isAvailable()` on all registered runners. If `lima-test-vm` is available, Tier 3 tests run. If not (Lima not installed, or VM not started), tests auto-skip with a single-line warning per ADR-016.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 LimaTestVmRuntime class implemented in packages/device-testing/src/runners/lima-test-vm.ts and registered in runner registry
- [ ] #2 isAvailable() returns true when limactl is in PATH and the device-testing-test-vm instance exists; false otherwise
- [ ] #3 prepare() boots the VM if stopped and calls transferBinary() to place podkit at /usr/local/bin/podkit
- [ ] #4 applyState(state) restores the QEMU snapshot for the given SystemState; creates snapshot via apply-state.sh on first call
- [ ] #5 run(command) executes the command inside the VM via limactl shell and returns stdout/stderr/exit code
- [ ] #6 teardown() restores the base-healthy snapshot; does not shut down the VM
- [ ] #7 Tier 3 tests auto-skip with a single warning line when lima-test-vm is not available
- [ ] #8 Integration smoke test: on a macOS host with Lima + test VM running, prepare() + run('--version') + teardown() succeeds end-to-end
- [ ] #9 Test orchestrator groups tests by required SystemState; snapshot restore happens once per group, not once per test — documented in the runner's test-grouping logic
<!-- AC:END -->
