---
title: Artwork Corruption
description: Technical background on iPod artwork corruption — what causes it, why it persists, and how the repair works.
sidebar:
  order: 3
---

Artwork corruption is one of the most well-known iPod issues — wrong album art, glitched images, artwork that changes after a reboot. It has affected users of every iPod management tool (iTunes, gtkpod, Rhythmbox, and others) since the early days of the iPod. This page explains the technical background. For practical steps to diagnose and fix the issue, see [iPod Health Checks](/user-guide/devices/doctor#repairing-artwork-corruption).

## How iPod Artwork Storage Works

iPod artwork is stored in a separate database from the music. The system has three components:

1. **iTunesDB** — the main track database. Each track has an `mhii_link` field that points to its artwork entry.
2. **ArtworkDB** — a binary database mapping artwork IDs to thumbnail locations. Each entry (MHII) references a position in an `.ithmb` file.
3. **`.ithmb` files** — raw pixel data files containing thumbnails stored back-to-back. Each thumbnail is a fixed-size slot of RGB565 pixel data.

When the iPod displays artwork for a track, it follows this chain:

```
Track → mhii_link → ArtworkDB entry → ithmb offset → raw pixel data
```

## What Goes Wrong

The corruption occurs when the **ArtworkDB and `.ithmb` files get out of sync**. The ArtworkDB says "track X's artwork is at byte offset Y," but the `.ithmb` file is smaller than expected — those byte offsets point past the end of the file.

### The Triggering Event

When podkit (or any libgpod-based tool) saves the iPod database, artwork is written in this order:

1. Existing thumbnails are compacted in the `.ithmb` file (removing gaps from deleted artwork)
2. New thumbnails are appended to the `.ithmb` file via buffered I/O (`fwrite`)
3. The ArtworkDB is written, referencing the new `.ithmb` offsets

On FAT32 filesystems, these writes may not reach disk in order. The ArtworkDB (step 3) is written atomically via a temp file and rename, which may be flushed to disk before the buffered `.ithmb` writes from step 2. If the iPod is disconnected before the `.ithmb` data is flushed, the ArtworkDB references pixel data that was never persisted.

### Why It's Self-Perpetuating

Once corruption occurs, it persists across future syncs because:

1. libgpod reads the ArtworkDB and loads the out-of-bounds offsets into memory as existing thumbnail references
2. During the next save, these bad references are treated as valid existing data
3. The ithmb compaction step can't fix them (the referenced data doesn't exist)
4. The ArtworkDB is rewritten with the same bad offsets
5. Only newly added tracks get fresh artwork — existing tracks keep their corrupted references

This means the corruption is **permanent** unless all artwork is explicitly rebuilt.

### What the iPod Shows

When the iPod firmware tries to read pixel data at an out-of-bounds offset, the exact behavior is firmware-dependent. It may read past the file boundary into adjacent cluster data, producing garbage or artwork from an unrelated album. The specific wrong artwork shown may change after a reboot as the filesystem layout shifts.

## Why a Full Rebuild Is the Only Fix

There's no partial fix because:

- You can't tell which of the in-bounds thumbnails are correct vs. which were moved there during a prior compaction
- The out-of-bounds entries reference pixel data that was never written to disk — there's nothing to recover
- The ArtworkDB has no checksums or integrity validation, so corruption is silent

The repair strategy sidesteps all of this by:

1. Removing all artwork from all tracks (clearing all thumbnail references)
2. Re-extracting artwork from the original source files
3. Setting fresh artwork on each track
4. Saving once — libgpod writes brand new `.ithmb` files from scratch

Because there are no existing thumbnail references after step 1, the fragile compaction code is skipped entirely. The result is a clean, consistent artwork database.

## Diagnosing and Repairing

### Diagnosing with podkit

`podkit doctor` can diagnose artwork corruption on any iPod, even if you don't use podkit for day-to-day syncing. It reads the artwork database and checks whether the referenced offsets fall within the actual `.ithmb` files — no write access needed for the check itself.

### Repairing

The only way to fix artwork corruption is to rebuild the artwork from scratch. podkit offers two repair options: `podkit doctor --repair artwork-reset` to clear artwork quickly (no source needed), or `podkit doctor --repair artwork-rebuild -c <collection>` to rebuild from source. See [iPod Health Checks](/user-guide/devices/doctor#repairing-artwork-corruption) for details.

If you use other software (iTunes, gtkpod, etc.), the equivalent fix is to remove all music and videos from the iPod — which empties the artwork database — and then re-sync everything. There is no partial fix because the corrupted entries are self-perpetuating (see above).

## Prevention

- **Always eject your iPod** before disconnecting. This ensures all buffered writes are flushed to disk.
  ```bash
  podkit eject
  ```
- **Don't disconnect during sync.** If a sync is interrupted, artwork written during that session may be lost.

## Further Reading

- [ADR-013: iPod Artwork Corruption Diagnosis and Repair](https://github.com/jvgomg/podkit/blob/main/docs/adr/adr-013-ipod-artwork-corruption-diagnosis-and-repair.md) — the full technical investigation
