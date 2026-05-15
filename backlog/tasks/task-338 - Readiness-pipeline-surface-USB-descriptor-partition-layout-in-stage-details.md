---
id: TASK-338
title: 'Readiness pipeline: surface USB descriptor + partition layout in stage details'
status: Done
assignee: []
created_date: '2026-05-15 23:27'
updated_date: '2026-05-15 23:35'
labels:
  - readiness
  - diagnostics
  - polish
milestone: m-19
dependencies:
  - TASK-302
modified_files:
  - packages/podkit-core/src/device/types.ts
  - packages/podkit-core/src/device/platforms/linux.ts
  - packages/podkit-core/src/device/platforms/macos.ts
  - packages/podkit-core/src/device/readiness/index.ts
  - packages/podkit-core/src/device/readiness/__tests__/stage-matrix.test.ts
  - packages/podkit-core/src/device/platforms/linux.test.ts
priority: low
ordinal: 22600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surfaced by TASK-302's matrix-test sweep. Two small observability gaps in the readiness pipeline's stage `details` shape — JSON consumers can't see information that exists upstream.

## Gap 1: usb stage success path lacks vendor/product/usbModel

`packages/podkit-core/src/device/readiness/index.ts` (around the usb stage push) currently emits `{ identifier }` only on the pass path. Vendor ID, product ID, and the resolved `usbModel` ARE available — they're carried in `ReadinessResult.usbModel` at the result level and into stage details on the unsupported short-circuit path (`createUsbOnlyReadinessResult`).

**Inconsistency:** consumers reading `result.stages[0].details` see less info than consumers reading `result.usbModel` + the unsupported-path stage details. Mirror the unsupported-path push: emit `{ identifier, vendorId, productId, usbModel }` (or whichever fields the unsupported-path already populates) on the pass path too.

Anchors:
- `packages/podkit-core/src/device/readiness/index.ts` — locate the usb-stage push (search for `'usb'` push or `pushStage('usb', ...)`)
- `packages/podkit-core/src/device/readiness/index.ts:~218` — `createUsbOnlyReadinessResult`'s stage shape, the model to mirror

## Gap 2: partition stage layout is invisible inside the cascade

The partition stage is a passthrough inside `checkReadiness` because `findIpodDevices()` upstream filters to partitioned devices. Single- vs dual-partition layout isn't observable from inside the cascade today.

**Fix:** thread the partition layout through `PlatformDeviceInfo` (or whatever the platform-probe DTO is called) and emit `{ partitionCount, partitions: [{ index, filesystem, sizeBytes }] }` in the partition-stage details on the pass path. The data is already collected during host-OS probing — it just isn't carried into the stage push.

Anchors:
- `packages/podkit-core/src/device/platforms/linux.ts` / `macos.ts` — where partition info is enumerated; check what's already in `PlatformDeviceInfo`
- `packages/podkit-core/src/device/readiness/index.ts` — partition-stage push

## Test updates

`stage-matrix.test.ts` currently pins the gap as "pass-path details only carries identifier" / "partition layout invisible". Update those assertions to the new richer shape once these land. Mirror the existing test patterns in the matrix file.

## Out of scope

- Changing the partition-stage's pass/fail semantics — only the details shape.
- macOS-vs-Linux probe parity for fields that are platform-specific (e.g. macOS exposes a different volume-uuid structure than Linux). Document any deliberate asymmetry inline.

This unblocks Tier-3 assertions in TASK-302 + the doctor-display work that wants to render "iPod with single partition (FAT32, 32GB)" or similar.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 usb stage pass-path details emit { identifier, vendorId, productId, usbModel } — matching the unsupported-path shape
- [x] #2 partition stage pass-path details emit { partitionCount, partitions: [{ index, filesystem, sizeBytes }] } sourced from platform probe
- [x] #3 Existing unsupported-path stage shape is unchanged (no regression for rejection personas)
- [x] #4 stage-matrix.test.ts assertions updated from the current pinned-gap shape to the new richer shape
- [x] #5 macOS vs Linux probe asymmetries documented inline where they exist
- [x] #6 Existing readiness + doctor + device-scan tests remain green
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**TASK-338 landed 2026-05-16.** Both observability gaps surfaced by TASK-302's matrix sweep are closed.

**Type-shape changes (`packages/podkit-core/src/device/types.ts`)**
- `PlatformDeviceInfo` widened with two additive optional fields:
  - `filesystem?: string` — per-partition fs string (Linux: `fstype`; macOS: "File System Personality" or "Type (Bundle)").
  - `partitionLayout?: PartitionLayout` — whole-disk layout, shared by every sibling `PlatformDeviceInfo` on the same disk.
- New `PartitionLayout` + `PartitionLayoutEntry` interfaces. Entry shape: `{ index, filesystem, sizeBytes, identifier?, volumeUuid? }` — mirrors `DevicePersona.partitionLayout` but uses OS-probe field names (`filesystem`, `sizeBytes`) rather than the persona's higher-level labels (`type`, `sizeMiB`).
- `ReadinessStageResult.details` was already `Record<string, unknown>`; no widening needed.

