---
'podkit': minor
'@podkit/core': minor
---

`podkit doctor` repairs now acquire the per-device sync lock before mutating the device.

Previously, `podkit doctor --repair <id>` would happily run while a `podkit sync` (or daemon-driven sync) was mid-flight against the same device. For mass-storage devices, this meant doctor's `--repair orphan-files` could prune phantom manifest entries from `state.json`, only for sync's eventual `save()` to clobber the prune from in-memory state — silently undoing the user's repair. For iPod devices, concurrent libgpod writes (artwork rebuilds, sysinfo fixes, debris cleanup) could corrupt the iTunesDB.

The fix: every `--repair` that mutates the device now acquires the same per-device lock that `podkit sync` takes (`.podkit/sync.lock` for mass-storage, `iPod_Control/.podkit-sync.lock` for iPod). On contention, doctor exits with `LOCK_HELD` (exit code **4**) and a message naming the holding PID:

```
Error: Another podkit process is using /Volumes/TERAPOD (pid 12345). Wait for it to finish or kill it.
```

Audited and locked: `orphan-files`, `artwork-rebuild`, `artwork-reset`, `debris-files` (iPod), `sysinfo-extended`, `sysinfo-consistency`, `sysinfo-modelnum-mismatch`. System-only repairs that don't touch the device (`udev-rule`, `debris-transcode-tmp`) correctly skip the lock.

**Internal:** `resolveSyncLockPath` moved from the CLI to `@podkit/core` (exported from `lib/sync-lock-path.ts`) so doctor and sync share the same implementation. New JSDoc on `pruneManifestRows` documents the lock requirement for any future direct caller. Architecture doc `documents/architecture/sync/planning.md` §6 now enumerates every manifest-writer surface with confirmed lock semantics.
