---
id: doc-030
title: 'PRD: Device Capability Architecture'
type: other
created_date: '2026-05-03 11:14'
---
## Problem Statement

podkit's understanding of "what is this device and what can it do" is currently spread across three layers of code that grew opportunistically rather than by design:

- **Generation knowledge** (USB product IDs, serial-suffix-to-variant lookups, checksum types, codec support, screen resolutions) lives in a 2,000-line file in `podkit-core` alongside lookup logic and type definitions.
- **Mass-storage device support** (Echo Mini, Rockbox, generic) lives in a `presets.ts` module bolted on next to it, with a different shape and different conceptual vocabulary ("preset" rather than "model").
- **Live firmware inquiry** (the way modern iPods report their identity and capabilities) is partial: USB-vendor inquiry is wrapped in the libgpod N-API binding, but SCSI inquiry — required to identify older iPods (mini, nano 1G/2G, iPod 5G) and any device where USB inquiry fails — is not implemented at all.

The user-visible consequence is that a user with a mini 2G, nano 2G, or 5G iPod Video that has no SysInfoExtended on disk gets generic identification. Their device works at a degraded level. `podkit doctor --repair sysinfo-extended` cannot help them because it relies on USB inquiry, which their device does not respond to. Hardware testing on five real iPods has confirmed that SCSI inquiry would work on every one of them, but no SCSI code exists in podkit today.

The developer-visible consequences are:

- Device-knowledge code is becoming a bottleneck. Anyone working on transcoding decisions, capability detection, or new device support must navigate three tightly coupled but conceptually distinct concerns: hardware tables, mass-storage presets, and live inquiry.
- The libgpod replacement work (m-8 ipod-db) cannot remove the native binding cleanly while USB inquiry lives inside it. Worse, the m-8 design document explicitly assumes SysInfoExtended is out of scope, which is incorrect — it is required for hash58, hash72, and hashAB devices.
- Adding a new device class (e.g. Sony Walkman, FiiO models) requires changes scattered across `podkit-core`, the CLI's type unions, and the USB-discovery enumeration logic. There is no extension point.
- USB enumeration only knows about Apple-vendor iPods. Mass-storage devices are added via a `--type` flag at `device add` time and are never auto-detected, even when their USB VID/PID is known.

The shape of these problems is one architecture problem, not several. Resolving it cleanly, rather than bolting on SCSI alongside the existing tangle, is the goal of this work.

## Solution

Four packages, each with a single responsibility, consumed by `podkit-core` to build a unified picture of any connected device.

```
@podkit/device-types          shared type definitions (DeviceCapabilities, AudioCodec, …)
@podkit/devices-ipod          pure data: iPod generations, models, lookups, table-derived capabilities
@podkit/devices-mass-storage  pure data: mass-storage presets, lookup framework, capability resolution
@podkit/ipod-firmware         I/O: SCSI + USB inquiry, plist parsing, SysInfoExtended file management
                                  ↑
                              podkit-core consumes all four
```

The two "devices-*" packages are symmetrical: pure data plus pure functions, no I/O. Both expose the same verbs (`identify`, `getCapabilities`) and return the same shape of result (a `DeviceIdentity` discriminated union). One holds iPod generation tables; the other holds mass-storage presets and a framework for users to extend with their own presets and per-device overrides. The word "preset" becomes an internal implementation detail of the mass-storage package — consumers think in terms of identities and capabilities, not presets.

`@podkit/ipod-firmware` is the only package that performs I/O against an iPod. It owns SCSI inquiry (new, via a foreign-function-interface to IOKit on macOS and the SG_IO ioctl on Linux), USB inquiry (moved here from the libgpod-node binding), inquiry-method selection logic, plist parsing, and reading and writing SysInfoExtended on the device filesystem. This is the package that survives the eventual libgpod-to-ipod-db migration unchanged.

