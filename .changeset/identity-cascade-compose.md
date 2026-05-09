---
"podkit": patch
"@podkit/core": patch
"@podkit/ipod-firmware": patch
"@podkit/devices-ipod": patch
---

Fix iPod model identification regressing to "Unknown iPod" after `doctor --repair sysinfo-extended` on pre-2006 devices (mini 2G), and tighten the package-boundary contract so consumers compose identity instead of injecting resolution policy.

The bug: each consumer of `ensureSysInfoExtended` / `readSysInfoExtended` passed a serial-only `resolveModel` callback. When the 3-character serial suffix wasn't in `tables/serials.ts`, the resolver returned undefined and the device was displayed as "Unknown iPod" — even when a SysInfo file with a known `ModelNumStr` was sitting next to the SysInfoExtended on disk.

The fix:

- **Removed** `ModelResolver` type and the `resolveModel` callback from `@podkit/ipod-firmware`. `readSysInfoExtended` and `ensureSysInfoExtended` now return a flat `SysInfoIdentity` bag (`firewireGuid?, serialNumber?, modelNumStr?, familyId?`). When a SysInfo file is on disk alongside SysInfoExtended, its `ModelNumStr` is read opportunistically.
- **Callers compose** with `resolveIpodModel(bag)` from `@podkit/devices-ipod`, which cascades modelNumStr → serial → productId → familyId → libgpodGeneration. The CLI no longer makes resolution decisions.
- **Added** `SYSINFO_PATH`, `SYSINFO_EXTENDED_PATH`, `SYSINFO_DEVICE_DIR` exported from `@podkit/ipod-firmware` and re-exported from `@podkit/core`. Consumers use these constants instead of duplicating the literal `iPod_Control/Device/...` paths.
- **Added** `S4G: '9804'` entry to `tables/serials.ts` (mini 2G 4GB Pink, sourced from real hardware, serial `JQ5141TFS4G`).
- **Post-write enrichment.** After `ensureSysInfoExtended` writes the file via USB inquiry, it now re-reads via `readSysInfoExtended` so the post-write identity bag includes `modelNumStr` from the SysInfo neighbour. Eliminates the cosmetic regression where the repair-success message showed a less-specific name than the subsequent `doctor` run.
