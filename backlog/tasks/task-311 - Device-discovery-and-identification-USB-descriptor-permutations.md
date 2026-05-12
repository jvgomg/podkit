---
id: TASK-311
title: 'Device discovery and identification: USB descriptor permutations'
status: To Do
assignee: []
created_date: '2026-05-08 07:25'
updated_date: '2026-05-12 11:57'
labels:
  - testing
  - device-discovery
  - identification
  - vm-coverage
milestone: m-19
dependencies: []
priority: medium
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Verify the device-discovery and identification pipelines (`@podkit/devices-ipod` `identify()`, `@podkit/podkit-core` `discoverUsbIpods` / `resolveUsbDeviceFromPath`, `@podkit/ipod-firmware` `inquireFirmware`) end-to-end against synthetic USB descriptors. These pipelines feed everything else — the readiness stages, the sysinfo-consistency check, sync's writability, the device manager's `findIpodDevices` — and they're currently exercised only via unit tests with hand-written USB-descriptor JSON.

Adjacent to doctor coverage but worth its own ticket: `podkit device scan`, `podkit device info`, and `podkit device add` consume the same discovery surface. Pinning the matrix here makes those commands' tests far cheaper to write.

For every test, place the platform in a known USB state (one or more synthetic Apple/iPod descriptors, with controllable vendorId/productId/serialNumber/bus/devnum), then run the relevant podkit subcommand or core API and assert on the resolved identity.

---

**Harness note (TASK-321.08 sweep):** Tests implementing this task must use the `@podkit/device-testing` package:
- **T1 (unit):** import `personas` from `@podkit/device-testing`; use `DevicePersona.usbDescriptor` fields as the injectable fake USB descriptor — covers `identify()`, `discoverUsbIpods`, and `resolveUsbDeviceFromPath` logic without any real USB hardware
- **T3 (integration):** tests tagged `*.linux.tier3.test.ts` run inside the `lima-test-vm` runner; the FunctionFS daemon synthesises the USB device from the `DevicePersona.usbDescriptor`, providing real libusb/udev enumeration for each starter persona
- **T2 (native subprocess):** `resolveUsbDeviceFromPath` subprocess tests (real `lsblk` on Linux, real `system_profiler` on mac) are tagged `*.linux.test.ts` / `*.darwin.test.ts`; canned fixtures live in `@podkit/device-testing` persona directories (`lsblkJson`, `systemProfilerJson`)
- See `agents/device-testing.md` and ADR-016/ADR-017 for the full harness architecture
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Single iPod USB descriptor (5G, productId=1209): discoverUsbIpods returns one entry with model.generationId='video_5g', isApple=true, no unsupportedReason
- [ ] #2 Single iPod USB descriptor for every supported generation (5G, classic 6G, nano 1–7G, shuffle 1–4G, mini): identify({from:'usb',productId}) resolves the right generationId for each
- [ ] #3 iOS-range product ID (e.g. iPhone): identify returns undefined OR result with notSupportedReason populated; podkit device add fails with that reason on stderr
- [ ] #4 Apple vendor with unknown product ID: identify returns undefined; discoverUsbIpods reports the device but with no model
- [ ] #5 Non-Apple vendor: discoverUsbIpods does not include the device
- [ ] #6 Multiple iPods connected simultaneously: discoverUsbIpods returns all of them, in stable order; each carries its own bus/devnum
- [ ] #7 USB descriptor missing serialNumber: discoverUsbIpods still returns the device, model resolves from productId; resolveUsbDeviceFromPath returns serialNumber=undefined and downstream FireWireGUID checks skip rather than fail
- [ ] #8 USB descriptor with malformed serialNumber (non-hex characters): identify({from:'serial',...}) returns undefined; doctor's sysinfo-consistency model axis skips with reason
- [ ] #9 resolveUsbDeviceFromPath: returns the right bus/devnum/serialNumber for a given mount path on Linux (sysfs walk) and macOS (system_profiler)
- [ ] #10 resolveUsbDeviceFromPath: returns null for a mount path that doesn't correspond to any USB device (network mount, snapshot)
- [ ] #11 inquireFirmware(fp): when libusb is available and USB inquiry succeeds, returns ParsedFirmware with firewireGuid + serialNumber + capabilities
- [ ] #12 inquireFirmware(fp): when libusb fails but SCSI is available, falls back to SCSI and returns ParsedFirmware (USB-then-SCSI plan)
- [ ] #13 inquireFirmware(fp): when both transports unavailable, returns null without throwing
- [ ] #14 inquireFirmware(fp): when the transport returns parseable bytes that fail extractFromPlist (missing required fields), returns null without falling back
- [ ] #15 podkit device scan output: lists every iPod descriptor with vendorId, productId, model, serialNumber, mounted/unmounted state
- [ ] #16 podkit device info output: matches the descriptor + identify() result for the connected device
- [ ] #17 podkit device add: succeeds for a supported iPod, fails with the unsupportedReason for an iOS-range product ID, fails with appropriate message when no Apple device is connected
<!-- AC:END -->