`podkit-core` owns the platform USB-walk infrastructure and an extensible **provider-driven enumeration framework**. Each device package exports a Provider value — a small object that declares "I match these USB devices" and exposes an `identify` function. Core's enumerator walks USB descriptors and asks each provider in turn. Adding a new device class — for example a future `@podkit/devices-walkman` — is a matter of writing a new Provider and passing it into the providers list, with no changes to core.

The capability resolution flow becomes:

```
USB descriptor → Provider matches → DeviceIdentity (rich, kind-specific)
DeviceIdentity → getCapabilities(identity, options?) → DeviceCapabilities (unified)
```

For an iPod, `options` may include parsed firmware data so that artwork formats and codec specs come from the device's own report rather than hardcoded fallback tables. For a mass-storage device, `options` may include user-provided overrides — supporting cases such as "I have two Echo Minis and I want to configure them differently."

All package APIs are pure functional. The mass-storage preset registry is a value the caller composes, not a global mutable singleton. A program may use the built-in presets directly, extend them once at startup, or compose a per-device preset map at the moment of sync — whatever the application needs.

The work ships in five phases, each independently usable:

1. **P0 — Spike.** Validate that a TypeScript foreign-function-interface (`koffi`) can drive macOS IOKit SCSITaskUserClient and Linux SG_IO end-to-end against a real iPod. Inform the implementation strategy before package work begins. If FFI proves unworkable on macOS, fall back to a small compiled helper binary on that platform only.
2. **P1 — SCSI inquiry shipped.** Create `@podkit/device-types` and `@podkit/ipod-firmware` with SCSI inquiry, USB-first / SCSI-fallback selection, plist parsing, and two new `podkit doctor` checks (`inquiry-methods`, `sysinfo-consistency`). Existing `podkit-core` device code is untouched. Users with mini, nano 1G/2G, and iPod 5G devices can now repair SysInfoExtended.
3. **P2 — USB inquiry consolidated.** Move USB-vendor inquiry from the libgpod-node native binding into `@podkit/ipod-firmware`. Drop the corresponding C++ entry point. The full inquiry surface now lives in TypeScript.
4. **P3 — Data extraction.** Move iPod generation tables and lookups into `@podkit/devices-ipod`. Move mass-storage presets and the user-extensible registry framework into `@podkit/devices-mass-storage`. Add the Provider pattern and the enumeration framework to `podkit-core`. Re-export shims in core preserve back-compat for one release.
5. **P4 — Unification and cleanup.** Move SysInfoExtended file I/O into `@podkit/ipod-firmware`. Replace the existing `createIpodCapabilities` adapter with a unified `getCapabilities` that drives both device classes through the same interface. Delete shims and the libgpod-coupled adapter. Refactor complete.

## User Stories

### End-user stories

1. As a user with an iPod nano 2nd Gen, I want `podkit doctor --repair sysinfo-extended` to populate my device identity from firmware, so that my iPod is fully identified even though it does not respond to USB inquiry.
2. As a user with an iPod mini 2nd Gen, I want podkit to identify my exact model from firmware on first connection, so that I do not see degraded capabilities or generic identification.
3. As a user with an iPod 5th Generation Video (including iFlash-modded), I want podkit to read device identity directly from firmware via SCSI, so that filesystem identity drift (manually written SysInfo, stale ModelNumStr) does not produce wrong capabilities.
4. As a user with a freshly restored iPod Classic 6G or nano 4G, I want SCSI inquiry to work as a fallback when USB inquiry succeeds, so that the most authoritative method is always available.
5. As a user running `podkit doctor`, I want to see which inquiry methods are available on my system (iPodDriver.kext, libusb, /dev/sg), so that I understand why a particular device might be partially identified.
6. As a user running `podkit doctor`, I want to be told when the SysInfoExtended file on my device disagrees with the live USB descriptor, so that I can refresh stale identity data with a clear repair command.
7. As a user with two Echo Minis, I want to configure each one with different sync settings, so that one can be set up for embedded artwork at 600px and the other can be configured differently.
8. As a user, I want to override capabilities on my mass-storage device (for example, force MP3-only output on a device that supports more), so that I can adapt to limitations my specific firmware imposes.
9. As a user, I want podkit to auto-detect my Echo Mini by USB VID/PID at `device add` time, so that I do not have to manually pass `--type echo-mini`.
10. As a user, I want device capabilities to be derivable when my iPod is not connected, so that pre-transcoding for an iPod waiting on my desk works without repeatedly plugging it in.
11. As a user with an iPod containing a SysInfoExtended file written by iTunes or a previous tool, I want podkit to recognise it without redoing the firmware read, so that startup is fast.
12. As a user, I want clear messaging when a device cannot be fully identified — what was detected, what's missing, and what to do — so that degraded states are intelligible.

