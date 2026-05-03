---
id: doc-032
title: 'Spec: Phase 1 — ipod-firmware SCSI delivery'
type: other
created_date: '2026-05-03 11:18'
---
## Phase

P1 of doc-030 (PRD: Device Capability Architecture). Gated by P0 spike.

## Goal

Ship SCSI inquiry to users. Create `@podkit/device-types` and `@podkit/ipod-firmware` packages. Wire SCSI fallback into the existing `podkit doctor --repair sysinfo-extended` flow. Add two new doctor checks. Existing podkit-core device code stays untouched.

User-visible outcome: a user with an iPod mini 2G, nano 2G, or iPod 5G Video — devices where USB inquiry fails — can run `podkit doctor --repair sysinfo-extended` and have their device fully identified.

## Scope

### New packages

**`@podkit/device-types`** — types only.

- `DeviceCapabilities`, `AudioCodec`, `DeviceArtworkSource`, `AudioNormalizationMode` — moved unchanged from `podkit-core/device/capabilities.ts` (core re-exports for back-compat).
- `DeviceIdentity` discriminated union (`IpodIdentity | MassStorageIdentity`) — new.
- `DeviceProvider<TIdentity>` interface — new.
- `UsbFingerprint` — new (vendor, product, serial, bus, devnum).
- `ParsedFirmware` — new (firewireGuid, serialNumber, capabilities subset).
- No runtime code beyond const arrays and type guards.

**`@podkit/ipod-firmware`** — SCSI delivery skeleton.

```
packages/ipod-firmware/src/
  index.ts                       public exports
  inquiry/
    scsi/
      index.ts                   platform dispatch
      macos.ts                   IOKit SCSITaskUserClient via koffi (or helper binary per P0)
      linux.ts                   SG_IO ioctl via koffi
      types.ts                   SCSI command types
    usb.ts                       transitional: delegates to libgpod-node's existing readSysInfoExtendedFromUsb
    selection.ts                 USB-first / SCSI-fallback orchestration
    orchestrator.ts              inquireFirmware() — single deep entry point
    probe.ts                     method availability detection (kext, libusb, /dev/sg)
  plist/
    parser.ts                    structured plist parser
    types.ts                     PlistValue union
  firmware/
    extract.ts                   ParsedFirmware ← plist value tree
  diagnostics/
    inquiry-methods.ts           system-scope check
    sysinfo-consistency.ts       device-scope check
```

### Wired into core

- `podkit-core/device/sysinfo-extended.ts` `ensureSysInfoExtended` — replace its direct `libgpod.readSysInfoExtendedFromUsb` call with a call to `@podkit/ipod-firmware`'s `inquireFirmware`. The existing function signature stays. Behaviour gains SCSI fallback transparently.
- `podkit-core/diagnostics/checks/` — register the two new checks from the firmware package.
- `podkit-core/device/sysinfo-extended.ts` plist-extraction path — keep the existing regex extraction during P1 (for the legacy on-disk-read code path) and use the firmware package's plist parser only for the new SCSI inquiry path. Full migration to the structured parser happens at P4.

### Not changed in P1

- libgpod-node binding stays as-is. Its `readSysInfoExtendedFromUsb` is the USB inquiry implementation that `@podkit/ipod-firmware`'s `inquiry/usb.ts` delegates to. Removed in P2.
- `podkit-core/device/ipod-models.ts` stays in core. Identity resolution uses the existing `resolveIpodModel` facade. Extracted in P3.
- `podkit-core/device/presets.ts` stays in core. Extracted in P3.

## Key function signatures

```typescript
// @podkit/device-types
export type UsbFingerprint = {
  vendorId: string;
  productId: string;
  serialNumber?: string;
  bus: number;
  devnum: number;
};

export type ParsedFirmware = {
  firewireGuid: string;
  serialNumber: string;
  rawXml: string;
  capabilities?: FirmwareCapabilities;  // populated when extraction succeeds
};

export type FirmwareCapabilities = {
  audioCodecs: { codec: string; sampleRates?: number[]; bitDepths?: number[] }[];
  videoCodecs?: { codec: string; profile?: string; level?: string; maxResolution?: string; maxBitrate?: number }[];
  artworkFormats?: { formatId: number; width: number; height: number; pixelFormat?: string }[];
  albumArtFormats?: { formatId: number; width: number; height: number; pixelFormat?: string }[];
  familyId: number;
  dbVersion?: number;
  firmwareVersion?: string;
  ramBytes?: number;
};

// @podkit/ipod-firmware
export function inquireFirmware(
  fp: UsbFingerprint,
  opts?: { transports?: { scsi?: ScsiTransport; usb?: UsbTransport } }
): Promise<ParsedFirmware | null>;

export function probeInquiryMethods(): Promise<{
  scsi: { available: boolean; reason?: string };
  usb: { available: boolean; reason?: string };
}>;

export function parsePlist(xml: string): PlistValue;

export const inquiryMethodsCheck: DiagnosticCheck;
export const sysinfoConsistencyCheck: DiagnosticCheck;
```

## Acceptance criteria

