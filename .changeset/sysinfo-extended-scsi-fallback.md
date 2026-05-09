---
"podkit": patch
"@podkit/core": patch
"@podkit/ipod-firmware": patch
---

Fix SysInfoExtended SCSI-fallback on macOS for SCSI-only iPods (mini 2G, nano 2G, iPod 5G/5.5G). `device add` and `doctor --repair sysinfo-extended` now correctly fall back from USB → SCSI when the device does not respond to vendor control transfers, instead of failing with a misleading "Could not read device identity from USB" error.

Internal API changes in `@podkit/ipod-firmware`:

- **Changed:** `ensureSysInfoExtended(mountPoint, fp, options?)` now takes a full `UsbFingerprint` instead of the previous `{ busNumber, deviceAddress }` shape. Required so the macOS SCSI transport can locate the IOService via vendorId/productId/serialNumber. `UsbDeviceAddress` is removed.
- **Added:** `inquireFirmwareDetailed(fp, opts?)` — like `inquireFirmware` but returns `{ firmware, plan, attempts }` so callers can distinguish which transports were attempted. `inquireFirmware` is unchanged for existing consumers.
- **Added:** `EnsureSysInfoExtendedOptions` type with `readFromUsb`, `resolveModel`, `inquireOptions` fields. Replaces the previous positional `(mountPoint, fp, readFromUsb, resolveModel)` signature.

Internal API changes in `@podkit/core`:

- **Added:** `hasCompleteUsbFingerprint(fp): fp is CompleteUsbDevice` type guard exported from `@podkit/core`.
- **Added:** `CompleteUsbDevice` type — a `UsbFingerprint` with vendorId, productId, bus, devnum guaranteed present (serialNumber optional).
- **Changed:** `resolveUsbDeviceFromPath(path)` now also returns `vendorId` and `productId`. Linux extracts from sysfs `idVendor`/`idProduct`; macOS extracts from `system_profiler` JSON.

User-facing error messages now differentiate between transport failures: "Could not read device identity from USB and SCSI" / "...from USB" / "...from SCSI" / "...no firmware inquiry transport is available on this system" / "...returned data but it could not be parsed".