### Developer / integrator stories

13. As a developer extending podkit with support for a new device class (e.g. Sony Walkman), I want to ship a single package that exposes a Provider and capability resolver, so that I do not have to modify `podkit-core`.
14. As a developer building a strongly-typed program against podkit, I want preset and generation IDs available as TypeScript literal unions, so that I get compile-time errors for typos.
15. As a developer building a runtime-driven program, I want preset and generation IDs to also accept arbitrary strings, so that user input from config files works without extra coercion.
16. As a developer using `@podkit/devices-mass-storage`, I want to define new presets as pure values, so that I can compose them functionally without touching global state.
17. As a developer running tests for a sync flow, I want to inject any DeviceCapabilities I like, so that I can exercise edge cases without depending on a connected device.
18. As a developer working on the libgpod replacement (m-8), I want device-identification code to be independent of the libgpod binding, so that ipod-db can be swapped in without touching identification code.
19. As a developer auditing the codebase, I want SCSI inquiry, USB inquiry, plist parsing, and SysInfoExtended file I/O to live in one package with a clean interface, so that "talk to iPod firmware" is one well-defined concern.
20. As a developer reading test failures, I want unit tests on pure modules to pinpoint exactly which lookup or transformation is wrong, so that debugging does not require tracing through layers.

### Maintainer stories

21. As a maintainer, I want generation tables, model lookups, and capability synthesis to live in a single small package, so that fixing data bugs (wrong checksum types, missing model numbers, artwork format updates) is a single-package change.
22. As a maintainer adding doctor checks, I want diagnostics for inquiry methods and sysinfo consistency to register through the existing diagnostics framework, so that the doctor surface remains uniform.
23. As a maintainer, I want USB enumeration to be an extensible framework rather than a hardcoded vendor filter, so that adding mass-storage auto-detection does not require changes scattered across the codebase.
24. As a maintainer, I want firmware-reported capabilities to overlay onto table-derived capabilities rather than replace them, so that partial firmware data (for example, missing video specs on an audio-only model) does not erase known-good values from tables.
25. As a maintainer of the eventual libgpod-free podkit, I want SysInfoExtended-on-disk to remain optional rather than required, so that ipod-db consumers can use parsed FireWireGUID directly without a filesystem round-trip.

## Implementation Decisions

### Package architecture

Four new packages, in this dependency order (later depends on earlier):

- `@podkit/device-types` — shared type definitions only. `DeviceCapabilities`, `AudioCodec`, `DeviceArtworkSource`, `AudioNormalizationMode`, the `DeviceIdentity` discriminated union, the `DeviceProvider<TIdentity>` interface, and supporting unions. No runtime code beyond type guards and constants.
- `@podkit/devices-ipod` — iPod generation tables, model registry, lookup functions, table-derived capability synthesis. Depends on `device-types`. No I/O.
- `@podkit/devices-mass-storage` — built-in mass-storage presets, preset-extension framework, capability synthesis with override support. Depends on `device-types`. No I/O.
- `@podkit/ipod-firmware` — SCSI inquiry, USB-vendor inquiry, inquiry-method selection, plist parsing, SysInfoExtended file I/O, related doctor checks. Depends on `device-types` and `devices-ipod` (for serial-to-variant lookups when parsing identity).

