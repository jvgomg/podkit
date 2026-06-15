---
'@podkit/core': patch
'podkit': patch
'@podkit/device-testing': patch
---

macOS regression coverage for the m-18 TASK-317.* hygiene cluster. Extends the test surface so the macOS-platform code paths that ship today (HFS+ supported, `system_profiler` `bsd_name` partition-suffix handling, `sysinfo-modelnum-mismatch` diagnostic framework, unsupported-cascade suppression, doctor section ordering and visibility, JSON envelope shape, TOML round-trip) all have explicit pinned assertions.

Foundation: `DevicePersona` now carries an optional `platformDeviceInfoDarwin?: PlatformDeviceInfo[] | null` field, and `ipodMacosPlatformInfo(opts)` in `@podkit/device-testing/personas/builders` synthesises canonical macOS-shape records. Populated on `ipodMini2gPink` (FAT32) and `ipodNano4gHfsplus` (HFS+) as representative fixtures.
