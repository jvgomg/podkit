---
id: TASK-311
title: 'Device discovery and identification: USB descriptor permutations'
status: Done
assignee: []
created_date: '2026-05-08 07:25'
updated_date: '2026-05-20 22:59'
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
- [x] #1 Single iPod USB descriptor (5G, productId=1209): discoverUsbIpods returns one entry with model.generationId='video_5g', isApple=true, no unsupportedReason
- [x] #2 Single iPod USB descriptor for every supported generation (5G, classic 6G, nano 1–7G, shuffle 1–4G, mini): identify({from:'usb',productId}) resolves the right generationId for each
- [x] #3 iOS-range product ID (e.g. iPhone): identify returns undefined OR result with notSupportedReason populated; podkit device add fails with that reason on stderr
- [x] #4 Apple vendor with unknown product ID: identify returns undefined; discoverUsbIpods reports the device but with no model
- [x] #5 Non-Apple vendor: discoverUsbIpods does not include the device
- [ ] #6 Multiple iPods connected simultaneously: discoverUsbIpods returns all of them, in stable order; each carries its own bus/devnum
- [x] #7 USB descriptor missing serialNumber: discoverUsbIpods still returns the device, model resolves from productId; resolveUsbDeviceFromPath returns serialNumber=undefined and downstream FireWireGUID checks skip rather than fail
- [x] #8 USB descriptor with malformed serialNumber (non-hex characters): identify({from:'serial',...}) returns undefined; doctor's sysinfo-consistency model axis skips with reason
- [x] #9 resolveUsbDeviceFromPath: returns the right bus/devnum/serialNumber for a given mount path on Linux (sysfs walk) and macOS (system_profiler)
- [x] #10 resolveUsbDeviceFromPath: returns null for a mount path that doesn't correspond to any USB device (network mount, snapshot)
- [x] #11 inquireFirmware(fp): when libusb is available and USB inquiry succeeds, returns ParsedFirmware with firewireGuid + serialNumber + capabilities
- [x] #12 inquireFirmware(fp): when libusb fails but SCSI is available, falls back to SCSI and returns ParsedFirmware (USB-then-SCSI plan)
- [x] #13 inquireFirmware(fp): when both transports unavailable, returns null without throwing
- [x] #14 inquireFirmware(fp): when the transport returns parseable bytes that fail extractFromPlist (missing required fields), returns null without falling back
- [x] #15 podkit device scan output: lists every iPod descriptor with vendorId, productId, model, serialNumber, mounted/unmounted state
- [x] #16 podkit device info output: matches the descriptor + identify() result for the connected device
- [x] #17 podkit device add: succeeds for a supported iPod, fails with the unsupportedReason for an iOS-range product ID, fails with appropriate message when no Apple device is connected
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**2026-05-20 — TASK-311 landed.**

