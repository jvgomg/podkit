---
id: TASK-315
title: Roll out DeviceManager dependency injection across remaining handlers
status: To Do
assignee: []
created_date: '2026-05-08 16:28'
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
- [ ] #1 Every command handler that calls getDeviceManager() accepts a deps seam to override it
- [ ] #2 At least one in-process integration test per migrated handler proves no real USB walk happens
- [ ] #3 Production behaviour is unchanged (no JSON output changes; same exit codes)
- [ ] #4 Pattern documented in agents/testing.md alongside DeviceAddDeps
<!-- AC:END -->
