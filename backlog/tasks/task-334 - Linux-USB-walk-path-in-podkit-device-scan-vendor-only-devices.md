---
id: TASK-334
title: 'Linux: USB-walk path in podkit device scan (vendor-only devices)'
status: Done
assignee: []
created_date: '2026-05-14 22:37'
updated_date: '2026-05-14 22:57'
labels:
  - device-scan
  - usb
  - linux
  - vm-coverage
milestone: m-19
dependencies: []
modified_files:
  - packages/podkit-cli/src/commands/device/scan.ts
  - packages/podkit-cli/src/commands/device/output-types.ts
  - packages/podkit-cli/src/commands/device-scan.unit.test.ts
  - packages/device-testing/src/tier3/personas-baseline.tier3.test.ts
  - packages/podkit-core/src/device/platforms/linux.ts
priority: medium
ordinal: 21800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`podkit device scan` on Linux iterates `lsblk` output only — so devices that present a USB vendor descriptor but no block-device path (Apple's iPod 6th gen restore-mode, the FunctionFS-synthesised personas before they mount a backing image, etc.) never appear in scan output. A separate USB-walk path is needed so AC #4 of TASK-322 (Tier 3 tests synthesise at least 3 starter personas as real USB devices and existing discoverUsbIpods + identify + inquireFirmware paths see them as the right device type) reads strictly.

Today the Tier-3 suite's `device scan` assertion uses an `lsusb` cross-check as a stopgap — the assertion documents this in a TODO that this task is meant to remove.

**Design sketch:**

The existing `discoverUsbIpods()` in `@podkit/ipod-firmware` already enumerates Apple-vendor USB devices via `libusb`. The gap is in `packages/podkit-core/src/device/platforms/linux.ts` (`findIpodDevices` or equivalent) which only walks `lsblk`. Add a parallel USB-walk that:

1. Calls `discoverUsbIpods()` (already injectable via `UsbBinding`)
2. For each USB device, joins with `lsblk` output where a block path exists; emits both layers
3. Resolves capabilities for USB-only devices through the existing `resolve-capabilities.ts` path — the device-types layer doesn't need to know whether a block path exists

Output schema: `device scan --format json` adds an optional `usbOnly: true` flag (or omits the `mountPoint` field) so consumers can distinguish.

**Cross-references:**
- `packages/podkit-core/src/device/platforms/linux.ts` — current `lsblk`-only path
- `packages/ipod-firmware/src/inquiry/usb.ts` — USB binding + descriptor walk
- `packages/podkit-core/src/device/resolve-capabilities.ts` — capability resolution from descriptors
- `packages/device-testing/src/tier3/personas-baseline.tier3.test.ts` — has the TODO that this task removes
- ADR-016 §"Builder/test VM split" — context for why this matters in Tier 3

**Tests:**
- Tier-1: inject a `UsbBinding` fake that returns a synthetic Apple device with no matching `lsblk` entry; assert `device scan --format json` includes it.
- Tier-3: replace the existing `lsusb`-cross-check TODO in `personas-baseline.tier3.test.ts` with a direct vendor/product assertion on `device scan` output.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 packages/podkit-core/src/device/platforms/linux.ts gains a USB-walk path that joins discoverUsbIpods() output with lsblk output
- [x] #2 `podkit device scan --format json` returns USB-only devices (no block-device path) alongside block-device devices; consumers can distinguish (e.g. via `usbOnly: true` or `mountPoint: null`)
- [x] #3 Capability resolution works for USB-only devices via the existing resolve-capabilities path
- [x] #4 Tier-1 unit test with injected UsbBinding fake covers the USB-only path
- [x] #5 personas-baseline.tier3.test.ts replaces its lsusb-cross-check TODO with a direct vendor/product assertion against `device scan` output
- [x] #6 macOS scan path is unchanged (system_profiler / diskutil) — this is Linux-only
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

### Schema decision: `usbOnly: true` + `usbDescriptor`

The JSON envelope from `podkit device scan --format json` now includes USB-only iPods in the `devices` array, distinguishable by:

- `usbOnly: true` (absent for block-device-bound entries)
- `mountPoint` absent
- `identifier === ''`, `volumeUuid === ''`, `size === 0` (legitimate "no block device" sentinels — extending these to `null` would have required updating every existing consumer's narrowing)
- `usbDescriptor: { vendorId, productId, serialNumber? }` populated with bare lower-case hex (`UsbFingerprint` canonical form)

Block-device-bound iPods also gain an optional `usbDescriptor` when the USB walk found a matching descriptor — same shape, lets downstream consumers always reach for the descriptor without branching on `usbOnly`.

### Architectural placement

The task description placed the USB walk in `linux.ts`, but the production code's USB walk already lives in `packages/podkit-core/src/device/usb-enumeration.ts` (`enumerateUsb`, which on Linux reads `/sys/bus/usb/devices/` directly — no `UsbBinding` from `ipod-firmware`; that one is for libusb control transfers, not enumeration). The join between USB-walk output and `lsblk` already happens in `packages/podkit-cli/src/commands/device/scan.ts` via `findMatchingUsbIpod` and `usbOnlyIpods`. The gap closed by this task was purely the JSON surface: the `usbOnlyIpods` list was rendered as text but not emitted into the `devices` array.

A docstring in `linux.ts` now cross-references `usb-enumeration.ts` so future readers find the connection.

### Files touched

- `packages/podkit-cli/src/commands/device/scan.ts` — emit USB-only iPods into the JSON `devices` array; attach `usbDescriptor` to block-device entries when a USB join exists
- `packages/podkit-cli/src/commands/device/output-types.ts` — extend `DeviceScanSuccess.devices[]` with `usbOnly?: boolean`, `usbDescriptor?`, `notSupportedReason?`; add `DeviceScanUsbDescriptor` interface
- `packages/podkit-cli/src/commands/device-scan.unit.test.ts` — Tier-1 unit test asserting USB-only inclusion + descriptor + model surfaces in the JSON envelope (AC #4)
- `packages/device-testing/src/tier3/personas-baseline.tier3.test.ts` — replace the `lsusb -d <vendor>:<product>` cross-check stopgap with a direct vendor/product assertion against `podkit device scan --format json` output (AC #5)
- `packages/podkit-core/src/device/platforms/linux.ts` — docstring cross-reference to `usb-enumeration.ts` so the USB-walk path is discoverable from `linux.ts` (AC #1)

### Capability resolution (AC #3)

Capability resolution already works for USB-only devices via the existing `resolve-capabilities.ts` path — `createUsbOnlyReadinessResult` (in `@podkit/core`) builds the readiness pipeline for USB-only iPods using the USB descriptor as the identity source, and `identifyCapabilities(model, …)` accepts the resolved `IpodModel` directly. No changes were needed to that path; the test asserts it round-trips through `--format json`.

### Quality gates

- `bunx tsc --noEmit -p packages/podkit-core/tsconfig.json` — clean
- `bunx tsc --noEmit -p packages/podkit-cli/tsconfig.json` — clean
- `bunx tsc --noEmit -p packages/device-testing/tsconfig.json` — clean
- `bunx oxlint packages/podkit-core/src packages/device-testing/src/tier3/ packages/podkit-cli/src/commands/device/ …` — clean (one pre-existing warning in `mass-storage-tag-writer.ts` unrelated to this task)
- `bun run test:unit --filter @podkit/core --filter @podkit/device-testing --filter podkit` — 1193 pass, 0 fail
- `bun run test:integration --filter @podkit/core --filter podkit` — 67 pass, 0 fail

### Deferred to live-VM verification

- AC #5 strictly verifies in the Tier-3 VM environment with FunctionFS personas live. The assertion change itself is verified at compile time (typecheck) and at unit-test level (AC #4 exercises the JSON shape).

### macOS impact (AC #6)

`macos.ts` is unchanged. The JSON envelope changes are additive (new optional fields); existing macOS consumers continue to receive the historical block-device-bound shape. macOS's `system_profiler` USB walk already feeds `enumerateUsb`, so when an Apple-vendor USB-only device appears on macOS the same code path will surface it — schema parity is a free win, but the behaviour change there is out of scope for this task.
<!-- SECTION:NOTES:END -->
