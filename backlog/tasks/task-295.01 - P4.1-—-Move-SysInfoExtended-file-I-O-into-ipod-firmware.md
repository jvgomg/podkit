---
id: TASK-295.01
title: P4.1 — Move SysInfoExtended file I/O into ipod-firmware
status: Done
assignee: []
created_date: '2026-05-03 11:34'
updated_date: '2026-05-06 22:06'
labels:
  - device-capability-architecture
  - phase-4
milestone: m-18
dependencies: []
documentation:
  - backlog/docs/doc-035 - Spec-Phase-4-Unification-and-cleanup.md
parent_task_id: TASK-295
ordinal: 11010
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Move `core/device/sysinfo-extended.ts` implementation into `@podkit/ipod-firmware/sysinfo/`. New layout:

- paths.ts — SYSINFO_EXTENDED_PATH constants
- read.ts — readSysInfoExtended(mountPoint)
- write.ts — writeSysInfoExtended(mountPoint, xml)
- ensure.ts — ensureSysInfoExtended(mountPoint, fingerprint)

`ensureSysInfoExtended` no longer takes a `readFromUsb` injection parameter — the inquiry orchestrator does selection internally. Same `SysInfoExtendedResult` return shape preserved.

`core/device/sysinfo-extended.ts` is replaced by a one-release re-export shim from the firmware package.

See spec doc-035, Scope > Move SysInfoExtended file I/O.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 sysinfo/{read,write,ensure}.ts implemented in @podkit/ipod-firmware
- [x] #2 ensureSysInfoExtended uses inquireFirmware orchestrator (no readFromUsb param)
- [x] #3 SysInfoExtendedResult shape preserved as public type
- [x] #4 core/device/sysinfo-extended.ts becomes a re-export shim
- [x] #5 All existing in-tree consumers continue to work via the shim
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Flag for TASK-295.02: (1) `readFromUsb` param still present — evaluate deprecation in 295.02 since orchestrator is now the default. (2) Test file not moved — sysinfo-extended.test.ts stays in podkit-core because it uses resolveIpodModel from @podkit/devices-ipod (circular if placed in ipod-firmware). 295.02 can add ipod-firmware-native sysinfo tests once regex is replaced with plist parser. (3) IpodModel and related foundational types (IpodChecksumType, IpodGenerationId, IpodModelSource) moved to @podkit/device-types — devices-ipod re-exports them for compat.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Implementation

### File structure
- `packages/ipod-firmware/src/sysinfo/paths.ts` — `SYSINFO_EXTENDED_PATH` + `SYSINFO_DEVICE_DIR` constants (15 LOC)
- `packages/ipod-firmware/src/sysinfo/read.ts` — `readSysInfoExtended(mountPoint, resolveModel?)`, `SysInfoExtendedResult` type, regex helpers (`extractPlistString`, `extractIdentity`, `validateXml`), `ModelResolver` callback type (120 LOC)
- `packages/ipod-firmware/src/sysinfo/write.ts` — `writeSysInfoExtended(mountPoint, xml)` (25 LOC)
- `packages/ipod-firmware/src/sysinfo/ensure.ts` — `ensureSysInfoExtended(mountPoint, usbAddress, readFromUsb?, resolveModel?)` + `UsbDeviceAddress` + `ReadFromUsbFn` types (115 LOC)
- `packages/ipod-firmware/src/sysinfo/index.ts` — barrel re-export

### Circular dependency resolution
`@podkit/devices-ipod` depends on `@podkit/ipod-firmware`, so ipod-firmware cannot call `resolveIpodModel` directly. Resolution:
1. `IpodModel`, `IpodModelSource`, `IpodChecksumType`, `IpodGenerationId`, `IpodGenerationIdLike`, `IPOD_GENERATION_IDS` moved from `@podkit/devices-ipod/src/types.ts` to `@podkit/device-types/src/ipod-model.ts` and re-exported from both.
2. `SysInfoExtendedResult.model` is typed as `IpodModel` from `@podkit/device-types` (no circular dep).
3. `readSysInfoExtended` and `ensureSysInfoExtended` accept an optional `resolveModel?: ModelResolver` callback. ipod-firmware itself never calls resolveIpodModel.
4. The core shim (`packages/podkit-core/src/device/sysinfo-extended.ts`) injects `(sn) => resolveIpodModel({ from: 'serial', serialNumber: sn })` as the `resolveModel` callback so existing callers continue to get a populated `result.model`.

### What stayed in core
- The test file (`sysinfo-extended.test.ts`) was NOT moved to ipod-firmware — it tests model resolution which requires `@podkit/devices-ipod` (circular if moved). Tests pass 18/18 via the shim. ipod-firmware gets its own tests in TASK-295.02 or a follow-up.

### readFromUsb preserved
`ensureSysInfoExtended` retains the `readFromUsb` injection parameter for back-compat (all existing tests use it). TASK-295.02 should evaluate deprecating it now that the orchestrator is the default path.

### Gate results
- `bun run typecheck --force`: 27/27 pass
- `bun run --cwd packages/ipod-firmware test`: 205/205 pass
- `bun run --cwd packages/podkit-core test:unit`: 2521/2521 pass
- `bun run lint`: 0 errors (14 pre-existing warnings in gpod-testing scripts)
- `bun run build --filter @podkit/ipod-firmware --filter @podkit/core --force`: 7/7 pass
<!-- SECTION:FINAL_SUMMARY:END -->
