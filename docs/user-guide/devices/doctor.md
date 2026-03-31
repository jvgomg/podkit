---
title: Device Health Checks
description: Use podkit doctor to diagnose and repair common device problems — orphan files, artwork corruption, and more.
sidebar:
  order: 6
---

`podkit doctor` is a diagnostic tool that checks your device for common problems and can repair them automatically. It works on both iPod and mass-storage devices (Echo Mini, Rockbox, generic DAPs). For iPods, you don't need to use podkit as your sync tool — it works on any iPod with a standard database.

## Quick Start

Connect and mount your iPod, then run:

```bash
podkit doctor
```

podkit first runs a device readiness check, then runs database health checks:

```
podkit doctor — checking iPod at /Volumes/TERAPOD

Device Readiness
  ✓ USB Connection
  ✓ Partition Table
  ✓ Filesystem
  ✓ Mounted
    /Volumes/TERAPOD
  ✓ SysInfo
    iPod Classic (6th gen) — MA147
  ✓ Database
    2,450 tracks

  Ready — 2,450 tracks, 8.2 GB free

Database Health
  ✓ Artwork Integrity    2,532 entries, 2 formats (1028, 1029), all offsets valid
  ✓ Orphan Files         No orphaned files found

All checks passed.
```

If problems are detected, doctor tells you what's wrong and how to fix it. Devices that aren't ready (e.g., not yet initialized) are handled gracefully — doctor skips the database checks and tells you what to do instead. You don't need a podkit config file or music collection to run diagnostics — some repairs work standalone too.

## Available Health Checks

### iPod

| Check | What it detects | Severity |
|-------|----------------|----------|
| **Artwork Integrity** | Corrupted artwork database — wrong album art, glitched images, artwork from other albums | Failure |
| **Encoder Availability** | Missing FFmpeg encoders for codecs in your [preference stack](/user-guide/transcoding/codec-preferences) | Warning |
| **Orphan Files** | Unreferenced audio/video files wasting storage space | Warning |

### Mass-Storage Devices

| Check | What it detects | Severity |
|-------|----------------|----------|
| **Encoder Availability** | Missing FFmpeg encoders for codecs in your [preference stack](/user-guide/transcoding/codec-preferences) | Warning |
| **Orphan Files** | Files in content directories not tracked in `.podkit/state.json` | Warning |

## Repairing Artwork Corruption

If doctor reports artwork corruption, you have two repair options.

### Reset artwork (no source collection needed)

The fastest fix. Clears all artwork from the iPod and removes artwork sync tags. Your music stays untouched — only the artwork is removed.

```bash
podkit doctor --repair artwork-reset
```

This is useful when:
- You don't have your source collection available
- You don't use podkit for syncing and just want to clear corrupted artwork
- You want a quick fix and plan to re-sync artwork later

If you sync with podkit, the next `podkit sync` will re-add artwork from your source files automatically. If you sync with iTunes or another tool, re-sync from that tool to restore artwork.

### Rebuild artwork from source

Rebuilds all artwork in one step by matching each track back to your source files and re-extracting the cover art:

```bash
podkit doctor --repair artwork-rebuild -c main
```

This requires a configured music collection (`-c`). What the rebuild does:

1. **Removes all existing artwork** from every track on the iPod
2. **Matches each track** back to its source file using artist, title, and album metadata
3. **Re-extracts artwork** from the source files and applies it to the iPod
4. **Saves the database** — writes completely fresh thumbnail files

Audio files, playlists, play counts, ratings, and track metadata are not modified.

### Choosing between them

| | Reset (`artwork-reset`) | Rebuild (`artwork-rebuild`) |
|---|---|---|
| **Speed** | Fast (seconds) | Slower (reads source files) |
| **Source collection needed** | No | Yes |
| **Result** | Artwork cleared, re-added on next sync | Artwork rebuilt immediately |
| **Best for** | Quick fix, non-podkit users | One-step permanent repair |

### After repair

Run `podkit doctor` again to verify the repair was successful. Eject the iPod safely before disconnecting to ensure all data is flushed to disk:

```bash
podkit doctor
podkit eject
```

## Repairing Orphan Files

### iPod

Orphan files are audio or video files on the iPod that aren't referenced by the database. They waste storage but don't cause other problems. This typically happens after an interrupted sync (force-quit, crash, or disconnection during transfer).

```bash
# Preview what would be deleted
podkit doctor --repair orphan-files --dry-run

# Remove orphaned files
podkit doctor --repair orphan-files
```

### Mass-Storage Devices

On mass-storage devices, orphan files are media files in the configured content directories (e.g., `Music/`, `Video/`) that aren't tracked in the `.podkit/state.json` manifest. These can accumulate from interrupted syncs, manual file manipulation, or changing content directory paths in your config.

```bash
# Preview what would be deleted
podkit doctor -d mydevice --repair orphan-files-mass-storage --dry-run

# Remove orphaned files
podkit doctor -d mydevice --repair orphan-files-mass-storage
```

Files outside the content directories are always ignored — doctor only considers directories that podkit manages. The `--delete` flag during sync also respects this boundary: it only removes files that podkit placed on the device.

## Previewing Repairs

Every repair supports `--dry-run` to preview changes without modifying anything:

```bash
podkit doctor --repair artwork-reset --dry-run
podkit doctor --repair artwork-rebuild -c main --dry-run
podkit doctor --repair orphan-files --dry-run
```

## Additional Options

Use `--verbose` for detailed diagnostic output (e.g., orphan file breakdowns by directory and extension). Export orphan file lists as CSV with `--format csv`. Pressing Ctrl+C during a repair triggers a graceful shutdown — partial progress is saved before exiting.

## See Also

- [Artwork Corruption Background](/devices/artwork-corruption) — Technical details on what causes artwork corruption
- [Common Issues](/troubleshooting/common-issues) — Solutions for other frequently encountered problems
- [CLI Commands — `podkit doctor`](/reference/cli-commands#podkit-doctor) — Full option reference
- [Device Readiness Levels](/reference/cli-commands#device-readiness-levels) — What each readiness level means and how to resolve it
