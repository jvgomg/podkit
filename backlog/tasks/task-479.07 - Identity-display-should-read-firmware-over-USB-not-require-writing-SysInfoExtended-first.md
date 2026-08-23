---
id: TASK-479.07
title: 'Live firmware rung in the identity cascade (opt-in, off by default)'
status: To Do
assignee: []
created_date: '2026-08-17 22:58'
updated_date: '2026-08-23 13:43'
labels:
  - identity
  - ux
  - ipod-firmware
milestone: m-18
dependencies: []
parent_task_id: TASK-479
priority: medium
ordinal: 250000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Scope

The **core mechanism only**: `assessIpodIdentity` can resolve identity by reading firmware over USB, without writing anything. Opt-in via an option argument, **off by default**. No CLI change, no flag, no command behaviour change.

Making `device info`/`scan` use it is TASK-479.13. Cost control is TASK-479.14. Turning it on is TASK-479.15. Diagnostics is TASK-479.16.

Split from the original TASK-479.07 after an Opus design review found the single task spanned a core signature break, a new gate, a memo, a CLI flag, two output shapes, a diagnostics enum rename, a sync→async break across three checks, an enum addition that broke a view type, an e2e harness change, an ADR and a doc update.

## Problem

The firmware inquiry that obtains SysInfoExtended is **read-only** and needs only a `UsbFingerprint` — no mount point (`packages/ipod-firmware/src/inquiry/orchestrator.ts`). `assessIpodIdentity` (`packages/podkit-core/src/device/ipod-identity.ts`) already imports `inquireFirmware` and never calls it. Its cascade is SIE-on-disk → classic SysInfo → USB PID, so a device with no SIE resolves to a bare generation even though its serial is readable from firmware at that moment.

## Design

### Internal module, not a new export

`packages/podkit-core/src/device/live-firmware-identity.ts` — fingerprint-keyed, never writes, never throws, returns `null` on any failure. **Internal to core; not exported from `index.ts`.** Cascade sequencing must not leak into consumers.

### Signature is NOT widened

