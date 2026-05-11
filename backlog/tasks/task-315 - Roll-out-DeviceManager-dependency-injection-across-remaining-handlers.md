---
id: TASK-315
title: Roll out DeviceManager dependency injection across remaining handlers
status: Done
assignee: []
created_date: '2026-05-08 16:28'
updated_date: '2026-05-11 19:34'
labels:
  - tech-debt
  - cli
  - testability
dependencies: []
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`getDeviceManager()` from `@podkit/core` is a process-singleton that constructs a real macOS / Linux / unsupported manager on first call. The `device add` runner now accepts a `DeviceAddDeps.getDeviceManager` seam so tests can pass a fake (`packages/podkit-cli/src/commands/device.ts`, see `runDeviceAdd`). Every other command that touches device discovery still calls `getDeviceManager()` through the singleton.

## Affected handlers

Search: `grep -rn "getDeviceManager()" packages/podkit-cli/src --include="*.ts"`. As of 2026-05-08, callers include:
- `device.ts:1107` (scan subcommand)
- `device.ts:1389` (list subcommand)
- `device.ts:2018` (info subcommand)
- `device.ts:2196` (remove subcommand related)
- `device.ts:2810` (music/video display)
- `device.ts:4441` (mount/eject)
- `sync.ts:780` (resolveSyncTarget)
- `mount.ts`, `eject.ts`
- Likely others — audit before scoping.

Each currently makes its handler hard to test in-process: the singleton attempts a real platform USB walk on instantiation.

## Goal

Per-handler runner extraction with a deps seam, mirroring `runDeviceAdd`:

```ts
export interface XHandlerDeps {
  getDeviceManager?: () => DeviceManager;
  loadCore?: () => Promise<typeof import('@podkit/core')>;
  confirm?: (msg: string) => Promise<boolean>;
}
```

Default to real implementations; tests inject fakes. Production behaviour unchanged.

## Why a separate task

This is a wide refactor across ~10 handlers with one consistent pattern. Doing it incrementally per-handler in subsequent PRs is safer than one mega-PR. Each handler extraction unlocks an in-process integration test for that command and removes a `device.integration.test.ts`-style reliance on real fixtures or careful test ordering.

## Suggested order (cheapest first)

1. `eject` and `mount` — small handlers, isolated effect
2. `device list`, `device info`, `device scan` — read-only operations
3. `sync` — biggest payoff, also the most complex; do last when the pattern is solid

Pair each with one in-process integration test that proves the seam works (no subprocess, no real USB).

## References

- packages/podkit-cli/src/commands/device.ts — see `runDeviceAdd` and `DeviceAddDeps`
- packages/podkit-cli/src/test-utils/buffer-sink.ts — output capture helper
- packages/podkit-cli/src/context.ts — `runWithContext` for scoped CliContext in tests
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every command handler that calls getDeviceManager() accepts a deps seam to override it
- [x] #2 At least one in-process integration test per migrated handler proves no real USB walk happens
- [x] #3 Production behaviour is unchanged (no JSON output changes; same exit codes)
- [x] #4 Pattern documented in agents/testing.md alongside DeviceAddDeps
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary

Rolled out DeviceManager dependency injection across every CLI handler that previously called `getDeviceManager()` via the process singleton. Each runner now accepts a `XDeps` seam letting tests inject fakes — no real USB walk happens in unit tests.

## Foundation

- `packages/podkit-cli/src/handler-deps.ts` — new module with `CoreLoaderDeps` base interface and `loadCoreOrFail(deps, code)` helper. Centralises the `try/catch + throw CliError({ code: *_CORE_LOAD_FAILED })` boilerplate that was previously duplicated at 9 sites.
- `packages/podkit-cli/src/handler-deps.unit.test.ts` — tests for the helper.

## Migrated handlers

Every CLI handler that touches device discovery now has an exported runner + `XDeps` seam:

- `runEject` / `EjectDeps` — `commands/eject.ts`
- `runMount` / `MountDeps` — `commands/mount.ts` (already extracted; added the seam)
- `runDeviceScan` / `DeviceScanDeps` — `commands/device.ts`
- `runDeviceList` / `DeviceListDeps` — `commands/device.ts` (uses `deps.loadCore` directly — soft-fail behaviour preserved)
- `runDeviceInfo` / `DeviceInfoDeps` — `commands/device.ts`
- `runDeviceMusic` / `runDeviceVideo` — `commands/device.ts`
- `runDeviceClear` / `runDeviceReset` / `runDeviceInit` / `runDeviceResetArtwork` (share `DeviceIpodOpDeps`) — `commands/device.ts`
- `runDeviceEject` / `runDeviceMount` — `commands/device.ts` (the device subcommand variants, kept separate from the root commands because their prompt text diverges)
- `runDoctorDiagnostics` / `resolveDevice` (internal) — `commands/doctor.ts`. Note: `resolveDevice` keeps its `{ error }` return shape and does NOT use `loadCoreOrFail` per the sonnet review's flag.
- `runSync` / `SyncDeps` — `commands/sync.ts`

## Tests

New in-process integration tests for every migrated runner — none of them perform a real USB walk:

- `eject.unit.test.ts`, `mount.unit.test.ts`
- `device-scan.unit.test.ts`, `device-list.unit.test.ts`, `device-info-runner.unit.test.ts`
- `device-music-video.unit.test.ts`, `device-ipod-ops.unit.test.ts`
- `sync-runner.unit.test.ts`
- `handler-deps.unit.test.ts`

Full podkit-cli suite: 1187 pass / 0 fail. `bun run test:unit` workspace-wide: 1120 pass / 0 fail. No new tsc errors over the pre-existing baseline (2 unrelated errors in `error-codes.test.ts`).

## What was intentionally NOT added (per Sonnet review)

- No `requireMountedDevicePath` helper — call sites diverge enough (different label derivation, different `printText` bodies, some include `details:`/some don't) that a single helper would be a Procrustean fit.
- No `HandlerDeps` base type — `DeviceAddDeps` already carries handler-specific fields (`assessIdentity`, `ipodDatabase`); a shared base would be 2 fields wide.

## Pattern doc

`agents/testing.md` now has a "deps seam, in detail" section under "Writing CLI Unit and Integration Tests" covering `CoreLoaderDeps`, `loadCoreOrFail`, the throw-vs-soft-fail distinction (with `runDeviceList` and `doctor.resolveDevice` as examples), and links to every new test file as worked references.
<!-- SECTION:FINAL_SUMMARY:END -->