`podkit-core` consumes all four. The `device/` subtree in core retains responsibility for: platform USB walks, mount/eject/partition operations, the enumeration framework that drives Providers, the device adapter implementations (track CRUD), the readiness pipeline, and the diagnostics framework itself.

### The `DeviceIdentity` shape

`identify()` on either device package returns a discriminated union value:

- `IpodIdentity` — `kind: 'ipod'`, plus `displayName`, `generation`, `modelNumber?`, `variant?` (color, capacity), `firewireGuid?`, `serialNumber?`.
- `MassStorageIdentity` — `kind: 'mass-storage'`, plus `displayName`, `brand?`, `model?`. Internally backed by a preset, but the preset id is not part of the public type.

The existing `IpodIdentity` interface in `podkit-core` (which currently means "config-side stored device link") is renamed to free the better name for the new use. The renaming is a mechanical change carried out during P3.

### Provider pattern and enumeration framework

A `DeviceProvider<TIdentity>` carries: a `kind` discriminator string, a `matches(usb)` predicate, and an `identify(usb) → TIdentity | null` function. Providers are pure values.

`podkit-core` exposes `enumerateConnectedDevices({ providers, ... })`. The framework walks the platform USB tree (using existing `usb-discovery.ts` machinery), then asks each provider in `matches` order. The first matching provider's `identify` produces the identity. Multiple providers can claim a class; the order is caller-controlled.

`@podkit/devices-ipod` exports `ipodProvider`. `@podkit/devices-mass-storage` exports either `massStorageProvider` or a `createMassStorageProvider(presets)` factory if the provider needs the user's preset map at construction time. Both forms are pure.

### Capability resolution

Both data packages expose `getCapabilities`:

- `devicesIpod.getCapabilities(identity, { firmware? }) → DeviceCapabilities`. Looks up table-derived capabilities by generation; if `firmware` is supplied, overlays firmware-reported artwork formats, codec specs, and video constraints. Pure.
- `devicesMassStorage.getCapabilities(identity, { presets, overrides? }) → DeviceCapabilities`. Resolves the underlying preset, applies any overrides on top. Pure.

`podkit-core` exposes a thin `resolveCapabilities(identity, opts)` that dispatches by `identity.kind`. The sync engine, planner, and transcoder consume `DeviceCapabilities` and never branch on device class.

### Mass-storage preset framework

Built-in presets are exported as a map:

```
BUILT_IN_PRESETS: Record<BuiltInPresetId, MassStoragePreset>
```

`definePreset(input) → MassStoragePreset` is a pure constructor that validates and normalises a preset definition. There is no `registerPreset` global side-effect. To extend, callers compose:

```
const presets = { ...BUILT_IN_PRESETS, 'my-walkman': definePreset({ ... }) };
```

A preset can extend another by id, with override fields applied on top. Per-device overrides are supplied at the call site of `getCapabilities`, separate from preset definitions.

### Strong-typed and runtime ID symmetry

For both generation IDs and mass-storage preset IDs:

```
const BUILT_IN_PRESET_IDS = ['echo-mini', 'rockbox', 'generic'] as const;
type BuiltInPresetId = typeof BUILT_IN_PRESET_IDS[number];
type PresetId = BuiltInPresetId | (string & {});
```

Strongly-typed programs see the literal union; runtime input from config files accepts arbitrary strings. Same pattern applied to `IpodGenerationId`.

### Inquiry transports and orchestrator

`@podkit/ipod-firmware` provides three layered concerns:

- **Transport — SCSI**: a single async function `scsiReadVpdPages(bus, dev) → bytes[]` that hides the macOS IOKit SCSITaskUserClient interaction or Linux SG_IO ioctl behind a uniform interface. Implementation is platform-specific TypeScript using FFI (`koffi`), unless P0 spike concludes a helper binary is needed for macOS.
- **Transport — USB vendor**: `usbReadVendorBlocks(bus, dev) → bytes` using libusb via FFI. Replaces the libgpod binding's `readSysInfoExtendedFromUsb`.
- **Orchestrator**: `inquireFirmware(fingerprint) → ParsedFirmware | null`. Probes available methods, prefers USB (richer data on 5G+), falls back to SCSI, parses the resulting plist XML, returns structured identity and capabilities. The single deep-module entry point.

