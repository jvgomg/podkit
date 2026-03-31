---
"podkit": minor
"@podkit/core": minor
---

Fix `--delete` to only remove managed files on mass-storage devices, and add orphan file detection via `podkit doctor`.

**Bug fix:** `--delete` previously removed all unmatched files on mass-storage devices, including user-placed files. It now only removes files that podkit manages (tracked in `.podkit/state.json`), matching iPod behavior where only database tracks are candidates for deletion.

**Collision detection:** Sync now detects when a planned file write would collide with an existing unmanaged file and reports the conflict before writing. Works in both normal sync and `--dry-run` mode.

**New diagnostic check:** `podkit doctor` now runs health checks on mass-storage devices. The `orphan-files-mass-storage` check detects unmanaged files in content directories and can clean them up via `podkit doctor --repair orphan-files-mass-storage`.

**Other improvements:**
- State manifest (`.podkit/state.json`) is now written without pretty-printing to reduce file size on device storage
- Shell completions now include valid repair IDs for the `--repair` option
