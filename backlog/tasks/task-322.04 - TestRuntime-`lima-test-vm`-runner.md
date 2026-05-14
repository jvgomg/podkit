---
id: TASK-322.04
title: TestRuntime `lima-test-vm` runner
status: Done
assignee: []
created_date: '2026-05-12 08:19'
updated_date: '2026-05-14 08:28'
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
- [x] #1 LimaTestVmRuntime class implemented in packages/device-testing/src/runners/lima-test-vm.ts and registered in runner registry
- [x] #2 isAvailable() returns true when limactl is in PATH and the device-testing-test-vm instance exists; false otherwise
- [x] #3 prepare() boots the VM if stopped and calls transferBinary() to place podkit at /usr/local/bin/podkit
- [x] #4 applyState(state) restores the QEMU snapshot for the given SystemState; creates snapshot via apply-state.sh on first call
- [x] #5 run(command) executes the command inside the VM via limactl shell and returns stdout/stderr/exit code
- [x] #6 teardown() restores the base-healthy snapshot; does not shut down the VM
- [x] #7 Tier 3 tests auto-skip with a single warning line when lima-test-vm is not available
- [ ] #8 Integration smoke test: on a macOS host with Lima + test VM running, prepare() + run('--version') + teardown() succeeds end-to-end
- [x] #9 Test orchestrator groups tests by required SystemState; snapshot restore happens once per group, not once per test — documented in the runner's test-grouping logic
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation summary (2026-05-14)

Landed the Tier-3 `lima-test-vm` TestRuntime alongside an interface extension that
ripples through to `local-linux`.

### Files

- `packages/device-testing/src/runtime.ts` — added `applyState(state: SystemState)` to the `TestRuntime` interface.
- `packages/device-testing/src/runners/lima-test-vm.ts` — new runner (≈790 lines). Factory + singleton.
- `packages/device-testing/src/runners/lima-test-vm.test.ts` — unit tests (38 cases) with a scripted `SubprocessRunner`.
- `packages/device-testing/src/runners/local-linux.ts` — added `applyState` that no-ops unless `PODKIT_DEVTEST_LOCAL_MUTATE=1`.
- `packages/device-testing/src/runners/local-linux.test.ts` — new tests for the safety guard.
- `packages/device-testing/src/runtime.test.ts` — updated scaffold expectations (lima-test-vm is now auto-registered).
- `packages/device-testing/src/index.ts` — auto-register `limaTestVmRunner`; expose `createLimaTestVmRuntime`, `ensurePersonaSidecar`, `stageBackingFile`, `resetBackingFile`, `startDaemonForPersona`, `stopDaemon`, `instanceStatus`, helper constants.

### Key decisions

1. **TestRuntime interface change** — `applyState(state)` is now mandatory. `local-linux` honours it only behind `PODKIT_DEVTEST_LOCAL_MUTATE=1`; otherwise it warns and returns. This protects developer hosts from accidental `apt remove ffmpeg`.

2. **Factory pattern** — `createLimaTestVmRuntime(opts)` builds a runtime around an injectable `SubprocessRunner` and per-resolver overrides (`resolvePodkitBinary`, `resolveDummyHcdDaemonBinary`, `resolveGpodToolBinary`). Tests use these seams; production callers use the auto-registered singleton.

3. **`isAvailable()` is total** — never throws. Returns `false` for "limactl absent" and "instance missing" alike, so `bun run test` auto-skips Tier 3 cleanly.

4. **`prepare()` ordering** — boot if stopped → transfer podkit (fatal if missing) → best-effort gpod-tool (warns) → best-effort dummy-hcd-daemon (warns) → emit sidecar at `/var/device-testing/personas.json`. Re-runs are idempotent: binary transfer uses sha256 skip and the sidecar payload is deterministic.

5. **Backing-file strategies** — `stageBackingFile` is the one-shot stage primitive (idempotent on sha256). `resetBackingFile` dispatches: `copy` re-stages each call; `swap` stages a `<vmPath>.ref` once and `sudo cp -f` to `<vmPath>` thereafter. The runner owns lifecycle; the daemon only reads what is at `vmPath`. Boundary is documented in `tools/device-testing/dummy-hcd/README.md`.

6. **Daemon lifecycle** — `startDaemonForPersona({ vmName, personaId })` and `stopDaemon({ vmName, personaId? })` issue `sudo systemctl {start,stop} dummy-hcd-daemon@<id>.service`. Tier-3 tests call these between `prepare()` and `run()`; the runner does not auto-start because the daemon is per-persona.

7. **`run()` shape** — wraps the user command in `sh -c '<export X=…; cd …; cmd>'` so `cwd` and `env` opts work through the limactl shell hop. `signal` is always `null` (limactl/ssh does not surface in-VM signals); a timeout fires as `exitCode = 124` via the underlying `SubprocessRunner`. Invalid env keys reject early.

8. **`teardown()`** — restores `base-healthy` when present; otherwise warns and returns (first-ever run). Never shuts the VM down.

### AC status

- AC1–7, AC9: met (verified by unit tests).
- AC8 (live-VM smoke test): deferred — exercised by TASK-322.06 with a real Lima instance.

### Quality gates

- `bun run test --filter @podkit/device-testing` → 191 pass / 2 skip / 0 fail (38 new cases for this task; previous suite extended without regressions).
- `bunx tsc --noEmit` in `packages/device-testing/` → clean.
- `oxlint packages/device-testing/src/` → 0 warnings, 0 errors.

### Open questions

- The signed-binary build pipeline for the dummy-hcd-daemon does not yet stage its output anywhere predictable. The runner reads `tools/device-testing/dummy-hcd/dist/dummy-hcd-daemon-linux-<arch>` and warns when absent — fine for now, but worth wiring into the prebuild Turbo task before TASK-322.06 lands.
- `instanceStatus` parses `limactl list --json` (NDJSON, per Lima 1.x). The format has shifted in past releases; if Lima 2.0 breaks this, fall back to `limactl list --format '{{.Name}}\t{{.Status}}'`.
<!-- SECTION:NOTES:END -->