### Inquiry method selection

USB-first, SCSI-fallback. Justifications:

- USB returns additional fields (codecs, artwork specs, SQLite schema) on nano 5G/6G/7G that SCSI does not.
- SCSI works on more devices overall (mini, nano 1G/2G, iPod 5G all fail USB inquiry).
- The selection is per-device, decided at orchestrator-call time based on probe results, not by configuration.

### Plist parsing

A small, internal plist-XML parser in `@podkit/ipod-firmware`. Reads the Apple plist subset that SysInfoExtended uses (dict, key, string, integer, data, array, true, false). No external dependency. The existing regex-based extraction in `sysinfo-extended.ts` is replaced by this parser at P1 (used for SCSI XML) and applied throughout at P4.

### SysInfoExtended file lifecycle

`@podkit/ipod-firmware` owns three operations:

- `readSysInfoExtended(mountPoint) → ParsedFirmware | null` — reads and parses an existing on-disk file.
- `writeSysInfoExtended(mountPoint, xml)` — writes raw XML to the canonical path, creating directories as needed.
- `ensureSysInfoExtended(mountPoint, fingerprint) → EnsureResult` — reads if present, otherwise inquires from firmware and writes.

These move from `podkit-core/device/sysinfo-extended.ts` during P4. During P1–P3 the existing core implementation continues to work; the firmware package supplies the inquiry it relies on.

### Diagnostics

Two new diagnostic checks are added during P1, registered via the existing diagnostics framework but living in `@podkit/ipod-firmware`:

- `inquiry-methods` (system scope, no device required) — reports availability of iPodDriver.kext (macOS), libusb, and `/dev/sg*` (Linux). Informational; no repair.
- `sysinfo-consistency` (device scope, per-device) — compares filesystem SysInfoExtended firewireGuid against the live USB descriptor serial. Reports stale or mismatched files. Repair pathway is the existing `sysinfo-extended` repair, which will refresh the file from firmware.

The existing `sysinfo-extended` repair check is rewired during P1 to call the new firmware-package inquiry orchestrator, gaining SCSI fallback at the same time.

### Native code reduction

`@podkit/libgpod-node`'s `readSysInfoExtendedFromUsb` C++ entry point and the dlsym runtime resolution shim are deleted at P2. The libgpod binding loses its USB inquiry surface entirely. Subsequent libgpod replacement work (m-8) does not need to consider inquiry — that concern has migrated to `@podkit/ipod-firmware` and is libgpod-independent.

The m-8 ipod-db design document (doc-003) is updated as part of this work to remove the "SysInfoExtended out of scope" decision (D15), which was based on incomplete information. SysInfoExtended is required for hash58, hash72, and hashAB devices. Its handling continues to live in `@podkit/ipod-firmware`, not in ipod-db.

### Capability layer interaction with libgpod (transitional)

libgpod stays in place during P1–P4. While it remains the active database backend:

- `@podkit/ipod-firmware` continues to write SysInfoExtended to disk so libgpod can read it during database open. This satisfies hash58/hash72 checksum needs.
- `@podkit/devices-ipod` capability synthesis is **independent** of libgpod. It uses generation tables and optional firmware overlay. The current `LibgpodDeviceInfo`-coupled adapter is replaced by a libgpod-free synthesis at P3, with libgpod's reported `supportsVideo`/`supportsArtwork` flags becoming a verification source rather than the authority.

Post-libgpod (m-8 outcome), the on-disk write becomes optional from podkit's perspective (ipod-db consumes parsed FireWireGUID directly), but is preserved for iTunes interop.

### Refactors carried out alongside extraction

These are existing-code-quality issues identified during architecture review. Bundled into the relevant phase rather than carved as separate work, since the moves touch the same code:

