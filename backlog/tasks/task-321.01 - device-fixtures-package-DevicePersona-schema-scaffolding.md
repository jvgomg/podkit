---
id: TASK-321.01
title: 'device-testing package: schema + scaffolding'
status: Done
assignee: []
created_date: '2026-05-11 22:55'
updated_date: '2026-05-13 17:18'
labels:
  - testing
  - vm-coverage
  - foundation
  - package-new
milestone: m-19
dependencies:
  - TASK-290
modified_files:
  - packages/device-testing/package.json
  - packages/device-testing/tsconfig.json
  - packages/device-testing/tsconfig.build.json
  - packages/device-testing/bunfig.toml
  - packages/device-testing/README.md
  - packages/device-testing/test/preload.ts
  - packages/device-testing/src/index.ts
  - packages/device-testing/src/runtime.ts
  - packages/device-testing/src/subprocess.ts
  - packages/device-testing/src/personas/types.ts
  - packages/device-testing/src/personas/index.ts
  - packages/device-testing/src/system-states/types.ts
  - packages/device-testing/src/system-states/index.ts
  - packages/device-testing/src/runners/local-linux.ts
  - packages/device-testing/src/runners/registry.ts
  - packages/device-testing/src/runtime.test.ts
  - turbo.json
  - bun.lock
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
- [x] #1 packages/device-testing/ exists with package.json (@podkit/device-testing), tsconfig.json, src/index.ts, bun test setup
- [x] #2 DevicePersona TS type exported, matching ADR-017 schema (schemaVersion, usbDescriptor, sysInfoExtendedXml, lsblkJson, systemProfilerJson, diskutilPlist, partitionLayout, expectedCapabilities, expectedReadiness, expectedDoctorOutput, provenance)
- [x] #3 SystemState TS type exported with fields: id, description, ffmpeg, libgpod, udevRule, sgPermissions, configfs, expectedDoctorSystemOutput
- [x] #4 Both empty registry objects exported (Map from id to type) from their respective src/ subdirectories
- [x] #5 TestRuntime interface exported with the full shape (id, isAvailable, prepare, run, teardown)
- [x] #6 local-linux runner implemented and tested: isAvailable returns true on Linux, false elsewhere; run spawns the given command and captures stdout/stderr/exit code
- [x] #7 Runner registry pattern allows additional runners to be registered later without modifying core code
- [x] #8 Stub turbo test:vm task wired in turbo.json (no-op body acceptable for now)
- [x] #9 Package builds cleanly via `bun run build --filter @podkit/device-testing`
- [x] #10 Package is workspace-linked and importable from other packages
- [x] #11 README explains the purpose, package structure, and how new personas and system states are added
- [x] #12 package README cross-references agents/device-testing.md so implementers know where to find harness documentation
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decisions / divergences from the brief:

