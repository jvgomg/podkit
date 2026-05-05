---
'podkit': minor
'@podkit/core': minor
'@podkit/devices-ipod': patch
'@podkit/devices-mass-storage': patch
---

New packages: `@podkit/devices-ipod` (canonical home for iPod generation tables, model lookups, and capability synthesis) and `@podkit/devices-mass-storage` (user-extensible DAP preset framework for Echo Mini, Rockbox, generic, and custom devices).

Echo Mini is now auto-detected at `device add` — when the USB descriptor matches the known VID/PID (`0x071b`/`0x3203`), no `--type echo-mini` flag is required.

`enumerateConnectedDevices` is now the recommended way to discover and classify USB devices. It accepts a `providers: DeviceProvider[]` array and returns `EnumeratedDevice[]` carrying both the USB connection info and the provider-produced identity.

`getCapabilities` in `@podkit/devices-ipod` is libgpod-free. Capability synthesis is purely table-and-firmware-driven; the legacy `createIpodCapabilities` adapter that depended on a live libgpod `LibgpodDeviceInfo` struct is deprecated in `@podkit/core`. Parity is verified across all 29 generations (the 4 that were libgpod `unknown` degenerate cases are now correctly populated from the table).

Internal re-export shims in `@podkit/core` keep all existing call paths compiling for one release. The shims delegate to `@podkit/devices-ipod` and `@podkit/devices-mass-storage` and will be removed in P4.
