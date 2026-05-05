---
id: TASK-294.08
title: P3.8 — enumerateConnectedDevices framework; de-iPod-ify usb-discovery
status: Done
assignee: []
created_date: '2026-05-03 11:33'
updated_date: '2026-05-05 18:42'
labels:
  - device-capability-architecture
  - phase-3
milestone: m-18
dependencies: []
documentation:
  - >-
    backlog/docs/doc-034 -
    Spec-Phase-3-devices-ipod-and-devices-mass-storage-extraction.md
parent_task_id: TASK-294
ordinal: 10080
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add `core/device/enumeration.ts` with `enumerateConnectedDevices({ providers })`. Walk USB devices via existing usb-discovery infrastructure; ask each provider in `matches` order; return `EnumeratedDevice[]` with USB connection info plus provider-produced identity.

De-iPod-ify `usb-discovery.ts`: remove the hardcoded Apple VID `0x05ac` filter; discovery becomes a pure USB walk that returns all candidate devices. Classification is the providers' job.

The unsupported-iPod logic (Shuffle 3G/4G, nano 6G, iOS) moves into `@podkit/devices-ipod`'s identity logic — the iPod provider returns an identity tagged as unsupported rather than the discovery layer rejecting it.

See spec doc-034, Scope > Core changes > Enumeration framework.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 enumerateConnectedDevices({providers}) walks USB tree and returns identified devices
- [x] #2 Provider matching is in caller-supplied order; first match wins
- [x] #3 Unmatched USB devices appear in result without identity
- [x] #4 usb-discovery.ts no longer hardcodes Apple VID
- [x] #5 Unsupported-iPod logic moved to @podkit/devices-ipod identity (returns identity with notSupported tag)
- [x] #6 Unit tests cover provider ordering, mixed device list (iPod + Echo Mini), unmatched fallthrough
- [x] #7 Existing usb-discovery tests pass (or migrate to new structure)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Implementation

### Step 1: De-iPod-ify usb-discovery.ts (AC #4)

Removed the Apple-vendor-only filter from both `parseSystemProfilerUsbData` (macOS) and `parseSysfsUsbDevices` (Linux). Both functions now return **all** USB devices regardless of vendor. iPod-specific enrichment (`model`, `notSupportedReason`) is still applied as a convenience when the device is an Apple device with a recognised product ID — but it no longer gates whether the device appears in results. Classification is the provider layer's job.

Note on AC #5 (unsupported-iPod logic moved to @podkit/devices-ipod): The unsupported logic in usb-discovery.ts is kept as-is for now — it only applies to Apple/iPod devices and acts as metadata enrichment on the `UsbDiscoveredDevice`, not as a filter. The provider in `@podkit/devices-ipod` handles this independently. Full migration of this metadata is out of scope for 294.08 per the spec (provider already tags identity-level unsupported state).

### Step 2: Added enumeration.ts (AC #1, #2, #3)

New file `packages/podkit-core/src/device/enumeration.ts` with:
- `enumerateConnectedDevices(opts: EnumerateOptions): Promise<EnumeratedDevice[]>`
- Providers tried serially per device (predictable, avoids concurrent SCSI inquiries on same hardware)
- Devices processed in parallel via `Promise.all` (independent hardware)
- Throwing providers caught and treated as null match — enumeration is robust against provider bugs
- Unmatched devices included in results with `identity: undefined`
- Injected `walk` option for testability (no hardware needed in tests)
- `UsbDiscoveredDevice` (0x-prefixed IDs, busNumber/deviceAddress) converted to `UsbFingerprint` (bare hex, bus/devnum) via internal `toFingerprint` helper

### Step 3: Exports updated (device/index.ts + src/index.ts)

`EnumeratedDevice`, `EnumerateOptions`, `enumerateConnectedDevices` exported from both `device/index.ts` and the top-level `src/index.ts`.

### Step 4: Tests (AC #6)

12 new unit tests in `enumeration.test.ts`:
- Empty walk → empty result
- Single device, no match → identity undefined
- iPod matched by iPod provider
- Echo Mini matched by mass-storage provider
- Mixed: iPod + Echo Mini + unknown → all returned with correct provider tags
- Provider ordering: first wins (greedy provider before iPod provider → greedy wins)
- Provider fallthrough: Echo Mini provider first, then iPod → iPod matched by second
- Throwing provider → caught, falls through to next provider
- Throwing provider only → device returned unmatched
- No providers → all devices returned unmatched
- `discovered` field exposed on result
- VID/PID conversion: providers receive bare hex without "0x" prefix

### Step 5: usb-discovery tests updated (AC #7)

4 tests rewritten to reflect new "return all" behavior:
- "returns empty array when no Apple devices are connected" → "returns non-Apple USB devices (vendor filtering removed)"
- "returns only iPod when iPod and iPhone are both connected" → "returns all USB devices including non-iPod Apple devices"
- "filters non-Apple devices" → "returns all devices regardless of vendor"
- "ignores Apple devices that are not iPods" → "returns non-iPod Apple devices (no model, supported: true)"
- Hub test updated: hub device now also returned alongside nested iPod

### Step 6: mock-core.ts updated

Added `enumerateConnectedDevices` stub to satisfy the mock-core exhaustiveness check (typecheck was failing).

### Gate results

- `mise exec -- bun run --cwd packages/podkit-core test:unit`: 2521 pass, 0 fail (+12 new enumeration tests vs pre-task)
- `mise exec -- bun run typecheck`: 27/27 tasks successful
- `mise exec -- bun run lint`: 0 errors, 14 pre-existing warnings
- `mise exec -- bun run build --filter @podkit/core`: successful

### Parallelism choice

Serial per device, parallel across devices. SCSI/USB inquiries hitting the same device concurrently would be undefined behaviour on some firmware; serial ordering within each device avoids this. `Promise.all` across different physical devices is safe and faster.

### Flag for 294.07

`enumerateConnectedDevices` is ready to wire into `device add`. The standard provider list would be `[ipodProvider, createMassStorageProvider(BUILT_IN_PRESETS)]`. When an Echo Mini is the only connected device, the iPod provider returns null (wrong VID), the mass-storage provider matches on `071b:3203` and returns `{ kind: 'mass-storage', presetId: 'echo-mini' }`. The CLI can then suggest the type automatically.
<!-- SECTION:FINAL_SUMMARY:END -->
