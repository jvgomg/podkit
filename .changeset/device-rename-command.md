---
"@podkit/libgpod-node": minor
"@podkit/core": minor
"podkit": minor
---

Add `podkit device rename` command and `setDeviceName` API

The new `podkit device rename <name>` command renames an iPod. The case-correct device name is the iTunesDB master-playlist name, so renaming writes that name. Use `--no-disk` for a database-only rename (the OS volume-label branch lands in a follow-up); `--no-database` to relabel the disk only; `-y/--yes` to skip the confirmation prompt. Passing both `--no-disk` and `--no-database` is rejected as a no-op.

New APIs:

- `@podkit/libgpod-node`: `Database.setDeviceName(name)` writes the master-playlist name (the legitimate low-level writer; no guard). The name persists across `save()` + reopen.
- `@podkit/core`: `IpodDatabase.setDeviceName(name)` — the only sanctioned way to rename the master playlist (the generic `IpodPlaylist.rename()` guard still refuses it). Plus `applyDeviceName(...)`, an orchestrator that writes the database name first and (in a later slice) the disk label last, since relabeling moves the OS mountpoint.
