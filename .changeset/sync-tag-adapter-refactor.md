---
'@podkit/core': minor
---

Internalize raw sync tag functions (`parseSyncTag`, `formatSyncTag`, `writeSyncTag`) from the public API. Sync tag reads now use the typed `DeviceTrack.syncTag` field, and writes use `DeviceAdapter.writeSyncTag()` or the new `update-sync-tag` operation type. Adds `SyncTagUpdate` type and `syncTagsEqual` to the public API.
