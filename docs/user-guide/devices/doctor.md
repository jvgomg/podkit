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

podkit runs three groups of checks: **System** (host environment — FFmpeg encoders, Linux udev rule, iPod inquiry transports (iPod only)), **Device Readiness** (USB, partition, filesystem, mount, SysInfo, database), and **Database Health** (artwork integrity, orphans, SysInfo consistency):

```
podkit doctor — checking iPod at /Volumes/TERAPOD

System
  ✓ Codec Encoders                 aac (libfdk_aac, fallback aac), libmp3lame, alac
  ✓ Video Encoder (H.264)          libx264 available
  ✓ iPod Firmware Inquiry Methods  iPodDriver.kext present

Device Readiness
  ✓ USB Connection
  ✓ Partition Table
  ✓ Filesystem                     TERAPOD
  ✓ Mounted                        /Volumes/TERAPOD
  ✓ SysInfo                        iPod Classic 120GB Black (6th Generation) (MB147)
    SysInfoExtended: present
  ✓ Database                       2,450 tracks

Database Health
  ✓ Artwork Integrity              2,532 entries, 2 formats (1028, 1029), all offsets valid
  ✓ Orphan Files                   No orphaned files found
  ✓ SysInfoExtended consistency with device  matches firmware identity
  ✓ SysInfo ModelNumStr            no mismatch

All checks passed.
```

The exact output varies by device, host platform, and which checks apply. On Linux, you'll also see the `udev Rule` check under System. On a freshly-formatted iPod with no database yet, the `SysInfoExtended` check appears as a repair-only action.

If problems are detected, doctor tells you what's wrong and how to fix it. Devices that aren't ready (e.g., not yet initialized) are handled gracefully — doctor skips the database checks and tells you what to do instead. You don't need a podkit config file or music collection to run diagnostics — some repairs work standalone too.

## Available Health Checks

### iPod

| Check | What it detects | Severity |
|-------|----------------|----------|
| **Codec Encoders** | Missing FFmpeg encoders for codecs in your [preference stack](/user-guide/transcoding/codec-preferences) | Warning |
| **Video Encoder (H.264)** | Missing FFmpeg `libx264` for video transcoding | Warning |
| **iPod Firmware Inquiry Methods** | SCSI/USB transport availability for iPod firmware identity reads (`iPodDriver.kext` on macOS, `sg` + libusb on Linux) | Warning |
| **udev Rule (Linux SCSI + USB Access)** | Missing podkit udev rule granting unprivileged SCSI + USB access on Linux | Warning (Linux only) |
| **Artwork Integrity** | Corrupted artwork database — wrong album art, glitched images, artwork from other albums | Failure |
| **Artwork Reset** | Maintenance action — clears all artwork without needing a source collection | Repair-only |
| **Orphan Files** | Unreferenced audio/video files in `iPod_Control/Music` wasting storage space | Warning |
| **Debris Files** | podkit's incomplete-write residue (`.podkit-tmp`) from prior interrupted syncs | Warning |
| **Abandoned transcode scratch directories** | `podkit-transcode-*` dirs left in `os.tmpdir()` by SIGKILLed prior syncs | Warning |
| **SysInfoExtended** | Missing device identity file required for database checksums on newer iPods | Failure (repair-only) |
| **SysInfoExtended consistency with device** | On-disk `SysInfoExtended` doesn't match firmware-derived identity (stale after device swap or restore) | Warning |
| **SysInfo ModelNumStr vs firmware identity** | Classic `SysInfo` lists wrong `ModelNumStr` — device misidentified by libgpod | Failure |

### Mass-Storage Devices

| Check | What it detects | Severity |
|-------|----------------|----------|
| **Codec Encoders** | Missing FFmpeg encoders for codecs in your [preference stack](/user-guide/transcoding/codec-preferences) | Warning |
| **Video Encoder (H.264)** | Missing FFmpeg `libx264` for video transcoding | Warning |
| **udev Rule (Linux SCSI + USB Access)** | Missing podkit udev rule granting unprivileged USB access on Linux | Warning (Linux only) |
| **Orphan Files (Mass Storage)** | Files in content directories not tracked in `.podkit/state.json` | Warning |
| **Debris Files (Mass Storage)** | podkit's incomplete-write residue (`.podkit-tmp`, `.Audio file`) from prior interrupted syncs | Warning |
| **Abandoned transcode scratch directories** | `podkit-transcode-*` dirs left in `os.tmpdir()` by SIGKILLed prior syncs | Warning |

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

Orphan files are files on the device that aren't tracked by podkit. On an iPod they're audio/video files in `iPod_Control/Music/` that aren't referenced by the iTunesDB. On a mass-storage device they're files under the configured content directories that aren't in `.podkit/state.json`. Either way, they waste storage but don't cause other problems. They typically accumulate from interrupted syncs, manual file manipulation, or changing content paths in your config.

On mass-storage devices, the check no longer filters by file extension — any file under your `musicDir`/`moviesDir`/`tvShowsDir` that podkit didn't write is a candidate. That includes album art (`cover.jpg`, `folder.jpg`), lyrics (`.lrc`), playlist files (`.m3u`), and stray documents. Files outside the configured content directories are still ignored.

