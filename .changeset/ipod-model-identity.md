---
"@podkit/core": minor
"podkit": minor
---

Add canonical IpodModel type for structured device identity

- Add `IpodModel` interface — canonical representation of identified iPod model with `displayName`, `generationId`, `checksumType`, `color`, `capacityGb`, `modelNumber`, and `source` provenance
- Add `resolveIpodModel()` factory — builds an `IpodModel` from USB product ID, SysInfo model number, or serial number suffix
- Add `UsbConnectionInfo` interface — pure USB bus topology data, split from device identity
- Restructure `UsbDiscoveredDevice` to carry `usb: UsbConnectionInfo` + `model?: IpodModel`
- Add `usbModel` and `deviceModel` to `ReadinessResult` — USB-derived and SysInfo-derived models kept separate for mismatch detection
- Update `SysInfoExtendedResult` with structured `model`, `firewireGuid`, `serialNumber` fields
- Clean `checkSysInfo()` return type — new `SysInfoCheckResult` separates stage result from device model
- Add `model` to JSON output for `device scan` and `device info` commands
- `device scan` and `device info` now display richest available model name (color/capacity from SysInfo when available)
- Remove `UsbDeviceInfo` type (replaced by `UsbConnectionInfo` + `IpodModel`)