The original plan widened `assessIpodIdentity(mountPoint: string)` to a device reference so unmounted devices could come through the same door. Dropped: every production caller has and requires a mount point (`sync.ts:744`, `add.ts:274/378`, `shared.ts:87`, `archive.ts:387`, `doctor.ts:1250`, `repair-dispatch.ts:162`), and `device add` throws `MOUNT_FAILED`/`MOUNT_REQUIRES_SUDO` at `add.ts:816-861` before assess is ever reached. The unmounted consumer (`scan`'s USB-only path at `scan.ts:409-455`) is out of scope, so the widened signature would be dead surface bought at the price of six dep-injection seams and ~45 test stubs.

Revisit when `scan` actually needs it. That path already holds a usable fingerprint from `enumerateUsb` (`usb-enumeration.ts:357-380`).

Instead: `assessIpodIdentity(mountPoint, opts)` gains `opts.firmwareProbe?: boolean` (default `false`) plus a transport-injection seam for tests.

### The gate is one predicate, not a file-state table

**Probe unless the cascade already resolved a model carrying a `modelNumber`.**

An earlier draft enumerated four on-disk states (no mount / SIE absent / SIE unparseable / classic SysInfo has ModelNumStr). That table is not disjoint: `readSysInfoExtended` folds the classic-SysInfo `ModelNumStr` into `identity.modelNumStr` **even when the plist failed to parse** (`packages/ipod-firmware/src/sysinfo/read.ts:205-208`), so "SIE unparseable → probe" and "classic ModelNumStr present → skip" both hold for one real device. `firmwareInquiry` can't serve as the gate either — states (b), (c) and (d) all collapse to `'missing'` at `ipod-identity.ts:139-145`.

The single predicate is disjoint and matches the intent exactly: a variant-resolving model is the whole point of the feature, so having one means there is nothing to gain.

Additional skips: mass-storage devices (no firmware inquiry exists for them) and devices with no complete USB fingerprint.

**Not** skipped: devices whose generation tier is `access: 'none'`. An unsupported device is exactly where a precise name helps the user understand the refusal.

### macOS fingerprint strictness must be fixed here

`hasCompleteUsbFingerprint` (`packages/podkit-core/src/device/usb-path-resolution.ts:51-63`) demands both `bus` and `devnum`, though its own doc comment at `:33-43` says macOS SCSI matches on vendorId/productId/serialNumber. macOS `location_id` values without the `/N` suffix yield no `devnum` (`usb-enumeration.ts:188-214`). Under "skip devices with no complete fingerprint", those Macs silently never probe — the feature would be nondeterministic by host machine. Fix in this task or the whole epic is unreliable.

### Provenance

The assessment gains `identitySource`: `sysinfo-extended | sysinfo | firmware-live | usb-pid`, absent when nothing resolved.

`IpodModelSource` (`'usb' | 'sysinfo' | 'serial'`) is **not** extended — adding `'firmware-live'` would pollute a type many switch statements consume, for information they do not need.

Note for TASK-479.13: `IpodModel.source` is *already* rendered as data origin — `device-scan-render.ts:213` prints `' (USB)'` from it — and `synthesizeFromGeneration` (`packages/devices-ipod/src/resolve.ts:67`) hardcodes `source: 'usb'` for familyId and libgpodGeneration resolutions too. That pre-existing inaccuracy is the display task's to fix. Do **not** paper over it with a doc comment here.

TASK-479.16 introduces a second, overlapping provenance enum (`FirmwareTruthSource`). The two must be reconciled there, not duplicated.

### No env-var sniffing in core

`documents/architecture/conventions.md:170-187` forbids env-var reads on production code paths in core. This task takes an option argument only. The `PODKIT_NO_FIRMWARE_PROBE` plumbing belongs to TASK-479.15, parsed in `podkit-cli/src/config/loader.ts` and threaded down.

## Rejected

- **On-disk firmware cache** (`~/.cache/podkit/...`) — writing cache files for this is unwanted.
- **macOS iPod plist cache as an identity axis** — different data source with its own staleness/trust question; muddies the provenance model just as it is being defined. Not filed.
- **`IpodFirmwareInquiryState = 'read-only'`** — collides with `DeviceAccess = 'read-only'` (ADR-024, `packages/devices-ipod/src/types.ts:29-41`); both would sit on the same assessment meaning unrelated things. It also breaks the direct assignment at `assessment-views.ts:47` into `identityStore` (`'present'|'missing'|'unwritable'|'not-applicable'`, doc-045) and forces a mapping decision in the M4 policy layer. `'unwritable'` already answers the question the enum exists to answer.

## Tests

Unit only — injected transports via the existing `InquireOptions` seam (`orchestrator.ts:61-85`). No hardware, no VM, no CLI surface. The behaviour is off by default so nothing else changes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `assessIpodIdentity(mountPoint, opts)` accepts `opts.firmwareProbe`; with it unset no USB or SCSI transport is touched and every existing caller behaves identically
- [ ] #2 With `firmwareProbe` set, a device whose disk yields no model number resolves model number, capacity and colour from firmware
- [ ] #3 The gate is a single predicate over the cascade outcome — probe unless the resolved model already carries a `modelNumber` — not a table of on-disk file states
- [ ] #4 Probing is skipped for mass-storage devices and for devices with no complete USB fingerprint, and is NOT skipped for devices whose tier is `access: 'none'`
- [ ] #5 `hasCompleteUsbFingerprint` accepts a macOS fingerprint carrying vendorId/productId/serialNumber without `devnum`, matching what macOS SCSI actually matches on
- [ ] #6 Nothing is written to the device on any path through `assessIpodIdentity`, with or without `firmwareProbe`
- [ ] #7 Inquiry failure returns the pre-probe cascade answer unchanged; the live module never throws
- [ ] #8 The assessment carries `identitySource` with values `sysinfo-extended | sysinfo | firmware-live | usb-pid`, absent when nothing resolved
- [ ] #9 `IpodModelSource` is unchanged and `live-firmware-identity.ts` is not exported from core's `index.ts`
- [ ] #10 Core reads no environment variable on this path
- [ ] #11 `assessIpodIdentity`'s signature is not widened to a device reference; no dep-injection seam or test stub changes shape
<!-- AC:END -->
