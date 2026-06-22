---
title: Archiving an iPod
description: Extract a complete, self-contained archive of an iPod with podkit — playable tracks organised into folders, plus play counts, ratings, playlists, and artwork.
sidebar:
  order: 10
---

The `podkit device archive` command pulls **everything** off an iPod into a
single, self-contained folder you can browse, play, and keep. It's built for
preserving a device before you wipe it — a dying iPod, or a second-hand one
you've been given — including the data that exists *nowhere else*: play
counts, ratings, last-played dates, and skip counts from the iPod's internal
database.

Unlike copying the iPod's files by hand (where every track is named something
like `F23/ABCD.m4a`), the archive renames and organises your music into a
readable folder tree, embeds artwork, and writes a queryable catalogue of all
the metadata.

This command is **iPod-only**.

## Basic Usage

Connect and mount an iPod, then run:

```bash
# Archive the connected iPod into the current directory
podkit device archive

# Archive into a specific output directory
podkit device archive ~/ipod-archives
```

podkit auto-detects the connected iPod — you don't need to have it configured.
The archive is written to a self-contained folder named after the device,
its serial, and the date, e.g. `PARTY_IPOD-YM7275YSVQH-20260622-211436/`.

## What You Get

Each archive folder contains two parts:

```text
PARTY_IPOD-YM7275YSVQH-20260622-211436/
├── raw dump/                  # exact, read-only copy of the iPod's data
│   ├── iPod_Control/...        #   the original database + audio files
│   └── manifest.sha256         #   a checksum of every copied file
└── archive/                   # the browsable, future-proof archive
    ├── Music/
    │   ├── <Album Artist>/<Album>/01 Title.m4a   (+ cover.png per album)
    │   └── Compilations/<Album>/...
    ├── Podcasts/  Audiobooks/  Video/             (when present)
    ├── Playlists/<name>.m3u8
    ├── library.sqlite          # queryable catalogue of all metadata
    ├── README.md               # a summary you can read at a glance
    └── report.md / report.json # what was skipped or couldn't be archived
```

- **`raw dump/`** is a near-byte-for-byte copy of the iPod, held as the
  lossless source of truth. Every file is checksummed into `manifest.sha256`,
  so years later you can verify the archive is intact with `shasum -c`.
- **`archive/`** is the friendly version: your tracks renamed and sorted into
  folders, each a lossless copy of the original audio (never re-encoded) with
  its tags rewritten and the largest available album art embedded.
- **`library.sqlite`** preserves everything from the iPod's database —
  including play counts, ratings, last-played and skip counts — mapped to each
  exported file. This is the listening history that lives only on the device.
- **`README.md`** identifies the dump at a glance: model, serial, capacity,
  date, and library stats (track count, total size, play time, top artists).

## Tracks Organised by Folder

Music is laid out so any file manager or player can browse it:

| Content | Folder |
|---------|--------|
| Albums | `Music/<Album Artist>/<Album>/NN Title.ext` |
| Compilations | `Music/Compilations/<Album>/NN Title.ext` |
| Podcasts | `Podcasts/<Show>/Title.ext` |
| Audiobooks | `Audiobooks/<Author>/Title.ext` |
| Movies | `Video/Movies/Title.ext` |
| TV shows | `Video/TV Shows/<Show>/Season NN/EE Title.ext` |
| Music videos | `Video/Music Videos/Title.ext` |

Tracks with missing metadata fall back to `Unknown Artist`/`Unknown Album`,
and filenames are sanitised so the archive copies cleanly onto Windows, macOS,
and Linux. Playlists are exported as `.m3u8` files (the iPod's master "all
songs" playlist is skipped).

## Running the Stages Separately

The archive is built in two stages — a **raw dump** off the device, then a
device-free **transform** of that dump into the browsable archive. Normally
the bare command runs both, but you can run them separately:

```bash
# Stage 1 only: just pull a raw, checksummed copy off the iPod
podkit device archive --dump-only

# Stage 2 only: build (or rebuild) the archive from an existing dump,
# with no iPod connected
podkit device archive --from-dump ./PARTY_IPOD-YM7275YSVQH-20260622-211436
```

`--dump-only` is useful to get data off a failing iPod quickly and process it
later. `--from-dump` lets you regenerate the archive from a dump you already
have, without the device — handy if a newer podkit improves the transform.

## Targeting a Specific Device

If more than one iPod is connected, choose one with `-d`/`--device` by name or
mount path:

```bash
podkit device archive -d classic
podkit device archive --device "/Volumes/PARTY IPOD"
```

## Options

| Option | Description |
|--------|-------------|
| `[path]` | Output directory (defaults to the current directory) |
| `--dump-only` | Run only the raw-dump stage (no transform) |
| `--from-dump <path>` | Build the archive from an existing dump, no device needed |
| `-d, --device <name\|path>` | Target a specific iPod (otherwise auto-detected) |

## What Gets Skipped

The run prints (and the `report.{md,json}` records) anything it couldn't
archive: tracks with no audio file, tracks with no artwork, and any copy or
extraction failures. **Foreign files** — files you've manually added to the
iPod's storage that aren't part of the iPod's own data — are listed so you can
copy them off yourself; they are not included in the archive. macOS system
files (like Spotlight indexes) are skipped silently.

## See Also

- [Scanning for Devices](/reference/cli-commands#podkit-device-scan) to confirm
  an iPod is detected and mounted
- [Mounting and Ejecting](/user-guide/devices/mounting-ejecting) if the iPod
  is connected but not mounted
- [Managing Devices](/user-guide/devices) for device configuration
