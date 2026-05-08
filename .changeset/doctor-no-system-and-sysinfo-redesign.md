---
'@podkit/core': minor
'podkit': minor
---

`podkit doctor` gains `--no-system` to skip system-scope checks (FFmpeg encoders, libusb availability, udev rule). System checks remain on by default; pass `--no-system` for device-only diagnostics or in tests where the host environment shouldn't influence the result.

The `sysinfo-consistency` check is redesigned: a missing `SysInfoExtended` file is now `skip` (not `fail`) since absence is not a failure mode. When the file is present it's compared against the live device on two independent axes — FireWireGUID and model generation — and only fails when at least one axis can be evaluated and disagrees. The check picks up live device data via the new `liveIdentity` field on `DiagnosticContext`, which `runDiagnostics` accepts as part of `RunDiagnosticsInput`.