- The 815-line `readiness.ts` is split into per-stage files with a small orchestrator. P3 (when extracting devices-ipod, the sysinfo stage talks to the new packages anyway).
- The 2,013-line `ipod-models.ts` is reorganised during extraction: tables in one subdirectory by lookup-axis, lookup functions separated, types collected. P3.
- The `ARTWORK_MAX_RESOLUTION` table that exists in both `device/capability-adapter.ts` and `ipod/generation.ts` is unified in `@podkit/devices-ipod`. P3.
- The capability adapter coupling to `LibgpodDeviceInfo` is removed; capability synthesis becomes purely table-and-firmware-driven. P3/P4.
- Plist parsing migrates from regex extraction to the structured parser. P4.
- `getSiblingVolumes` divergence between platform device managers is reconciled by tightening the platform interface contract. P3 (alongside enumeration framework work).
- The `DeviceTypeId` baked-in literal union in CLI config is replaced by the literal-plus-runtime-string pattern. P3.

Generation table data corrections (B867, Touch checksum, missing model numbers, nano 4G artwork formats, USB ID disambiguation) are tracked separately and not bundled into this work.

### Phasing summary

| Phase | Deliverable | New packages | Risk |
|-------|-------------|--------------|------|
| P0 | FFI spike: koffi + IOKit (mac) + SG_IO (linux) end-to-end SCSI inquiry on real iPod | none | Strategy validation |
| P1 | SCSI inquiry shipped to users; doctor checks; transitional split with libgpod USB inquiry still in place | `device-types`, `ipod-firmware` (skeleton) | Low — additive |
| P2 | USB inquiry consolidated into `ipod-firmware`; libgpod binding loses inquiry entry point | `ipod-firmware` (USB transport added) | Medium — touches native build |
| P3 | Generation tables + presets extracted; Provider/enumeration framework added; refactors of readiness, ipod-models, capability-adapter | `devices-ipod`, `devices-mass-storage` | Medium — broad surface, shims protect callers |
| P4 | SysInfoExtended I/O moved; unified `getCapabilities`; shims removed; libgpod-coupled adapter deleted | none new | Low — finalization |

P0 gates P1. P1 may ship before P2 begins, since the user-visible win (SCSI works) does not depend on consolidation. P3 and P4 should land within one release window of each other to minimise the time core carries shim code.

## Testing Decisions

### What makes a good test

Tests assert external behaviour through public package APIs. They do not patch internal helpers, do not assert which private function was called, and do not lock in implementation details that should be free to change.

For pure modules: feed realistic input fixtures, assert the returned value. For modules with I/O: inject the transport (SCSI byte stream, USB byte stream, filesystem) as a function parameter and feed fixtures. For orchestrators: stub the layer below (transport, parser) and assert that the orchestration logic — selection, fallback, error propagation — is correct.

### Modules to be unit-tested

All eight identified deep modules are unit-tested:

1. **SCSI transport** — fixture-driven byte responses simulating VPD page 0xC0 indices and subpage chunks. Verifies command construction, response assembly, error paths. Prior art: `usb-discovery.test.ts` for fixture-based input parsing.
2. **USB-vendor transport** — fixture-driven byte responses simulating libusb control transfers. Verifies chunk concatenation, short-read termination, error handling.
3. **Inquiry orchestrator** — stubbed transports; verifies USB-first, SCSI-fallback, both-fail-graceful, USB-success-skip-SCSI, malformed-XML-rejection, partial-data-rejection paths. Prior art: `readiness.test.ts` for orchestration with stub stages.
4. **Plist parser** — captured SysInfoExtended XML files from real devices in `documents/sysinfo-captures/` become test fixtures. Verifies dict/key/string/integer/data/array parsing, malformed input handling. Pure unit tests.
5. **Capability synthesis — iPod** — pairs of (identity, optional firmware) → expected DeviceCapabilities. Covers all generations, with firmware overlay both present and absent. Verifies that firmware fields override tables where present and tables fill gaps where firmware is absent. Pure unit tests.
6. **Capability synthesis — mass-storage** — preset-id lookup, override merging, preset-extends-preset chains. Covers built-in presets and user-defined presets. Pure unit tests.
7. **Identity resolution — iPod** — input shapes `{ from: 'usb' | 'serial' | 'sysinfo', ... }` exercised across the full table. Verifies multi-axis lookup, ambiguous-USB-id handling (0x1205, 0x1209), missing-suffix fallback. Pure unit tests. Prior art: `ipod-models.test.ts`.
8. **Provider-driven enumeration** — fake USB-walk fixtures plus a list of providers. Verifies provider-match ordering, kind discrimination, no-match fallthrough. Prior art: `usb-discovery.test.ts`.

