---
id: TASK-316
title: Split device.ts into per-subcommand files
status: To Do
assignee: []
created_date: '2026-05-08 16:44'
labels:
  - tech-debt
  - cli
  - refactor
dependencies: []
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`packages/podkit-cli/src/commands/device.ts` is ~4744 lines and contains 15 subcommands plus shared helpers. Pure organisation: navigability is poor, AGENTS-style per-subcommand documentation is harder, and per-subcommand test files have to import from one giant module.

## Goal

```
packages/podkit-cli/src/commands/device/
├── index.ts              # composes deviceCommand from subcommands
├── shared.ts             # getStorageInfo, formatSyncTagSummary, findConfiguredDeviceName, getDevicePrefix, attemptSysInfoExtended, formatIFlashEvidence, formatIFlashMountExplanation, etc.
├── output-types.ts       # DeviceListOutput, DeviceAddOutput, DeviceRemoveOutput, … (one re-exported barrel)
├── scan.ts               # ~286 lines (scanSubcommand)
├── list.ts               # ~192 lines (listSubcommand)
├── add.ts                # ~960 lines — addSubcommand + AddOptions + DeviceAddDeps + runDeviceAdd
├── remove.ts             # ~70 lines
├── info.ts               # ~515 lines
├── music.ts              # ~172 lines
├── video.ts              # ~182 lines
├── clear.ts              # ~243 lines
├── reset.ts              # ~187 lines
├── eject.ts              # ~130 lines
├── mount.ts              # ~222 lines
├── init.ts               # ~296 lines
├── set.ts                # ~291 lines
├── default.ts            # ~155 lines
└── model.ts              # ~120 lines
```

`commands/device.ts` becomes a thin re-export of `device/index.ts` so existing `import ... from './commands/device.js'` paths keep working.

## Subcommand boundaries (line numbers as of 2026-05-08)

- 1071–1357 scan
- 1361–1553 list
- 1601–2559 add (includes `runDeviceAdd` extracted in the test refactor)
- 2563–2633 remove
- 2637–3152 info
- 3164–3336 music
- 3340–3522 video
- 3532–3775 clear
- 3784–3971 reset
- 3971–4096 eject
- 4096–4318 mount
- 4318–4614 init
- 4614–4905 set
- 4905+ default
- … model

## Approach

Recommend going subcommand-by-subcommand in separate commits on a single branch:

1. Create `device/shared.ts` and move private helpers (`formatIFlashEvidence`, `formatIFlashMountExplanation`, `attemptSysInfoExtended`, `getDevicePrefix`, etc.). Keep exports stable.
2. For each subcommand, create `device/<name>.ts` with the subcommand constant + its action body + its types. The output `*Output` interfaces live in `device/output-types.ts` (or co-located in each file and re-exported).
3. After each move, update `commands/device.ts` to import + addCommand from the new file.
4. Final commit: collapse `commands/device.ts` to a barrel re-export.

## Risks

- Shared helpers exported from `device.ts` and used elsewhere (`getStorageInfo`, `formatBytes`, `findConfiguredDeviceName`, `findUndetectedDevices`, `sortDevicesForDisplay`, `redactPaths`, `formatSyncTagSummary`) need to be re-exported from the barrel so existing imports keep working.
- The action callbacks reference each other in places — verify after each move with `bun run test:unit --filter podkit`.
- Test files import `runDeviceAdd` and `DeviceAddDeps` from `device.js`; barrel re-export covers them.

## Why a separate task

Pure mechanical refactor with significant diff. Doing it alongside the test-architecture refactor (refactor/cli-test-architecture branch) would balloon a focused review. Best landed as its own incremental PR after the test refactor merges.

## References

- packages/podkit-cli/src/commands/device.ts
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 device.ts becomes a thin barrel re-exporting from device/
- [ ] #2 Each subcommand lives in its own file under packages/podkit-cli/src/commands/device/
- [ ] #3 Shared helpers move to device/shared.ts; their public exports are preserved via the barrel
- [ ] #4 All existing imports across the repo (including test files) continue to work without per-call-site changes
- [ ] #5 bun run test:unit, test:integration, test:e2e all pass
- [ ] #6 No behaviour change — pure organisation
<!-- AC:END -->