A single `--repair orphan-files` flag handles both device types — doctor dispatches the right walker based on the device.

```bash
# Preview what would be deleted (no -d defaults to your primary iPod)
podkit doctor --repair orphan-files --dry-run

# Remove orphan files on an iPod
podkit doctor --repair orphan-files

# Mass-storage devices need -d to identify which one
podkit doctor -d mydevice --repair orphan-files
```

The `--dry-run` preview lists every file that would be deleted; review it carefully before running the repair without `--dry-run`. On a rockbox device, an unmanaged `cover.jpg` next to your audio is artwork that podkit did NOT write — deleting it makes the device fall back to the embedded picture (or no art) until the next sync re-issues a managed sidecar.

Files outside the content directories are always ignored — doctor only considers directories that podkit manages. The `--delete` flag during sync respects the same boundary.

## Cleaning up Debris Files

Debris is podkit's own incomplete-write residue (`.podkit-tmp` siblings, `.Audio file` adapter-failure leftovers) from prior interrupted syncs. Every debris file is incomplete by construction — the atomic-write helper writes to a tmp sibling first and renames on success, so anything still wearing the `.podkit-tmp` suffix means the writer never finished. Cleanup is safe-by-design — no source collection or confirmation prompt needed.

**You usually don't need to run this manually.** As of podkit's pre-sync sweep, every `podkit sync` cleans up debris automatically at the start of the run — you'll see a line like:

```
Cleaning 3 incomplete-write files (12.4 MB) from a previous interrupted sync
```

doctor remains the backstop for devices you don't currently sync to, and for the edge case where the sweep itself failed (failures are non-fatal: the warning surfaces in the sync's output and the next sync retries).

```bash
# Preview
podkit doctor --repair debris-files --dry-run

# Clean debris on an iPod
podkit doctor --repair debris-files

# Mass-storage devices need -d
podkit doctor -d mydevice --repair debris-files
```

A separate host-side check covers abandoned transcode scratch directories left under `os.tmpdir()` by SIGKILLed prior syncs:

```bash
podkit doctor --repair debris-transcode-tmp --dry-run
podkit doctor --repair debris-transcode-tmp
```

The transcode-tmp sweep uses an mtime safety floor — only directories created before this podkit session began are eligible for cleanup, so concurrent sibling processes (a running daemon, another manual sync) are never disturbed.

## Repairing Missing SysInfoExtended

Newer iPods (Classic 6G/7G, Nano 3G+) require a `SysInfoExtended` file for database checksum signing. Without it, the iPod rejects the database after a sync and shows "No Music". If `podkit device scan` or `podkit doctor` reports a SysInfoExtended failure, repair it:

```bash
podkit doctor --repair sysinfo-extended
```

This reads the device identity from the iPod's firmware via USB and writes the `SysInfoExtended` file to `iPod_Control/Device/`. It does not modify music, playlists, or database content.

Older iPods (Video 5G/5.5G, Nano 1G–2G, Mini, Shuffle) do not need SysInfoExtended — a SysInfo file with the correct `ModelNumStr` is sufficient. See [iPod Internals — SysInfoExtended](/devices/ipod-internals#sysinfoextended-file) for technical details.

## Previewing Repairs

Every repair supports `--dry-run` to preview changes without modifying anything:

```bash
# Artwork
podkit doctor --repair artwork-reset --dry-run
podkit doctor --repair artwork-rebuild -c main --dry-run

# Orphan files (one ID for both device types; -d targets mass-storage)
podkit doctor --repair orphan-files --dry-run                    # iPod
podkit doctor -d mydevice --repair orphan-files --dry-run        # mass-storage

# Debris files (incomplete-write residue) — same dispatch
podkit doctor --repair debris-files --dry-run                    # iPod
podkit doctor -d mydevice --repair debris-files --dry-run        # mass-storage

# Abandoned transcode scratch dirs (host-only)
podkit doctor --repair debris-transcode-tmp --dry-run

# Identity / SysInfo
podkit doctor --repair sysinfo-extended --dry-run
podkit doctor --repair sysinfo-modelnum-mismatch --dry-run

# Linux host setup
podkit doctor --repair udev-rule --dry-run
```

Repairs without `--dry-run` apply changes directly; for repairs that delete files (orphan-files, artwork-reset), `--dry-run` is the safe way to see the list before committing.

## Additional Options

Use `--verbose` for detailed diagnostic output (e.g., orphan file breakdowns by directory and extension). Export orphan file lists as CSV with `--format csv`. Pressing Ctrl+C during a repair triggers a graceful shutdown — partial progress is saved before exiting.

## See Also

- [Artwork Corruption Background](/devices/artwork-corruption) — Technical details on what causes artwork corruption
- [Common Issues](/troubleshooting/common-issues) — Solutions for other frequently encountered problems
- [CLI Commands — `podkit doctor`](/reference/cli-commands#podkit-doctor) — Full option reference
- [Device Readiness Levels](/reference/cli-commands#device-readiness-levels) — What each readiness level means and how to resolve it