### Integration tests

- **Inquiry + parser end-to-end** with real captured XML byte fixtures (no real device required) — verifies that the byte stream from a real nano 4G or nano 7G survives the full parse-and-extract pipeline and produces the expected identity and capabilities.
- **Doctor diagnostic checks** — fixture-driven environment (file presence, mock kext probe, mock USB info) verifying check status and repair routing.
- **Existing E2E suite** continues to cover CLI flows. SCSI is invisible there once wired in; no new E2E tests are required for P1.

### Hardware validation

The five-device test inventory documented in `documents/test-devices.md` is the validation matrix for P1 release. Each device is exercised through:

- Device discovery and identification.
- `podkit doctor`, including the new `inquiry-methods` and `sysinfo-consistency` checks.
- `podkit doctor --repair sysinfo-extended` on a device where SysInfoExtended is missing or stale, confirming the new SCSI fallback path activates correctly on devices that fail USB inquiry (mini 2G, nano 2G, iPod 5G).
- A `podkit sync --dry-run` to confirm capability resolution produces sensible results.

The validation procedure is captured in `documents/device-testing-playbook.md` and updated as part of P1.

### Test-environment isolation

The existing test infrastructure in `@podkit/gpod-testing` (temp-directory iPod fixtures, `gpod-tool` invocation) continues to serve database-related tests. The new firmware-package tests do not require an iPod filesystem fixture — they operate at the byte-stream level. This means new package tests run faster and have no native-binding dependency.

### Virtual iPod compatibility

The Virtual iPod system (m-17) serves SysInfoExtended via a REST/WebSocket API rather than physical USB. The capability resolution path is exercised against virtual iPods naturally — the firmware package's `inquireFirmware` is never called when consuming a virtual iPod, but the data package's `identify` and `getCapabilities` are. The Provider for virtual iPods (whether shipped as part of `devices-ipod` or as a separate package) is out of scope for this PRD but the architecture supports it.

## Out of Scope

- **Generation table data corrections.** Bugs in the existing tables (B867 misclassification, Touch and nano 7G checksum types, missing model numbers, nano 4G artwork formats, USB ID 0x1205/0x1209 disambiguation) are tracked separately. They will be applied to the new `@podkit/devices-ipod` package, but the corrections themselves are not part of this work.
- **iPod nano 6G / 7G full sync support.** Both use DBVersion 5 and hashAB. m-8 ipod-db includes hashAB. This PRD ensures the architecture supports these devices' identification and capability resolution; making sync actually work is downstream.
- **Touch / iPhone / iPad / iOS device support.** These use libimobiledevice, not SCSI or USB-vendor inquiry, and present as iOS rather than mass-storage. Out of scope.
- **macOS plist cache (`~/Library/Preferences/com.apple.iPod.plist`) as a fallback identity source.** Direct inquiry on the connected device covers the case that matters; the cache is a deferrable enhancement.
- **iPod overrides analogous to mass-storage overrides.** A user wanting to disable artwork on an iPod that supports it is a sync-feature concern, not a capability-resolution concern. Capability resolution reports what the device supports; sync configuration decides what to use.
- **Plugin discovery via package.json or runtime introspection.** Providers and presets are values that programs compose explicitly. A plugin discovery mechanism is a future extension if the user base wants it, not part of this work.
- **Windows support.** Existing podkit Windows support is unimplemented. SCSI inquiry on Windows would require IOCTL_SCSI_PASS_THROUGH; out of scope.
- **Renaming or relocating existing E2E infrastructure** (`@podkit/e2e-tests`, `@podkit/gpod-testing`). These continue to serve their current purpose.
- **The libgpod replacement itself (m-8).** This work is a precondition for clean m-8 execution but does not perform the swap.

