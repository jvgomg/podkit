---
"@podkit/core": minor
"podkit": minor
---

Add config-refresh seam to `applyDeviceName` so the CLI can update cached device info after a disk relabel

`applyDeviceName` now accepts two new optional fields: `refreshConfig` (a `RefreshConfig` callback) and `volumeUuid`. After the disk relabel and mountpoint re-resolution complete, `refreshConfig` is called with `{ volumeUuid, oldPath, newPath, newLabel, name }`. Core defaults to a no-op, so Docker/headless callers and `--no-disk` runs are unaffected.

`RefreshConfig` and `ConfigRefreshInfo` are exported from `@podkit/core` so CLI and other consumers can type the seam without importing internal files.

The CLI wires the seam in `podkit device rename` via a shared `makeDeviceConfigRefresh()` factory. After a rename, the podkit config's cached `volumeName` and `path` for the device (matched by stable `volumeUuid`) are updated so future runs resolve to the new mountpoint without requiring manual config edits. The user's device alias (`-d name`) and all other per-device settings are unchanged.
