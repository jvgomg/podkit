---
"podkit": minor
"@podkit/core": minor
"@podkit/device-types": minor
"@podkit/ipod-firmware": minor
---

Add SCSI firmware inquiry for iPod identification (P1 — m-18 device-capability architecture).

`@podkit/device-types` (first published release) provides the canonical shared type definitions — `DeviceCapabilities`, `DeviceIdentity`, `ParsedFirmware`, and `DeviceProvider` — used across the podkit monorepo without circular dependencies.

`@podkit/ipod-firmware` (first published release) implements iPod firmware inquiry via SCSI (Linux SG_IO + macOS IOKit, using koffi FFI) with USB fallback through the existing libgpod-node binding. Devices that previously failed identification over USB — including iPod mini 2G, nano 2G, and some iPod 5G Video configurations — can now be identified via SCSI. The orchestrator probes available transports at startup, prefers USB when both are available, and falls back to SCSI transparently.

`@podkit/core` now routes `ensureSysInfoExtended` through the new orchestrator with SCSI fallback, and registers two new `podkit doctor` checks: `inquiry-methods` (reports which transports are available on this host) and `sysinfo-consistency` (validates that the on-disk SysInfo file matches the live firmware read). EACCES errors from SCSI include step-by-step recovery instructions.

`podkit` CLI gains `--repair udev-rule` in `podkit doctor` to install the Linux udev rule that grants non-root `/dev/sg*` access, and surfaces the new doctor checks in the readiness output.
