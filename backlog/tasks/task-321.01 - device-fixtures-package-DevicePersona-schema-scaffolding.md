---
id: TASK-321.01
title: 'device-testing package: schema + scaffolding'
status: To Do
assignee: []
created_date: '2026-05-11 22:55'
updated_date: '2026-05-12 11:52'
labels:
  - testing
  - vm-coverage
  - foundation
  - package-new
milestone: m-19
dependencies:
  - TASK-290
parent_task_id: TASK-321
priority: high
ordinal: 210
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the new `packages/device-testing/` package — the single consolidated package that replaces the previously planned `packages/device-fixtures/` and `packages/device-harness/`. Contains all shared test infrastructure consumed by both Tier 1 (injectable mocks) and Tier 3 (Linux VM with real USB synthesis).

**Package structure:**
```
packages/device-testing/
  src/
    personas/          # DevicePersona schema + registry
    system-states/     # SystemState schema + registry
    runtime.ts         # TestRuntime interface
    runners/
      local-linux.ts   # local-linux runner (Linux hosts/CI)
    subprocess.ts      # SubprocessRunner abstraction
    index.ts           # public exports
  scripts/             # capture scripts for new personas/states
```

**DevicePersona schema** (matches ADR-017):
- `id`, `description`, `schemaVersion`, `provenance`
- `usbDescriptor` (vendor/product/serial/class/subclass/protocol)
- `sysInfoExtendedXml` (raw XML payload)
- `lsblkJson`, `systemProfilerJson`, `diskutilPlist` (canned subprocess outputs)
- `partitionLayout` (MBR table, sizes, filesystem types)
- `expectedCapabilities`, `expectedReadiness`, `expectedDoctorOutput`

**SystemState schema** (new — see TASK-321.06 for initial registry):
- `id`, `description`
- `ffmpeg`: `'present' | 'missing'`
- `libgpod`: `'present' | 'missing'`
- `udevRule`: `'present' | 'missing'`
- `sgPermissions`: `'granted' | 'denied'`
- `configfs`: `'mounted' | 'unmounted'`
- `expectedDoctorSystemOutput` — snapshot of `podkit doctor` system-scope JSON for this state

**TestRuntime interface:**
```ts
interface TestRuntime {
  id: 'local-linux' | 'lima-test-vm' // more later
  isAvailable(): Promise<boolean>
  prepare(): Promise<void>
  run(command: string, opts: RunOpts): Promise<RunResult>
  teardown(): Promise<void>
}
```

This task delivers:
1. Both schema types + empty registries in their respective `src/` subdirs
2. `TestRuntime` interface + supporting types in `src/runtime.ts`
3. The `local-linux` runner — for Linux hosts; spawns commands in-process
4. Runner registry pattern (additional runners added without modifying core)
5. Stub Turbo `test:vm` task (no-op body; Phase 3 fills it in)

No personas or system states are added here — they come in TASK-321.02 (3 starter personas) and TASK-321.06 (initial SystemState registry).

Package name: `@podkit/device-testing`.

Depends on ADRs (TASK-290) being accepted for the final schema shape.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 packages/device-testing/ exists with package.json (@podkit/device-testing), tsconfig.json, src/index.ts, bun test setup
- [ ] #2 DevicePersona TS type exported, matching ADR-017 schema (schemaVersion, usbDescriptor, sysInfoExtendedXml, lsblkJson, systemProfilerJson, diskutilPlist, partitionLayout, expectedCapabilities, expectedReadiness, expectedDoctorOutput, provenance)
- [ ] #3 SystemState TS type exported with fields: id, description, ffmpeg, libgpod, udevRule, sgPermissions, configfs, expectedDoctorSystemOutput
- [ ] #4 Both empty registry objects exported (Map from id to type) from their respective src/ subdirectories
- [ ] #5 TestRuntime interface exported with the full shape (id, isAvailable, prepare, run, teardown)
- [ ] #6 local-linux runner implemented and tested: isAvailable returns true on Linux, false elsewhere; run spawns the given command and captures stdout/stderr/exit code
- [ ] #7 Runner registry pattern allows additional runners to be registered later without modifying core code
- [ ] #8 Stub turbo test:vm task wired in turbo.json (no-op body acceptable for now)
- [ ] #9 Package builds cleanly via `bun run build --filter @podkit/device-testing`
- [ ] #10 Package is workspace-linked and importable from other packages
- [ ] #11 README explains the purpose, package structure, and how new personas and system states are added
- [ ] #12 package README cross-references agents/device-testing.md so implementers know where to find harness documentation
<!-- AC:END -->
