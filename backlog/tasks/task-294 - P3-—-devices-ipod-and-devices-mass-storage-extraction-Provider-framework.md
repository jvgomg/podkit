---
id: TASK-294
title: P3 — devices-ipod and devices-mass-storage extraction + Provider framework
status: In Progress
assignee: []
created_date: '2026-05-03 11:32'
updated_date: '2026-05-08 08:12'
labels:
  - device-capability-architecture
  - phase-3
milestone: m-18
dependencies:
  - TASK-293
documentation:
  - backlog/docs/doc-030 - PRD-Device-Capability-Architecture.md
  - >-
    backlog/docs/doc-034 -
    Spec-Phase-3-devices-ipod-and-devices-mass-storage-extraction.md
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Move iPod generation tables into `@podkit/devices-ipod`. Move mass-storage presets into `@podkit/devices-mass-storage` with a user-extensible registry framework. Add the Provider pattern and a unified, extensible enumeration framework to `podkit-core`. Bundle adjacent code-quality refactors that the moves naturally touch (split readiness.ts, unify ARTWORK_MAX_RESOLUTION, rename IpodIdentity, open DeviceTypeId).

User-visible outcome: Echo Mini and other mass-storage devices with known USB IDs are auto-detected at `device add` time. Capability resolution unchanged from the user's perspective.

This is the parent task for the P3 phase. Sub-tasks cover each new package, the framework, and each adjacent refactor.

See spec doc-034 for full details.

Parent PRD: doc-030 (PRD: Device Capability Architecture).
Blocked by: TASK-293 (P2 main).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 @podkit/devices-ipod and @podkit/devices-mass-storage packages exist, build, pass tests in CI
- [ ] #2 All capability resolution produces byte-identical DeviceCapabilities to pre-P3 code (snapshot parity)
- [ ] #3 device add auto-detects an Echo Mini by USB VID/PID without --type flag
- [ ] #4 device add --type my-walkman works with user-registered preset
- [ ] #5 Two Echo Minis can be configured with different overrides in the same program
- [ ] #6 core/device/readiness.ts replaced by readiness/ subdirectory with per-stage modules; tests pass
- [ ] #7 IpodIdentity (config-link) renamed to StoredIpodLink everywhere
- [ ] #8 usb-discovery.ts no longer hardcodes Apple VID; classification is providers' job
- [ ] #9 Re-export shims in core for ipod-models.ts, presets.ts, capability-adapter.ts in place
- [ ] #10 ARTWORK_MAX_RESOLUTION unified in @podkit/devices-ipod (no duplicate)
- [ ] #11 LibgpodDeviceInfo adapter type gone
- [ ] #12 CLI --type flag accepts any string; built-ins still autocomplete
- [x] #13 Hardware validation per inventory: all five devices behave identically to P2
- [ ] #14 AGENTS.md updated with new package list
- [ ] #15 Unsupported iPods (Shuffle 3G/4G, Nano 6G, Touch) produce a friendly 'not supported' error at device add instead of a cryptic firmware failure
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
P3.5 polish pass (unsupported-iPod tagging):
- Added `packages/devices-ipod/src/tables/unsupported.ts` with `UNSUPPORTED_IPOD_PRODUCT_IDS` map (Shuffle 3G/4G, Nano 6G, Touch 1G–7G) and `lookupUnsupportedReason()` helper.
- Added `notSupportedReason?: string` to `IpodModel` (devices-ipod/types.ts) and `IpodIdentity` (device-types/identity.ts).
- `identify({ from: 'usb', ... })` now populates `notSupportedReason` when the product ID is a known unsupported iPod.
- `ipodProvider.detect()` now short-circuits for unsupported devices: returns a tagged identity with `notSupportedReason` WITHOUT calling `inquireFirmware`.
- CLI `device add` flow checks the enumerated result for an unsupported iPod identity and surfaces a friendly error before attempting firmware/database work. `--type ipod` explicit flag bypasses this gate.
- 9 new tests in identity.test.ts, 14 new tests in provider.test.ts (including firmware-not-called assertion), 1 new test in device-add.unit.test.ts.
- Legacy `UNSUPPORTED_IPODS` / `IPOD_TOUCH_IDS` blocks in usb-discovery.ts left untouched per constraint (P4 removal target).