1. `@podkit/device-types` and `@podkit/ipod-firmware` packages build, type-check, and pass tests in CI.
2. `inquireFirmware()` returns a `ParsedFirmware` on each of the five inventory devices (mini 2G, nano 2G, nano 4G, nano 7G, iPod 5G Video).
3. On nano 4G and nano 7G (USB inquiry succeeds), `inquireFirmware()` uses USB and never invokes SCSI.
4. On mini 2G, nano 2G, iPod 5G Video (USB inquiry fails), `inquireFirmware()` falls back to SCSI and produces a valid result.
5. `podkit doctor --repair sysinfo-extended` writes SysInfoExtended successfully on all five devices.
6. `podkit doctor` (no device) shows the new `inquiry-methods` check, reporting iPodDriver.kext (macOS) or `/dev/sg*` (Linux) and libusb status.
7. `podkit doctor -d <device>` shows the `sysinfo-consistency` check on a device whose disk SysInfoExtended firewireGuid does not match the live USB descriptor — reports stale, recommends repair.
8. Existing podkit-core, podkit-cli, libgpod-node tests pass with no regressions.
9. New unit tests achieve coverage on: plist parser (XML fixtures), SCSI transport (byte-stream fixtures), inquiry orchestrator (stubbed transports), method-availability probe (mocked filesystem and FFI presence).
10. Hardware validation per `documents/device-testing-playbook.md` Phase 3, on all five devices, recorded in `documents/test-devices.md`.
11. P0 spike directory removed.
12. Public API of the two new packages documented (TSDoc on exports + README).

## Test plan

### Unit tests

| Module | Coverage |
|--------|----------|
| Plist parser | Round-trip on all 5 captured XML files; malformed input rejection (truncated, missing closing tag, unknown element, invalid UTF-8); subset element types (dict, key, string, integer, data, true, false, array). |
| SCSI transport (mac + linux, separately) | Fake byte stream stand-in for FFI return; verify CDB construction for INQUIRY 0x12 0x01 page; verify response assembly across pages; verify error propagation for short-read, sense data, timeout. |
| USB transport | During P1, this is a thin shim over libgpod-node — minimal tests, primarily that the shim correctly forwards bus/devnum and surfaces errors. |
| Inquiry orchestrator | Stubbed transports — verify USB-first, SCSI-fallback, USB-success-no-SCSI, both-fail-graceful, malformed-XML-rejection, identity-extraction-failure paths. |
| Method probe | Mocked filesystem (kext path, /dev/sg) and mocked FFI loader (libusb presence). |
| Diagnostics — inquiry-methods | Mocked probe results — verify pass / warn output formatting. |
| Diagnostics — sysinfo-consistency | Mocked filesystem (SysInfoExtended XML present / absent / mismatch) and mocked USB descriptor — verify check status and repair routing. |

### Integration tests

- End-to-end inquiry-with-real-XML: feed a captured XML byte stream through the orchestrator → parser → extractor; verify the produced `ParsedFirmware` matches a hand-written expected value for that device.
- Wire-into-core test: invoke `ensureSysInfoExtended` from podkit-core with a stubbed firmware-package transport; verify the existing function still satisfies its existing tests.

### Hardware validation

Run `documents/device-testing-playbook.md` Phase 3 against all five inventory devices. Record results in `documents/test-devices.md`. Specifically validate:

- Each device's `Inquiry results` table is updated with "podkit doctor SCSI: works" / "podkit doctor USB: works/fails" entries.
- The XML written to disk by `--repair sysinfo-extended` matches the captures already in `documents/sysinfo-captures/`.

## Migration steps

1. P0 spike landed and findings approved.
2. Bootstrap `@podkit/device-types`. Move types from `podkit-core/device/capabilities.ts`. Add re-export shim in core.
3. Bootstrap `@podkit/ipod-firmware`. Build infra, lint, test runner.
4. Implement plist parser. Tests against captured XML.
5. Implement SCSI transport per P0 findings.
6. Implement USB transport shim over libgpod-node.
7. Implement orchestrator and selection.
8. Implement method probe.
9. Wire `core/device/sysinfo-extended.ts` to call `inquireFirmware`. Existing tests pass.
10. Implement diagnostic checks. Register from core.
11. Hardware validation on all 5 devices.
12. Documentation: package READMEs, TSDoc, AGENTS.md update, `documents/test-devices.md` update.
13. Changeset entries for `podkit` (CLI surface unchanged but doctor output changes), `@podkit/core` (sysinfo-extended internal change), and the new packages.
14. Release.

## Risks

- **macOS IOKit through FFI fails late.** Mitigated by P0 spike. If discovered during P1 only, fall back to helper binary per P0's contingency plan; keep the package interface stable.
- **libusb permissions on Linux.** Existing podkit users already have udev rules for libgpod's USB inquiry. Same constraint — no regression.
- **Performance regression.** SCSI inquiry on a device where USB also works should be skipped. Verify the orchestrator does not run SCSI as a redundant verification step.
- **Test fixture drift.** SysInfoExtended XML can vary slightly per-read (cryptographic blob). Plist parser tests assert structural equality, not byte equality.
- **iPodDriver.kext absent on a future macOS.** The `inquiry-methods` check correctly reports unavailable; SCSI orchestration falls through to USB-only; users with iPodSBC-dependent devices get a clear failure message.

## Out of scope (deferred to later phases)

- Moving USB inquiry out of libgpod-node binding — P2.
- Extracting generation tables and presets — P3.
- Replacing regex-based plist extraction in core's `sysinfo-extended.ts` — P4.
- Removing the libgpod-coupled capability adapter — P3/P4.
- Auto-detecting Echo Mini at `device add` — P3.
- Provider pattern and unified enumeration framework — P3.
