---
"@podkit/core": minor
"podkit": minor
---

`podkit device reset` is now a true factory reset

Reset previously only recreated the iTunesDB, leaving the actual audio files in `iPod_Control/Music/` and artwork thumbnails on disk as orphans. It now performs a complete wipe:

1. Reads the device's current name and recreates an empty database with that name (override with `--name`).
2. Brute-force removes every audio file under `iPod_Control/Music/F*` and every artwork `.ithmb`/`ArtworkDB` directly on disk — including orphan files no database references (fixing the long-standing leftover-file bug).
3. Sets the OS volume label to match the device name.

Reset is all-or-nothing (no `--no-*` flags); partial wipes remain on `device clear` and `device reset-artwork`. Running reset on a device with no existing iTunesDB now errors and points to `podkit device init` for first-time setup. `--dry-run` previews every step without mutating anything.

A new `sweepDeviceContent(mountPath, { music, artwork })` core primitive performs the on-disk content sweep; it is guarded so it can only ever operate inside a valid `iPod_Control` tree.