P3.5 polish pass: `DeviceCapabilities.artworkMaxResolution` migrated from `number` (with `0` sentinel) to `number | null` for type honesty. `IpodGeneration.artworkMaxResolution` in `devices-ipod/src/types.ts` also updated to `number | null`. 9 generation table entries changed from `0` to `null` (classic_1g/2g/3g/4g, mini_1g/2g, shuffle_1g/2g/3g/4g). Updated `getArtworkMaxResolution` in `podkit-core/src/ipod/capabilities.ts` and `capability-adapter.ts` to use `?? null`. Consumer `config.ts` updated to coerce `null` to `undefined` via `?? undefined`. 8 test assertions updated across 3 test files.

P3.5 polish pass (UsbConnectionInfo retirement): UsbConnectionInfo was fully retired. UsbFingerprint from @podkit/device-types is now the single type across the entire codebase. bus/devnum made optional in UsbFingerprint to handle early-discovery contexts where bus addressing is unavailable (e.g. macOS system_profiler when location_id is absent). No back-compat shim added — P3.5 is pre-release so in-tree breakage is contained. 16 files modified: device-types/identity.ts, device-types/index.ts, usb-discovery.ts, assessment.ts, readiness/types.ts, readiness/stages/sysinfo.ts, enumeration.ts, platforms/linux.ts, platforms/macos.ts, diagnostics/checks/sysinfo-extended.ts, core/index.ts, device/index.ts, devices-mass-storage/identity.ts, devices-mass-storage/identity.test.ts, devices-mass-storage/provider.ts, podkit-cli/device.ts. ipod-firmware/inquiry/usb.ts gained a guard that throws UsbInquiryError(device-not-found) when bus/devnum are absent from the fingerprint.

## Data-accuracy fix (2026-05-06)

Audited `packages/devices-ipod` device-support data against libgpod 0.8.3 `ipod_info_table` (tools/libgpod-macos/build/libgpod-0.8.3/src/itdb_device.c).

### libgpod's actual support list
libgpod has ipod_info_table entries for: classic 1G–4G, Photo, Video 5G/5.5G, Classic 6G/7G (G1–G3 in libgpod naming), Mini 1G/2G, Nano 1G–6G, Shuffle 1G–4G, Touch 1G–4G, iPhone 1G–4G, iPad 1G. No entries for Nano 7G or Touch 5G–7G.

### Confirmed inaccuracies corrected
1. **Nano 7G** (PIDs 0x120e, 0x1267): Was listed as supported. Not in libgpod's ipod_info_table. Added to UNSUPPORTED_IPOD_PRODUCT_IDS with reason distinguishing 'not in libgpod's device table'.
2. **Touch 1G–7G** (all PIDs): All use Apple's proprietary sync protocol with no disk mode. Previously only some had per-PID unsupported entries; now all 7 PIDs have generation-specific reason text. Touch 1G–4G have libgpod table entries but are inaccessible (no disk mode).
3. **iPhone/iPad PIDs added**: 0x1290, 0x1294, 0x1297, 0x129c, 0x12a2, 0x12a6, 0x12aa, 0x129f, 0x12a3, 0x12a4, 0x12a5 — all with distinguished reason texts (iPhone vs iPad).
4. **Shared PIDs** (0x1292, 0x129a, 0x12a9): Appear on multiple Apple product lines; use generic 'iOS device' reason.
5. **Range-catch fallback** added: `lookupIosRangeFallbackReason()` catches Apple-vendor PIDs 0x1290–0x12af not in IPOD_USB_IDS, so future iPhone/iPad/Touch generations produce an informative 'not supported' message.

### New `supported: boolean` field
Added to `IpodGeneration` interface and all GENERATIONS entries. False for: nano_6g, nano_7g, shuffle_3g, shuffle_4g, touch_1g–7g. Identity facade now populates `IpodModel.notSupportedReason` from both the PID table and the generation flag.

### Files modified
- `packages/devices-ipod/src/types.ts` — added `supported` to IpodGeneration, `notSupportedReason` to IpodModel
- `packages/devices-ipod/src/tables/generations.ts` — added `supported` field to all entries
- `packages/devices-ipod/src/tables/unsupported.ts` — nano 7G PIDs, iPhone/iPad PIDs, distinguished reasons, range-catch fallback
- `packages/devices-ipod/src/identity.ts` — populates notSupportedReason from PID table + generation flag
- `packages/devices-ipod/src/index.ts` — exports new unsupported table functions
- `packages/devices-ipod/src/identity.test.ts` — 11 new tests for notSupportedReason coverage
- `packages/podkit-core/src/device/usb-discovery.ts` — delegates to @podkit/devices-ipod unsupported table; range-catch now applies to all Apple devices (not just those with a model entry)
- `packages/podkit-core/src/device/usb-discovery.test.ts` — updated reason-text assertion
<!-- SECTION:NOTES:END -->
