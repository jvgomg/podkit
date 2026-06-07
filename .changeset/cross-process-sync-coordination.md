---
'podkit': minor
'@podkit/core': minor
'@podkit/daemon': minor
---

Cross-process sync coordination: per-device lock, transcode owner-liveness, phantom auto-prune.

**Per-device sync lock.** `podkit sync` now acquires a per-device PID-file lock at `.podkit/sync.lock` (mass-storage) or `iPod_Control/.podkit-sync.lock` (iPod) immediately after opening the device. A second concurrent `podkit sync` against the same device exits with the new `LOCK_HELD` code (exit code **4**) and a message naming the holding PID:

```
Error: Another podkit process is already syncing /Volumes/TERAPOD (pid 12345). Wait for it to finish or kill it.
```

Crash-safe: the lock file is unlinked in `finally`; if a process is SIGKILLed mid-sync, the next attempt detects the dead PID via liveness probe and takes over cleanly. `podkit sync --dry-run` does **not** take the lock (read-only by design). The daemon (`@podkit/daemon`) detects `LOCK_HELD` from the CLI subprocess and skips that cycle (no retry-spin). Read commands (`device scan`, `device info`, `device music`) are unaffected — writes only.

**Transcode-tmp owner-liveness.** Each `podkit-transcode-<uuid>/` scratch directory now writes a small `.owner` file at creation. The pre-sync sweep walker reaps dirs whose owner is dead or whose `.owner` is missing; live owners are left alone. This replaces the previous session-start-time floor, which missed the most common interruption case for the long-running daemon: its own prior cycle.

**Phantom manifest auto-prune.** When the pre-sync sweep detects manifest rows whose backing audio file has vanished (mass-storage devices), it now prunes them atomically as part of the sweep. Previously the sweep emitted an advisory warning recommending `podkit doctor --repair orphan-files`; the advisory now fires only if the auto-prune itself fails. `doctor --repair orphan-files` remains as a backstop and is unchanged.

**Filesystem support.** The shared liveness primitive uses only `O_CREAT|O_EXCL`, `unlink`, `rename`, `readFile`, `writeFile`, and `process.kill(pid, 0)` — stable across exFAT, FAT32, HFS+, APFS, ext4, and NTFS. We deliberately avoided `flock(2)` because its semantics on FAT-family filesystems (common for iPods) are platform-dependent.

**Internal API additions** (`@podkit/core`): `acquireLock`, `LockHandle`, `LockHeldError`, `LockContestedError`, `getOwnIdentity`, `readOwnership`, `writeOwnership`, `isAlive`, `PidFileEntry` — all from a new `lib/pid-file.ts` primitive. `DeviceAdapter` gains an optional `prunePhantomManifest?(paths)` method (implemented on mass-storage, intentionally omitted on iPod).

**Removed internals:** `SESSION_START_MS` constant and `sessionStartMsOverride` plumbing in `pre-sync-sweep.ts` are gone — replaced wholesale by the PID-file liveness probe.

See `documents/architecture/sync/planning.md` §6 for the cross-process coordination design.
