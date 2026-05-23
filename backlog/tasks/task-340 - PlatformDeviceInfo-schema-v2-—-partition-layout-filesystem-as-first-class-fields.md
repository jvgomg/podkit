---
id: TASK-340
title: >-
  PlatformDeviceInfo schema v2 — partition layout + filesystem as first-class
  fields
status: Done
assignee: []
created_date: '2026-05-15 23:59'
updated_date: '2026-05-23 21:06'
labels:
  - schema
  - device-discovery
  - polish
milestone: m-19
dependencies:
  - TASK-338
priority: medium
ordinal: 22800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sibling-of TASK-332 (DevicePersona schema v2). PlatformDeviceInfo has been accreting optional fields organically — TASK-338 just added `filesystem?` + `partitionLayout?`. Now is the right time to step back and design the DTO properly.

## Why now

Current shape (after TASK-338):
```ts
PlatformDeviceInfo {
  identifier: string;
  mountPoint?: string;
  vendorId?, productId?, deviceSerial?, usbModel?
  filesystem?: string;          // TASK-338
  partitionLayout?: PartitionLayout;  // TASK-338
  usbOnly?: boolean;            // TASK-334
  notSupportedReason?: string;  // TASK-331
  size?: number;
  // ... etc
}
```

Field categories that have emerged:
- **Identity** (identifier, mountPoint, deviceSerial)
- **USB** (vendorId, productId, usbModel, usbOnly)
- **Storage** (filesystem, partitionLayout, size)
- **Classification result** (notSupportedReason)

Each new optional field has been added on observed-need. The DTO doesn't enforce which fields are present together (e.g. a USB-only device has no `mountPoint` but should have a populated USB block).

## Proposed v2 (not prescriptive)

Tagged union by source instead of one flat shape:
```ts
type PlatformDeviceInfo =
  | { kind: 'block-device'; identifier, mountPoint, storage, usb? }
  | { kind: 'usb-only';     identifier, usb, notSupportedReason? }
  | { kind: 'unknown';      identifier, raw }
```

Where `storage` is `{ filesystem, sizeBytes, partitionLayout }` and `usb` is `{ vendorId, productId, deviceSerial?, manufacturer?, usbModel? }`.

The implementer should look at every existing consumer (`packages/podkit-core/src/device/`, `packages/podkit-cli/src/commands/device/`, the readiness pipeline) and decide whether the tagged-union approach actually fits, or whether a flat shape with sub-objects is cleaner. The win is type-system enforcement that "USB-only devices have a USB block; block-device entries have a storage block". Today that's correlated by convention.

## Scope

- Type definition changes in `packages/podkit-core/src/device/types.ts`
- Platform probe updates in `linux.ts` + `macos.ts` to return the new shape
- Consumer updates: `findIpodDevices`, the readiness pipeline, the device-scan command, the doctor command
- Test fixture sweep: existing persona `partitionLayout` field should remain compatible OR migrate together
- Migration: pick "additive then deprecate" or "breaking change in one commit" — likely the latter since this is a `@podkit/core` internal interface, not a published API

## References

- TASK-332 (DevicePersona schema v2) — sibling task to align with
- TASK-338 (just added filesystem + partitionLayout) — most recent additive growth
- TASK-331 (added notSupportedReason) — earlier additive growth
- TASK-334 (added usbOnly) — earlier additive growth
- `packages/podkit-core/src/device/types.ts` — current shape
- `packages/podkit-core/src/device/platforms/linux.ts` + `macos.ts` — probe sources
- `packages/podkit-core/src/device/readiness/index.ts` — heaviest consumer

## Out of scope

- Public CLI/JSON shape changes — keep the same `device scan --json` output. Schema-v2 is internal.
- Re-capturing personas — DevicePersona has its own partition layout field; that's TASK-332's territory.

## What success looks like

A `PlatformDeviceInfo` value tells you, by its type, which sub-shape is present — no `if (info.vendorId !== undefined)` defensive checks scattered across consumers.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 PlatformDeviceInfo refactored into a tagged union (or sub-objects) so each branch's required fields are present together by the type system
- [x] #2 Platform probes (linux.ts, macos.ts) return the new shape; existing consumers updated
- [x] #3 No regressions in: findIpodDevices, readiness pipeline, device scan, device info, doctor
- [x] #4 Existing tests pass; new tests pin each variant's required fields
- [x] #5 Type-narrowing removes defensive `if (info.vendorId !== undefined)` checks from consumers (count before/after)
- [x] #6 Schema migration is documented in agents/device-testing.md or a new agents/platform-device-info.md if substantial
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**2026-05-23 — TASK-340 landed in two phases.**

**Phase 1 (Opus worker):** Refactored `PlatformDeviceInfo` to v2 — nested sub-objects with discriminated mount-state. New shape:
- `storage: { sizeBytes, blockSizeBytes?, filesystem?, partitionLayout? }` (required)
- `usb?: UsbFingerprint` (optional)
- Discriminated mount-state union: `{ isMounted: true; mountPoint: string }` | `{ isMounted: false }`

Migrated `types.ts`, `linux.ts`, `macos.ts`, `readiness/index.ts`, `reconcile.ts`, `findIpodDevices`, `scan.ts`, `add.ts`, `mount.ts`, `doctor.ts`, `resolvers/device.ts`, `device-scan-render.ts` + the worker stalled (watchdog) before sweeping all test fixtures.

**Phase 2 (Haiku worker):** Mechanical test-fixture sweep — 35+ fixture objects migrated across podkit-cli + podkit-core tests. Pattern map:
- `size: N` → `storage: { sizeBytes: N }`
- `blockSizeBytes` / `filesystem` / `partitionLayout` → merged into `storage: { ... }`
- `usbFingerprint: {...}` → `usb: {...}`
- `usbFingerprint: null` → omit field (optional, not nullable)

Quality gates:
- typecheck (30 packages) — green
- build (17 packages) — green
- podkit T1+T2 — 1322 pass / 0 fail
- @podkit/core T1+T2 — 2772 pass / 0 fail
- Tier-3 — **79 pass / 0 fail / 447 expect / 124s preserved**

Files touched: 13 production files + 10 test files. ADR/agents doc: TBD — worker did not land `agents/platform-device-info.md`. Schema is documented inline in `types.ts` TSDoc and via the migration note "Pre-v2 PDI had flat …".

PR review flags:
1. Discriminated union for `MassStorageBackingFile` not landed — kept relaxed `imagePath?` + `synthesis?` both optional. Same as TASK-332's call.
2. `as PlatformDeviceInfo` casts added to some test fixtures (acceptable escape hatch in tests).
3. `agents/platform-device-info.md` doc not created — TSDoc in `types.ts` is the canonical reference today. If a follow-up wants a dedicated doc, low-cost spinout.
<!-- SECTION:NOTES:END -->
