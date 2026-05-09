---
id: TASK-317.01
title: >-
  Refactor USB enumeration: separate enumeration / classification / rendering
  layers
status: To Do
assignee: []
created_date: '2026-05-09 15:18'
updated_date: '2026-05-09 17:23'
labels:
  - safety
  - architecture
  - refactor
  - device-scan
milestone: m-18
dependencies: []
parent_task_id: TASK-317
priority: high
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The phantom-device scan bug surfaced during the m-18 sweep is a symptom of an architectural code smell. The fix is the architectural cleanup, not a filter patch.

## Current shape (broken)

`packages/podkit-core/src/device/usb-discovery.ts` exports `discoverUsbIpods()` which:

- Enumerates **every** USB device on the system (via `system_profiler -json` on macOS, sysfs on Linux).
- Imports `identify()` from `@podkit/devices-ipod` to enrich entries with iPod-domain data.
- Returns a `UsbDiscoveredDevice[]` whose shape carries iPod-domain fields (`model: IpodModel?`, `notSupportedReason`, `supported: boolean`).
- Has a comment: *"Collect all USB devices — vendor filtering is the provider layer's job."*

But the call site in `commands/device.ts:993` (`device scan`) treats the unfiltered list as iPod candidates and renders every non-disk-mounted entry as `Unknown iPod (USB only)`. With the user's machine (CalDigit Thunderbolt dock + USB hub + Realtek Ethernet + Logitech mouse + Kingston USB stick), `device scan` reports 8 phantom "iPods" and suggests `podkit device init` for each — a destructive operation on whatever bus/devnum it thinks the iPod is.

The function name promises iPod-only; the implementation has no filter; the type leaks iPod-domain knowledge across boundaries; the call site doesn't filter either. Worst of both worlds.

## Target architecture

Three clean layers:

### 1. `@podkit/core/device/usb-enumeration.ts` (NEW; replaces or refactors `usb-discovery.ts`)

Pure enumeration. Knows only USB. No imports from `@podkit/devices-*`.

```ts
export interface EnumeratedUsbDevice {
  vendorId: string;        // bare hex
  productId: string;       // bare hex
  serialNumber?: string;
  bus?: number;
  devnum?: number;
  diskIdentifier?: string; // BSD name when device exposes mass storage
}

export async function enumerateUsb(): Promise<EnumeratedUsbDevice[]>;
```

Platform-specific implementations (macOS via system_profiler, Linux via sysfs). Output is platform-agnostic.

### 2. `@podkit/devices-ipod` — classifier

Already has `identify({ from: 'usb', productId })` and `getUnsupportedReason(productId)`. Wrap into a single classifier:

```ts
export interface IpodClassification {
  kind: 'ipod';
  device: EnumeratedUsbDevice;
  model?: IpodModel;
  supported: boolean;
  notSupportedReason?: string;
}

export function classifyAsIpod(dev: EnumeratedUsbDevice): IpodClassification | null;
```

Returns `null` when the device is not an iPod (non-Apple vendor, OR Apple vendor with PID outside iPod / iOS ranges).

### 3. `@podkit/devices-mass-storage` — classifier

Already has `USB_PRESET_HINTS`. Wrap into:

```ts
export interface MassStorageClassification {
  kind: 'mass-storage';
  device: EnumeratedUsbDevice;
  presetId: string;
  preset: MassStoragePreset;
  confidence: 'exact' | 'partial';
}

export function classifyAsMassStorage(dev: EnumeratedUsbDevice): MassStorageClassification | null;
```

Returns `null` when no preset matches.

### 4. `@podkit/core/device/classify.ts` (NEW)

Composes the classifiers. Pure function over `EnumeratedUsbDevice[]`. Returns a tagged union of recognized devices; drops unrecognized entries.

```ts
export type RecognizedDevice = IpodClassification | MassStorageClassification;

export function classifyUsbDevices(
  devices: EnumeratedUsbDevice[]
): RecognizedDevice[];
```

The CLI's `device scan` calls `enumerateUsb()` then `classifyUsbDevices()` then renders by `kind`. Logitech mice and Thunderbolt docks return `null` from both classifiers and are dropped before rendering.

### 5. CLI `device scan` rendering

Branch by `kind`:

- `kind: 'ipod'` + matched disk → existing iPod-with-disk rendering
- `kind: 'ipod'` + no matched disk → "iPod nano (X Generation) (USB only)" + appropriate guidance
- `kind: 'mass-storage'` + matched disk → "FiiO Snowsky Echo Mini (echo-mini)" with disk info
- `kind: 'mass-storage'` + no matched disk → "FiiO Snowsky Echo Mini detected — no volume mounted" (or similar)

No more "Unknown iPod (USB only)" header — every recognized device has a known type.

## What changes for users