- ADR-017 references `DeviceReadiness` for `expectedReadiness`; the brief authoritatively says use `ReadinessResult`. `ReadinessResult` is the type that actually exists (and is re-exported as `@podkit/core`). Used `ReadinessResult`. The brief also pointed at "podkit-core" but the package's npm name is `@podkit/core` — imported from `@podkit/core`.
- `expectedDoctorOutput` typed as `type DoctorOutput = object` with a TODO referencing `packages/podkit-cli/src/commands/doctor.ts:85`, per the brief. `DoctorOutput` is not currently exported from anywhere.
- `SystemState` includes `schemaVersion` (per the brief AC #3 list and the ADR), even though the task file's own AC #3 omits it. Brief is authoritative.
- `SystemState` enum values use the ADR-017 richer variants (e.g. `ffmpeg: 'no-aac-encoder' | …`) since 321.06 will populate states that need those values; the brief's reduced shape (`'present' | 'missing'`) would have forced 321.06 to widen later.
- `local-linux` runner uses `spawn(..., { shell: true })` rather than `execFile`. This is what makes `run('echo hi')` work naturally (the brief explicitly allowed `spawn`). The `SubprocessRunner` interface (which takes a command + args array) uses `execFile` since args are tokenised there.
- Auto-registration of `local-linux` happens as a side-effect of importing `src/index.ts` (per brief AC #7 expansion). Bare imports of `./runners/local-linux.js` won't auto-register — by design.
- `personas` and `systemStates` are `Map<string, T>` (per brief AC #4) — the ADR shows record-style access (`personas['ipod-video-5g-fresh']`) but the brief is authoritative.
- Package depends on both `@podkit/core` and `@podkit/device-types`. This means anything that depends on `@podkit/device-testing` cannot be imported back into `@podkit/core` (cycle). Future Tier 1 callsites should import `@podkit/device-testing` only from test code, not production code in `@podkit/core`.

Files created:
- packages/device-testing/package.json
- packages/device-testing/tsconfig.json
- packages/device-testing/tsconfig.build.json
- packages/device-testing/bunfig.toml
- packages/device-testing/README.md
- packages/device-testing/test/preload.ts
- packages/device-testing/src/index.ts
- packages/device-testing/src/runtime.ts
- packages/device-testing/src/subprocess.ts
- packages/device-testing/src/personas/types.ts
- packages/device-testing/src/personas/index.ts
- packages/device-testing/src/system-states/types.ts
- packages/device-testing/src/system-states/index.ts
- packages/device-testing/src/runners/local-linux.ts
- packages/device-testing/src/runners/registry.ts
- packages/device-testing/src/runtime.test.ts

Files modified:
- turbo.json (added `@podkit/device-testing#test:vm` no-op task)
- bun.lock (workspace registration)
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Scaffolded the new `@podkit/device-testing` workspace package — the consolidated foundation that replaces the previously planned `device-fixtures` + `device-harness` split (per ADR-017).

Shipped:
- `DevicePersona` type (`src/personas/types.ts`) matching ADR-017 verbatim — USB descriptor, SCSI VPD payload, host-OS probe layers, partition layout, optional mass-storage backing file, expected capabilities/readiness/doctor output, provenance.
- `SystemState` type (`src/system-states/types.ts`) with ADR-017 enum richness (id, description, schemaVersion, ffmpeg, libgpod, udevRule, sgPermissions, configfs, expectedDoctorSystemOutput).
- Empty `personas` and `systemStates` `Map<string, …>` registries. Entries land in 321.02 / 321.06.
- `TestRuntime` interface + `RunnerId | RunOpts | RunResult` types in `src/runtime.ts`.
- `local-linux` runner (`src/runners/local-linux.ts`) — `isAvailable` reflects `process.platform === 'linux'`; `run` spawns via `node:child_process` with cwd/env/timeout support; captures stdout/stderr/exit/signal.
- Runner registry (`src/runners/registry.ts`) — `registerRunner`, `getRunner`, `listRunners`. `src/index.ts` auto-registers `local-linux` on import.
- `SubprocessRunner` interface + `defaultSubprocessRunner` (execFile-backed) in `src/subprocess.ts` — minimal placeholder so callsites can wire today; capture/replay lands in 321.04.
- `@podkit/device-testing#test:vm` no-op turbo task entry in repo-root `turbo.json` (discoverable, cache:false, outputs:[]).
- README cross-references ADR-016/017 and the future `agents/device-testing.md` (created in 321.08); covers package structure, the persona/system-state add workflows, and the Tier-3 turbo task placeholder.
- Smoke test (`src/runtime.test.ts`): empty-registry checks, auto-registered runner check, `isAvailable` host-platform parity, a Linux-only `run('echo hi')` assertion guarded by `it.skipIf`, and a `DevicePersona` literal-construction check proving the type is consumable.

Quality gates (all pass):
- `bun install` (workspace registered; lockfile updated)
- `bun run typecheck --filter @podkit/device-testing`
- `bun run build --filter @podkit/device-testing` — produces `dist/index.js` (~2.88KB) + `.d.ts` files cleanly
- `bun run test:unit --filter @podkit/device-testing` — 5 pass / 1 skip (Linux-only)
- `bunx oxlint packages/device-testing/` — 0 warnings, 0 errors
- prettier-clean
- Downstream importability verified by temporarily adding `@podkit/device-testing` as a dep of `@podkit/e2e-tests`, importing `DevicePersona` + `getRunner` + `personas` + `systemStates`, running `bun run typecheck --filter @podkit/e2e-tests` (pass), then removing the temp file and dep.

Reviewer nits folded in by team-lead before next phase: (1) escalate SIGTERM → SIGKILL after 5s grace in local-linux runner timeout; (2) widen `RunnerId` to admit arbitrary string IDs via `(string & {})` so 3rd-party runners register without core type widening; (3) added `getRunner('lima-test-vm')` undefined + `listRunners().length === 1` assertions; (4) deduplicated `DoctorOutput` re-export through `personas/index.ts`. All gates remain green: typecheck pass, 6 pass / 1 skip / 0 fail, build 3.1 KB clean.
<!-- SECTION:FINAL_SUMMARY:END -->
