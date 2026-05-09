---
title: "ADR-014: Device Capability Architecture (m-18)"
description: Four-package architecture for USB-first / SCSI-fallback device identification and capability synthesis.
sidebar:
  order: 15
---

# ADR-014: Device Capability Architecture (m-18)

## Status

**Accepted** (2026-05-06)

## Context

Before m-18, device identification and capability synthesis were coupled to libgpod in ways that caused three distinct problems.

**Identification gaps.** The original inquiry path used libgpod's `itdb_read_sysinfo_extended_from_usb` — a USB-only code path that calls libusb internally. Several iPod generations (mini 2G, nano 2G, iPod 5G Video) expose firmware information only via SCSI `INQUIRY` / `IDENTIFY` commands, not over USB control transfers. These devices were either misidentified or fell through to a generic fallback, producing wrong capability tables.

**libgpod coupling.** The `DeviceCapabilities` interface lived inside `podkit-core`, synthesised from a `LibgpodDeviceInfo` adapter that required libgpod to have run first. This made it impossible to compute capabilities without the database layer, blocking the m-8 libgpod replacement work and preventing any device class other than iPod from having a typed capability record.

**Extensibility.** Adding a new device class (mass-storage DAPs, Rockbox targets, Echo Mini variants) required changes to core packages. There was no pattern for third-party or project-local device definitions.

The m-18 milestone replaced this with a layered, libgpod-free architecture spanning four packages. The decisions below were validated across five delivery phases (P0–P4); the architecture is stable as of P4.

## Decisions

### 1. USB-first / SCSI-fallback inquiry orchestration

The firmware inquiry orchestrator (`@podkit/ipod-firmware`) attempts USB inquiry first (libusb control transfer for `SysInfoExtended` XML), then falls back to SCSI `INQUIRY` + `IDENTIFY` if USB returns no data. This single orchestrator replaced the previous libusb-only path that was embedded in libgpod-node.

The fallback is what enables mini 2G, nano 2G, and iPod 5G Video to be identified correctly; those devices answer the SCSI commands but not the USB control transfer. See doc-031 (P0 spike) and doc-032 (P1 delivery) for the investigation that confirmed which generations require each path.

### 2. TypeScript FFI (koffi) over additional compiled helpers