- `device scan` no longer reports phantom iPods for USB peripherals. Logitech mouse, Thunderbolt dock controller, USB hub, Ethernet adapter, USB drive — all silently dropped (they're not music players).
- Echo Mini still detected via USB-presets path even when its SD card isn't mounted.
- iOS devices (iPod touch, iPhone, iPad) still surface in scan with the canonical unsupported-device message.

## What changes for contributors

- Adding a new mass-storage device = add a `USB_PRESET_HINTS` entry. Zero changes to `@podkit/core`.
- Adding a new iPod generation = update `@podkit/devices-ipod` tables. Zero changes elsewhere.
- The CLI command never imports from `@podkit/devices-*` directly. It calls the core classifier and renders the result.

## Test coverage required

- **Unit tests for `enumerateUsb`**: per platform, mocked stdout/sysfs, asserts pure shape (no iPod fields).
- **Unit tests for `classifyAsIpod`**: known iPod PIDs match; iOS PIDs match with `notSupportedReason`; non-Apple vendors return null.
- **Unit tests for `classifyAsMassStorage`**: Echo Mini PID matches with preset; unknown PIDs return null.
- **Unit tests for `classifyUsbDevices`**: a list mixing iPods, Echo Mini, and 5 random peripherals returns only the recognized ones, with correct `kind` discriminators.
- **Integration test for `device scan`**: with mocked `enumerateUsb` returning a realistic mix (1 iPod + 1 Echo Mini + 5 peripherals + 1 iOS device), assert rendered output contains the 3 recognized entries and zero phantoms.
- **Hardware test**: with multiple non-iPod USB devices on the bus (Thunderbolt dock, mouse, etc.) and zero iPods, `device scan` reports zero phantoms.

## Real-hardware verification

- Run `device scan` on a CalDigit-dock-equipped Mac with no iPods plugged → expect zero phantoms.
- Plug in mini 2G + nano 4G + Echo Mini (SD mounted) + iPod touch → expect 4 entries (3 supported + 1 iOS-unsupported).
- Plug only Echo Mini WITHOUT SD card → expect 1 entry "Echo Mini, no volume mounted".

## Acceptance Criteria
<!-- AC:BEGIN -->
See AC list. Architecture must follow the layers above; tests must cover each layer independently AND the composed flow.

## Companion task

The libxml2 stderr leak originally bundled here split out to TASK-317.10. Both surfaced during the same investigation but address different code paths.
<!-- SECTION:DESCRIPTION:END -->

- [ ] #1 `@podkit/core` exposes a pure `enumerateUsb()` that returns `EnumeratedUsbDevice[]` with NO iPod-domain fields. The function does not import from `@podkit/devices-*`.
- [ ] #2 `@podkit/devices-ipod` exports `classifyAsIpod(dev)` returning `IpodClassification | null`. Returns null for any non-iPod USB device (non-Apple vendor, OR Apple vendor with non-iPod / non-iOS PID).
- [ ] #3 `@podkit/devices-mass-storage` exports `classifyAsMassStorage(dev)` returning `MassStorageClassification | null`. Returns null when no preset hint matches.
- [ ] #4 `@podkit/core` exposes `classifyUsbDevices(devices)` that composes the per-domain classifiers and returns only recognized devices.
- [ ] #5 `device scan` calls `enumerateUsb()` then `classifyUsbDevices()` then renders by `kind` discriminator. No `identify()` or `getUnsupportedReason()` calls in the command layer.
- [ ] #6 Old `discoverUsbIpods()` and `UsbDiscoveredDevice` (with iPod-domain fields) removed. Any consumers migrated to the new layered API.
<!-- AC:END -->
<!-- AC:END -->

- [ ] #7 Unit tests added for each new function: `enumerateUsb` (mocked platform sources), `classifyAsIpod`, `classifyAsMassStorage`, `classifyUsbDevices` (composed flow). Coverage of recognized + unrecognized + iOS + mixed cases.
- [ ] #8 Integration test for `device scan` with mocked enumeration: assert recognized devices render correctly and unknown peripherals are dropped (zero phantoms).
- [ ] #9 Real-hardware test: on a Mac with non-iPod USB devices present (Thunderbolt dock, mouse, hub, etc.) and zero iPods plugged in, `device scan` reports zero phantom entries.
- [ ] #10 Real-hardware test: with mini 2G + nano 4G + Echo Mini (SD mounted) + iPod touch all plugged, `device scan` reports exactly 4 recognized entries with correct kinds (3 ipod, 1 mass-storage — the iPod touch is `kind: 'ipod'` with `supported: false`).
- [ ] #11 Real-hardware test: Echo Mini plugged with SD card removed (USB-only) renders cleanly as a mass-storage entry, NOT as 'Unknown iPod (USB only)'.
- [ ] #12 Regression: m-18 §6 multi-device test (nano 2G + nano 4G simultaneously) still reports both correctly with deterministic ordering.
<!-- AC:END -->
