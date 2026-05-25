# @podkit/device-testing

Shared fixture registries and the `TestRuntime` harness consumed by every unit test and VM test in podkit's device test stack (see [ADR-016](../../adr/adr-016-linux-vm-test-harness.md) and [ADR-017](../../adr/adr-017-device-persona-fixtures.md)).

A single package consolidates fixtures + runners so unit-test mocks and VM/USB-gadget responses can never drift — they derive from the same TypeScript object.

## Package structure

```
packages/device-testing/
  src/
    personas/          # DevicePersona schema + registry
    system-states/     # SystemState schema + registry
    runtime.ts         # TestRuntime interface + RunOpts/RunResult
    runners/
      local-linux.ts   # Local-host runner (Linux only)
      registry.ts      # register/get/list helpers
    subprocess.ts      # SubprocessRunner interface + default real runner
    index.ts           # public exports; auto-registers local-linux
```

## Public exports

| Export | Purpose |
|--------|---------|
| `DevicePersona`, `personas` | Typed device fixtures + registry (`Map<string, DevicePersona>`) |
| `SystemState`, `systemStates` | Typed host-environment fixtures + registry (`Map<string, SystemState>`) |
| `TestRuntime`, `RunnerId`, `RunOpts`, `RunResult` | Runtime abstraction |
| `localLinuxRunner` | Linux-only runner instance |
| `registerRunner`, `getRunner`, `listRunners` | Runner registry helpers |
| `SubprocessRunner`, `SubprocessRunOpts`, `SubprocessRunResult`, `defaultSubprocessRunner` | Subprocess runner interface + default real-execFile implementation (re-exported from `@podkit/device-types` and `@podkit/core` for a single import path) |

Importing the package auto-registers `local-linux`. VM runners (`lima-test-vm`) register themselves when their respective modules load.

## Adding a persona

Personas land in TASK-321.02 (starter set: `ipod-video-5g-fresh`, `ipod-nano-7g-populated`, `echo-mini-empty`). Workflow once the agent guide ships in TASK-321.08 (`agents/device-testing.md`):

1. Capture USB descriptor, SysInfoExtended XML, `lsblk -J`, `system_profiler`, and `diskutil` output from real hardware (`scripts/capture-persona.ts`).
2. Author a `src/personas/<id>/persona.ts` exporting a `DevicePersona`.
3. Register it by adding `personas.set(persona.id, persona)` in `src/personas/index.ts`.
4. Commit the captured payloads alongside a `provenance.md`.

## Adding a SystemState

States land in TASK-321.06 (initial set: `healthy`, `no-ffmpeg`, `no-libgpod`, `no-udev`, `no-sg-perms`, `corrupt-configfs`). Workflow:

1. Author `src/system-states/<id>.ts` exporting a `SystemState`.
2. Register it by adding `systemStates.set(state.id, state)` in `src/system-states/index.ts`.
3. Run the matching VM-mutation script and snapshot the VM as `base-${id}` (TASK-321.06 wires this up).

## VM test turbo task

A no-op `@podkit/device-testing#test:vm` task is registered in the repo-root `turbo.json` so the dependency graph is in place. The body lands in TASK-321.07 (Linux native build pipeline) and TASK-321.03 (`lima-test-vm` runner).

## Stability

Schema-breaking changes bump the `schemaVersion` field on `DevicePersona` / `SystemState` and migrate all entries in the same commit. No backwards-compatibility shims.