Both the Linux SG_IO ioctl and the macOS IOKit `SCSITaskUserClient` path are called via [koffi](https://koffi.dev/) FFI from TypeScript, with no compiled C/C++ helper shim. A Swift command-line helper for macOS IOKit was prototyped and rejected because koffi's struct-layout support proved sufficient and eliminated a separate build artefact.

This keeps `@podkit/ipod-firmware` as a pure TypeScript package (plus the koffi peer dependency) with no node-gyp build step. See doc-031 for the spike that validated koffi's struct support against IOKit types.

### 3. Four-package architecture

The architecture is split across four packages with a strict dependency direction:

| Package | Role |
|---------|------|
| `@podkit/device-types` | Shared TypeScript interfaces — `DeviceCapabilities`, `DeviceIdentity`, `DeviceProvider`. No runtime dependencies. |
| `@podkit/ipod-firmware` | Firmware inquiry (SCSI + USB) and plist parsing. Produces `IpodFirmwareInfo`. |
| `@podkit/devices-ipod` | Pure generation tables + capability synthesis for stock iPod firmware. Depends on `device-types` and `ipod-firmware`; no libgpod. |
| `@podkit/devices-mass-storage` | User-extensible preset framework for mass-storage DAPs (Echo Mini, Rockbox, generic). Depends on `device-types` only. |

`device-types` is intentionally a leaf package so that browser-compatible code (e.g., `ipod-web`) can import types without pulling in Node.js-specific transports. See doc-034 for the extraction spec.

### 4. Provider pattern for extensible enumeration

Each device class is implemented as a `DeviceProvider<T extends DeviceIdentity>` with three methods: `detect(mountpoint, hints)`, `resolveCapabilities(identity)`, and `describe(identity)`. Core calls `enumerateConnectedDevices(providers, mountpoints)` passing whichever providers it has been given — it has no hard-coded knowledge of iPod or mass-storage specifics.

Providers are composed by the caller (CLI or library consumer), not registered in a global table. This means two Echo Mini units with different configurations can coexist in the same provider list without any singleton collision. See doc-034 (P3) for the provider interface design.

### 5. Pure-functional preset registry — no globals

Mass-storage device presets (Echo Mini, Rockbox, generic DAP) are defined via `definePreset(spec)` which returns a plain object. The caller assembles a preset map (`Record<string, MassStoragePreset>`) and passes it into the provider at construction time. There is no module-level registry and no `registerPreset()` call.

This design enables multiple simultaneous preset maps (useful in tests), prevents cross-test state pollution, and makes the set of recognised devices fully visible at each call site.

### 6. Literal-plus-runtime-string union for device type IDs

Built-in device type IDs are declared as string literal types (`"ipod-classic-6g"`, `"echo-mini"`, etc.) and collected into `BuiltInDeviceTypeId`. The `deviceTypeId` field on `DeviceIdentity` is typed as `BuiltInDeviceTypeId | (string & {})`. The `(string & {})` suffix keeps autocomplete for the known literals while allowing arbitrary runtime strings for third-party or future device types — without requiring an enum extension or a type cast.

### 7. `resolveCapabilities` as the single core entry point

`resolveCapabilities(identity, firmwareInfo?)` in `@podkit/devices-ipod` is the one function that all consumers call to obtain a `DeviceCapabilities` record. The sync executor, transcoding pipeline, and CLI display all import from this single entry point rather than from ad-hoc per-field helpers. See doc-035 (P4) for the unification step that collapsed the previous scattered accessors.

### 8. libgpod-node binding scope reduced to database operations

The `readSysInfoExtendedFromUsb` N-API export, the `dlsym` runtime shim for `itdb_read_sysinfo_extended_from_usb`, and the libusb build dependency were removed from `@podkit/libgpod-node` in P2 (TASK-293). The binding now covers only iTunesDB read/write operations. This also drops `libusb-1.0-dev` from the build requirements for libgpod-node.

See the P2 update note in [ADR-002](adr-002-libgpod-binding.md) and doc-033 for the consolidation spec.

### 9. Capability tables are libgpod-free

`@podkit/devices-ipod` synthesises `DeviceCapabilities` from the generation tables and `IpodFirmwareInfo` alone. The `LibgpodDeviceInfo` adapter that previously bridged libgpod's device info struct into the capabilities interface was deleted in P4. Capability synthesis can now run before the database is opened, or in contexts where libgpod is not present at all.

### 10. Diagnostic checks live in core, not in ipod-firmware

The P1 spec placed the SCSI-permission doctor check inside `@podkit/ipod-firmware`. During implementation it became clear that the diagnostics framework (`packages/podkit-core/src/diagnostics/`) is the right home: it owns the `DoctorCheck` interface, result formatting, and `--repair` dispatch. The ipod-firmware package exposes a `checkScsiPermissions()` helper; core's doctor runner calls it. This keeps ipod-firmware focused on inquiry mechanics.

### 11. Linux SCSI permission UX: sudo-first, opt-in udev rule

On Linux, SCSI `SG_IO` ioctls require either root or membership in the `disk` group. The orchestrator attempts the ioctl directly; if it fails with `EACCES` / `EPERM`, it retries under `sudo`. A persistent fix — adding a udev rule granting the current user access to the device node — is available via `podkit doctor --repair udev-rule` but is never applied automatically.

The sudo-first approach trades a password prompt for zero permanent system changes on first run, which is appropriate for a developer tool. The udev path is surfaced for users who run frequent syncs. See doc-032 (P1) for the UX rationale.

### 12. Unsupported-iPod tagging is provider-side, not discovery-side

When `ipodProvider.detect()` recognises a connected device as an iPod generation that podkit does not support (e.g., iPod shuffle 1G, iPod photo), it returns an `IpodIdentity` with `notSupportedReason` populated rather than returning `null`. Discovery (the layer that enumerates mount points) therefore still surfaces the device; the unsupported status is visible to the user via `podkit device info` rather than silently disappearing.

This was a deliberate deviation from an earlier design where unsupported devices were filtered out at discovery time, which made it impossible to give the user a meaningful error message.

### 13. `artworkMaxResolution: number | null`

The `artworkMaxResolution` field on `DeviceCapabilities` is typed as `number | null`. `null` means the device does not support artwork. The previous implementation used a sentinel value of `0` for the same condition, which required every consumer to know the sentinel and made the intent ambiguous (`0` could also mean "not yet determined"). The `null` type makes the absence of artwork support explicit and statically checkable.

## Consequences

### Benefits

- **SCSI-only iPods are now identifiable.** mini 2G, nano 2G, and iPod 5G Video produce correct capability records rather than falling through to a generic fallback.
- **libgpod-node is scoped and shrinkable.** The binding covers database operations only; m-8 (pure TypeScript iTunesDB) can replace it without touching inquiry or capability code.
- **New device classes are self-contained.** Adding a new mass-storage preset or a new device provider requires no changes to `podkit-core`.
- **Multiple same-class devices work correctly.** Two Echo Minis with different configurations are distinct presets in the caller-composed map; no singleton collision.
- **No system libusb required.** `@podkit/ipod-firmware` reaches libusb through the `usb` npm package, whose prebuilt N-API binding statically links libusb. End-user binaries embed that prebuild; distro packagers don't need `libusb-1.0-dev` at all.
- **Type-honest capabilities.** `artworkMaxResolution: null` is statically checked; the sentinel-`0` pattern is gone.
- **Browser-compatible types.** `@podkit/device-types` is a leaf package with no Node.js imports, usable in `ipod-web` and future browser contexts.

### Costs

- **Four new packages to maintain.** Each has its own `package.json`, test suite, and changeset discipline.
- **libgpod-bridge.ts remains.** The bridge that adapts libgpod's database-layer device info into `DeviceCapabilities` is still present as a libgpod-coupled island until m-8 ships.
- **iPod PID coverage relies on community data.** iPhone and iPad PIDs are sourced from community lists plus a generation-range heuristic; edge cases for future generations require table updates.
- **Capability snapshot tests must be maintained.** The generation table snapshot tests (`devices-ipod`) will need updating whenever Apple releases a new iPod (unlikely but possible) or when the `DeviceCapabilities` interface changes shape.

## Alternatives Considered

- **Compiled Swift helper for macOS IOKit** — Prototyped in P0. Rejected because koffi's struct support proved sufficient and a separate compiled binary adds build complexity and a notarisation surface.
- **Single mega-package** — Keeping all device logic in `podkit-core`. Rejected because it prevents browser-compatible consumers from importing types and keeps libgpod coupling in the critical path.
- **Class hierarchy / inheritance for device types** — An abstract `Device` base class with `IpodDevice`, `MassStorageDevice` subclasses. Rejected in favour of the Provider pattern, which is open-ended: third parties can add device classes without subclassing internal types.
- **Global preset registry with `registerPreset()`** — A module-level map populated at import time. Rejected because it causes cross-test state pollution and makes the set of active presets invisible at the call site.

## References

- [doc-030](../backlog/docs/doc-030%20-%20PRD-Device-Capability-Architecture.md) — PRD: Device Capability Architecture
- [doc-031](../backlog/docs/doc-031%20-%20Spec-Phase-0-—-FFI-SCSI-inquiry-spike.md) — Spec: P0 FFI SCSI inquiry spike
- [doc-032](../backlog/docs/doc-032%20-%20Spec-Phase-1-—-ipod-firmware-SCSI-delivery.md) — Spec: P1 ipod-firmware SCSI delivery
- [doc-033](../backlog/docs/doc-033%20-%20Spec-Phase-2-—-USB-inquiry-consolidation.md) — Spec: P2 USB inquiry consolidation
- [doc-034](../backlog/docs/doc-034%20-%20Spec-Phase-3-—-devices-ipod-and-devices-mass-storage-extraction.md) — Spec: P3 devices-ipod + devices-mass-storage extraction
- [doc-035](../backlog/docs/doc-035%20-%20Spec-Phase-4-—-Unification-and-cleanup.md) — Spec: P4 Unification and cleanup
- [ADR-002](adr-002-libgpod-binding.md) — libgpod binding (superseded for USB inquiry by P2)
- TASK-292 (P1), TASK-293 (P2), TASK-294 (P3), TASK-295 (P4)
- Milestone m-18: Device Identification