## Further Notes

### Decision provenance

The architectural shape of this work was reached through a multi-round design conversation. Key decisions and the reasoning behind them:

- **Four packages rather than three.** A separate `@podkit/device-types` types-only package avoids a circular dependency between the data packages and `podkit-core`. Cheap to maintain; clear ownership.
- **Provider pattern rather than registration with side effects.** Providers and presets are values the caller composes. Two Echo Minis can be configured differently in the same program because there is no global state.
- **`@podkit/ipod-firmware` rather than splitting SCSI and USB inquiry.** Both transports talk to the same conceptual subject (the iPod's firmware) and produce the same XML output. Splitting them would create an artificial boundary.
- **"Preset" as an internal term in `@podkit/devices-mass-storage`.** External vocabulary is "identity" and "capabilities", symmetrical with the iPod side. Preset is how mass-storage internally represents capability data, but the consumer-facing API does not require thinking in terms of presets.
- **String-literal-plus-runtime-string union.** Allows strongly-typed programs and runtime-driven programs without forcing one or the other.
- **FFI (`koffi`) rather than additional native bindings.** Aligns with the libgpod replacement direction — the project is moving away from C++. The P0 spike validates this before package work commits to it.

### Reference documents

- `documents/device-identification.md` — living document on iPod identification strategies, platform implementations, and inquiry method boundaries. Required reading for anyone implementing P1.
- `documents/test-devices.md` — hardware test inventory with verified results for each of the five available iPods.
- `documents/device-testing-playbook.md` — step-by-step validation procedure, updated during P1.
- `documents/sysinfo-captures/` — captured SysInfoExtended XML files from real devices, available as test fixtures.
- `doc-013` (Spec: Device Capabilities Interface) — the existing `DeviceCapabilities` interface design, preserved by this work.
- `doc-020` (Architecture: Multi-Device Support Decisions) — the multi-device support decisions whose "no package split" guidance is being revisited here. The reason for revisiting: the package split is no longer about extracting iPod from mass-storage; it is about establishing a clean device-knowledge layer that survives the libgpod replacement.
- `doc-029` (PRD: Automated iPod Device Identification via SysInfoExtended) — the predecessor PRD, which committed to libusb-only inquiry. This PRD supersedes that decision in favour of SCSI-as-fallback, justified by hardware testing showing USB inquiry fails on the mini, nano 1G/2G, and iPod 5G generations.
- `doc-003` (ipod-db Design Document) — needs an addendum to revise decision D15 (SysInfoExtended out of scope) based on the findings here.

### ADR

A new ADR will be created during P1 capturing:

- The shift from libusb-only inquiry to USB-first / SCSI-fallback selection.
- The decision to use FFI rather than additional native bindings.
- The four-package architecture and the Provider pattern.

The ADR cross-references this PRD and the per-phase spec documents that follow.

### Per-phase specs

This PRD is followed by individual spec documents per phase, written as each phase becomes ready to start:

- Spec: Phase 0 — FFI SCSI inquiry spike.
- Spec: Phase 1 — `@podkit/ipod-firmware` SCSI delivery + doctor checks.
- Spec: Phase 2 — USB inquiry consolidation into `@podkit/ipod-firmware`.
- Spec: Phase 3 — `@podkit/devices-ipod` and `@podkit/devices-mass-storage` extraction with Provider framework.
- Spec: Phase 4 — SysInfoExtended I/O migration, unified capability resolution, shim removal.

Each spec covers acceptance criteria, file-level changes, function signatures, test plan, and migration steps for that phase. Phase specs are detailed enough that an independent implementer can execute the phase without re-deriving design decisions from this PRD.