**Platform probe wiring**
- `parseLsblkJson` (Linux) refactored to walk the lsblk tree disk-first so it can build one `PartitionLayout` per whole disk and attach the same payload to every surfaced sibling. Top-level "part" entries (rare; some lsblk invocations) get a synthetic single-partition layout. Loop-device children are still skipped (virtual iPod server bookkeeping).
- macOS `listDevices()` calls a new `attachMacPartitionLayouts()` after building per-partition entries — groups by stripped whole-disk id (`disk5s2` → `disk5`), sorts by trailing slice number, and shares one layout payload across siblings. `getPlatformDeviceInfo()` now also captures `filesystem` from "File System Personality" / "Type (Bundle)".

**Readiness pipeline (`readiness/index.ts`)**
- usb-stage pass-path push now mirrors the unsupported-path shape: `{ identifier, vendorId, productId, usbModel }` (omits each field when its source — `usbConnection` / `usbModel` — is absent, so legacy callers don't see `undefined` placeholders in JSON).
- partition-stage pass-path push routed through new `buildPartitionStageDetails()` helper. Emits `{ identifier, partitionCount, partitions: [...] }` when `partitionLayout` is present, falls back to the historical `{ identifier }` shape when it isn't (preserves contract for synthesised `PlatformDeviceInfo`).
- Unsupported short-circuit shape unchanged — no regression for rejection personas.

**Documented platform asymmetries (inline at the source)**
- Linux `lsblk` surfaces the kernel's full partition table (firmware partitions, unformatted slices); macOS `diskutil list` enumerates user-visible partitions only. `partitionCount` semantics differ accordingly — documented at `buildPartitionStageDetails`, `attachMacPartitionLayouts`, and the `PartitionLayout` type.
- `filesystem` string format differs (Linux: `"vfat"`, `"hfsplus"`; macOS: `"MS-DOS FAT32"`, `"Apple_HFS"`). Documented at `PartitionLayoutEntry.filesystem` and `PlatformDeviceInfo.filesystem`.

**Test updates**
- `stage-matrix.test.ts`: AC #1 assertion flipped from "identifier-only" to the new four-field shape; new test pins the no-USB-metadata fallback. AC #4 split into three tests: single-partition layout, dual-partition layout (firmware + FAT32), and the legacy fallback. Header comment updated to mark both findings as "Resolved by TASK-338". Net +3 tests (34 → 37).
- `linux.test.ts` "parses a single partition with all fields" updated to assert the new `filesystem` + `partitionLayout` fields.

**Quality gates**
- `bun test packages/podkit-core/src/device/readiness/__tests__/stage-matrix.test.ts` — 37 pass, 0 fail, 128 expects.
- `bun run test --filter @podkit/core --filter podkit --filter @podkit/device-testing` — all green (2643 pass, 1 skip, 0 fail).
- `bunx tsc --noEmit` in `packages/podkit-core` and `packages/podkit-cli` — clean.
- `bunx oxlint` on all six changed files — 0 warnings, 0 errors.

**Files touched**
- `packages/podkit-core/src/device/types.ts` (PlatformDeviceInfo widening + new types)
- `packages/podkit-core/src/device/platforms/linux.ts` (parseLsblkJson refactor + filesystem)
- `packages/podkit-core/src/device/platforms/macos.ts` (attachMacPartitionLayouts + filesystem)
- `packages/podkit-core/src/device/readiness/index.ts` (usb + partition stage details)
- `packages/podkit-core/src/device/readiness/__tests__/stage-matrix.test.ts` (flipped assertions + new cases)
- `packages/podkit-core/src/device/platforms/linux.test.ts` (updated existing assertion)

**TASK-302 implementation notes also updated** — findings 1 + 2 now annotated "Now closed by TASK-338, 2026-05-16". TASK-302's ACs untouched (already marked covered with documented gaps).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Closed both observability gaps surfaced by TASK-302's matrix sweep:

1. **usb stage pass-path** now emits `{ identifier, vendorId, productId, usbModel }` — mirroring the unsupported-path shape — so JSON consumers see the same info regardless of which branch fires.
2. **partition stage pass-path** now emits `{ partitionCount, partitions: [{ index, filesystem, sizeBytes, identifier?, volumeUuid? }] }` sourced from `PlatformDeviceInfo.partitionLayout`. The layout is populated by the platform probe (`lsblk -J` on Linux, `diskutil list -plist` on macOS) during `listDevices()` so the readiness pipeline threads it verbatim — no re-probing.

`PlatformDeviceInfo` widened additively with `filesystem?` + `partitionLayout?` (and new `PartitionLayout` / `PartitionLayoutEntry` types). Unsupported short-circuit shape unchanged (no rejection-persona regressions). Platform asymmetries documented inline:
- Linux surfaces the kernel's full partition table; macOS surfaces user-visible partitions only.
- Filesystem string formats differ (`"vfat"` vs `"MS-DOS FAT32"`); treated as opaque.

Net +3 tests in `stage-matrix.test.ts` (34 → 37). All quality gates green.
<!-- SECTION:FINAL_SUMMARY:END -->