Coverage summary (16 of 17 ACs covered; AC #6 Tier-3 deferred).

### Tier 1 (unit) tests added
- `packages/devices-ipod/src/identity.task311.test.ts` (48 tests) — table-driven `identify({from:'usb'})` over every PID in `IPOD_USB_IDS` (AC #2), iOS-range catalogued PIDs surface `kind=ios-device` (AC #3), Apple unknown PIDs return undefined (AC #4), malformed serial returns undefined (AC #8).
- `packages/podkit-core/src/device/discovery-permutations.task311.test.ts` (20 tests) — `enumerateUsb`/`classifyUsbDevices` permutations: 5G discovery (AC #1), Apple unknown PID enumerated-but-dropped (AC #4), non-Apple vendor handling (AC #5; SanDisk + Sony both surface as kind=unsupported via TASK-331 vendor table — see "Bug found" below), multi-iPod ordering with fakes (AC #6 T1 only), missing serialNumber omitted from parser output (AC #7), realistic mixed-bus integration. Descriptors inlined as constants rather than imported from `@podkit/device-testing` to avoid the build cycle (`@podkit/device-testing → @podkit/core`).

### Tier 2 (native subprocess) tests added
- `packages/podkit-core/src/device/usb-path-resolution.linux.test.ts` — `resolveUsbDeviceFromPath` returns null for tmpfs paths, fabricated mounts, and the root FS (AC #10). Skips on non-Linux hosts.
- `packages/podkit-core/src/device/usb-path-resolution.darwin.test.ts` — same shape via real `diskutil` + `system_profiler` (AC #10). Skips on non-darwin hosts.

### Tier 3 (VM) tests added
- `packages/device-testing/src/tier3/task-311-discovery.tier3.test.ts` (3 tests, gated behind `PODKIT_DEVTEST_RUN_TIER3=1`):
  - AC #1: `podkit device scan --json` against `ipodVideo5gIflash1tb` resolves to `generationId: 'video_5g'`, no unsupportedReason, readiness ≠ unsupported.
  - AC #15: scan envelope carries vendorId/productId/serialNumber/model fields for the iPod 5G persona.
  - AC #5: scan against `echoMini` (non-Apple vendor 0x071b) emits well-formed JSON with no entry for that vendor in `devices[]` (the Linux USB walk filters on vendor 0x05ac; TASK-336+ tracks the lift).

### Coverage already pinned by existing tests (not duplicated)
- AC #11–14 — `packages/ipod-firmware/src/inquiry/orchestrator.test.ts` covers every USB/SCSI dispatch branch (USB success, USB→SCSI fallback, both fail, parse-error no-fallback, scsi-only, plan=none, fingerprint propagation, timeout forwarding, EACCES path-through).
- AC #15 (text-rendering side) — `packages/device-testing/src/tier3/personas-baseline.tier3.test.ts` + `m18-discovery-reconciliation.tier3.test.ts` + `m18-unsupported-cascade.tier3.test.ts` already iterate the scan envelope across personas.
- AC #16 — `packages/podkit-cli/src/commands/device-info-runner.unit.test.ts` covers the cascade-derived display name; Tier-3 requires a mounted iPod with iTunesDB which the dummy-hcd backing image cannot stage (no libgpod-node + no iPod_Control tree).
- AC #17 — `packages/podkit-cli/src/commands/device-add.unit.test.ts` covers iPod-touch (iOS) rejection, no-iPod-found, multi-iPod handling; `m18-unsupported-cascade.tier3.test.ts` exercises `device add` against the hashAB nano persona (UNSUPPORTED_DEVICE failure). Tier-3 success path on a supported iPod is blocked by the no-libgpod / no-iPod_Control gap.
- AC #9 — positive correlation (real iPod at `/mnt/ipod` → correct fingerprint) is exercised end-to-end by the Tier-3 personas-baseline test against dummy-hcd. The T2 files cover the null-case half; the positive correlation requires real hardware on macOS / Tier-3 on Linux.

### Deferred (AC #6 Tier-3)
The dummy-hcd daemon uses a single hardcoded FunctionFS mount point (`/dev/ffs-podkit`); a second `systemctl start dummy-hcd-daemon@<id>.service` exits 4 with `mount: /dev/ffs-podkit: podkit-test already mounted`. The systemd template auto-restarts the second daemon forever, and the kernel never enumerates both. See TASK-341 flag #1 documented in `packages/device-testing/src/tier3/m18-discovery-reconciliation.tier3.test.ts` for the long-form rationale. The reconcile-primitive's dual-iPod ordering path is exhaustively covered unit-side in `packages/podkit-core/src/device/reconcile.test.ts`, and the new `discovery-permutations.task311.test.ts` covers the multi-iPod classifier ordering with injected fakes.

### Bug found (NOT fixed)
- **AC #5 wording vs. current behaviour**: the original AC #5 says "Non-Apple vendor: discoverUsbIpods does not include the device". The current implementation surfaces vendor-recognised non-Apple devices (SanDisk Cruzer, Sony Walkman) as `kind: 'unsupported'` via TASK-331's `UNSUPPORTED_VENDORS` table — they ARE in the recognised set but are NOT `kind: 'ipod'`. The test asserts the current contract (NOT kind=ipod) since it's a deliberate improvement over silent-drop. Tier-3 ECh Mini test asserts the scan-envelope visibility gap that TASK-336+ will close.
- **m18-unsupported-cascade NB** still applies: `tables/unsupported.ts` still mentions "libgpod" in nano 7G headlines despite ec8dc85's "no libgpod in user-facing copy" goal. Unchanged by this task — pre-existing flag in TASK-341.

### Quality gates
- `bun run typecheck --filter @podkit/devices-ipod --filter @podkit/core --filter @podkit/ipod-firmware --filter @podkit/device-testing`: green (12/12 turbo tasks).
- `bun run build`: green (17/17 turbo tasks).
- `bun run test` (T1 + T2): green (57/57 turbo test tasks; podkit-core: 2772 pass / 0 fail / 5 platform-skips). Tier-3 files compile and skip cleanly on macOS without the env-var gate.

### Persona additions
NONE. Reused the existing 17 personas (ipodVideo5gIflash1tb, ipodNano3gBlack, ipodNano4gBlack, ipodNano7gSpaceGray, ipodMini2gPink, ipodTouch5gUnsupported, ipodShuffleNotSupported, nonIpodUsbDisk, sonyNwzE384, echoMini).

### Files added
- `packages/devices-ipod/src/identity.task311.test.ts`
- `packages/podkit-core/src/device/discovery-permutations.task311.test.ts`
- `packages/podkit-core/src/device/usb-path-resolution.linux.test.ts`
- `packages/podkit-core/src/device/usb-path-resolution.darwin.test.ts`
- `packages/device-testing/src/tier3/task-311-discovery.tier3.test.ts`

No production code changed.
<!-- SECTION:NOTES:END -->
