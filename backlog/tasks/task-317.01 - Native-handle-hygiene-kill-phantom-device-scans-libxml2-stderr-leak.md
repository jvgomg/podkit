---
id: TASK-317.01
title: >-
  Refactor USB enumeration: separate enumeration / classification / rendering
  layers
status: Done
assignee: []
created_date: '2026-05-09 15:18'
updated_date: '2026-05-09 18:06'
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

- [x] #1 `@podkit/core` exposes a pure `enumerateUsb()` that returns `EnumeratedUsbDevice[]` with NO iPod-domain fields. The function does not import from `@podkit/devices-*`.
- [x] #2 `@podkit/devices-ipod` exports `classifyAsIpod(dev)` returning `IpodClassification | null`. Returns null for any non-iPod USB device (non-Apple vendor, OR Apple vendor with non-iPod / non-iOS PID).
- [x] #3 `@podkit/devices-mass-storage` exports `classifyAsMassStorage(dev)` returning `MassStorageClassification | null`. Returns null when no preset hint matches.
- [x] #4 `@podkit/core` exposes `classifyUsbDevices(devices)` that composes the per-domain classifiers and returns only recognized devices.
- [x] #5 `device scan` calls `enumerateUsb()` then `classifyUsbDevices()` then renders by `kind` discriminator. No `identify()` or `getUnsupportedReason()` calls in the command layer.
- [x] #6 Old `discoverUsbIpods()` and `UsbDiscoveredDevice` (with iPod-domain fields) removed. Any consumers migrated to the new layered API.
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Outcome

Refactored USB enumeration into clean enumeration / classification / rendering layers. Phantom-device scan bug fixed: real-hardware verification (CalDigit dock + USB hub + Logitech mouse + Realtek Ethernet + USB drive, no iPods plugged) goes from **8 phantom "Unknown iPod (USB only)" entries to zero**.

## Architecture shipped

- **`@podkit/core/device/usb-enumeration.ts`** — pure USB enumeration. `enumerateUsb()` returns `EnumeratedUsbDevice[]` with USB-only fields; no imports from `@podkit/devices-*`.
- **`@podkit/devices-ipod/src/classify.ts`** — `classifyAsIpod(dev) → IpodClassification | null`. Self-sufficient: defensive vendor-id normalisation handles bare-hex / `0x`-prefixed / `apple_vendor_id` sentinel / `0x05ac (Apple Inc.)` forms without depending on core.
- **`@podkit/devices-mass-storage/src/classify.ts`** — `classifyAsMassStorage(dev) → MassStorageClassification | null`. Optional DI for `presets` and `usbHints`. Translates internal `vendor-only` confidence to public `partial` (commented + tested).
- **`@podkit/core/device/classify.ts`** — `classifyUsbDevices(devices) → RecognizedDevice[]`. Tagged union; iPod classification wins when both classifiers match the same device.
- **`packages/podkit-cli/src/commands/device-scan-render.ts`** — pure `renderDeviceScan(input) → string[]`. Zero I/O, zero side effects, zero `out.*` calls. Action callback in `device scan` now: enumerate → classify → resolve readiness → hand to renderer → write lines.

## Boundary cleanliness

- `usb-enumeration.ts` does not import from `@podkit/devices-*`. Verified.
- Each classifier is self-sufficient. Verified.
- CLI never calls `identify()` or `getUnsupportedReason()` directly. Verified.
- Old `discoverUsbIpods()` and `UsbDiscoveredDevice` (with iPod-domain fields) removed; all consumers migrated.

## Side benefits

- `usb-discovery.ts` was actually doing two unrelated jobs (bus walk + mount-path resolution); split into `usb-enumeration.ts` and `usb-path-resolution.ts`.
- Rendering extraction also factored `formatReadinessSummaryLines` / `formatIssueLines` out of `readiness-display.ts` as pure helpers — `doctor` and `device info` get cleaner internals as a side effect.

## Tests added

- `packages/podkit-core/src/device/usb-enumeration.test.ts` (parser shape, hub recursion, iPod-domain-leak guards)
- `packages/podkit-core/src/device/classify.test.ts` (composer: empty + 5-peripherals + mixed 8-device fixtures, kind discriminator correctness)
- `packages/devices-ipod/src/classify.test.ts` (positive iPod cases + iOS fallback + non-Apple negatives + Apple-non-iPod negatives + 3 vendor-id sentinel forms)
- `packages/devices-mass-storage/src/classify.test.ts` (Echo Mini exact + non-matches + DI seam + `vendor-only → partial` translation)
- `packages/podkit-cli/src/commands/device-scan.integration.test.ts` (data-flow boundary regression: 8 peripherals → 0 phantoms; mixed scan correctness)
- `packages/podkit-cli/src/commands/device-scan-render.unit.test.ts` (10 tests pinning the rendering layer specifically — empty-input no-phantom regression, mixed input with each kind rendered correctly, configured-not-detected handling)

All 11 ACs satisfied.

## Commits

- **f61a83b** — `refactor: separate USB enumeration / classification / rendering layers` (the architectural refactor + first round of tests)
- **c6e0197** — `device scan: extract rendering into pure function` (closes the rendering-layer test gap flagged in review)

## Deferred (correctly out of scope)

- libxml2 stderr leak — TASK-317.10
- `"No iPod devices found."` wording (should mention mass-storage too) — TASK-317.03 owns the wording centralization
- Generic-fallback for mass-storage in `classifyAsMassStorage` — kept intentionally narrow (matches `USB_PRESET_HINTS` only). Generic fallback remains in the provider path used by `device add`.

## Real-hardware verification

`node packages/podkit-cli/dist/main.js device scan` with no iPods plugged in:

```
No iPod devices found.

Not detected:
  terapod (iPod)
  nano (iPod)
  ipod-nano-slim (iPod)
  ipod-mini (iPod)
  nano2g (iPod)
  nano3g (iPod)
  echomini (Echo Mini) — /Volumes/Echo SD
```

Zero phantom "Unknown iPod (USB only)" entries.
<!-- SECTION:FINAL_SUMMARY:END -->
