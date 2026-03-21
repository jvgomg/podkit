---
title: Artwork Debug Tools
description: Tools for investigating iPod artwork corruption and tracing the artwork linking chain.
---

Tools added during the iPod artwork corruption investigation to inspect the internal artwork data structures that libgpod manages.

## gpod-tool `artwork-dump`

Dumps per-track artwork metadata from an iPod's iTunesDB, including the internal MHII/MHNI linking information and ithmb thumbnail entries. This exposes data that iTunes and libgpod normally hide, making it possible to trace the full artwork pipeline: track -> MHII (artwork record) -> MHNI (thumbnail descriptor) -> ithmb file (pixel data).

### Building

The `artwork-dump` command accesses libgpod's private `Itdb_Thumb_Ipod` and `Itdb_Thumb_Ipod_Item` structs, which are defined in `itdb_thumb.h` -- a private header not installed by libgpod. The Makefile automatically locates this header in the local libgpod source tree:

```bash
cd tools/gpod-tool
make
```

The Makefile resolves the private header path via `LIBGPOD_SRC_DIR`, which defaults to `tools/libgpod-macos/build/libgpod-0.8.3/src`. If your libgpod source is elsewhere, override it:

```bash
make LIBGPOD_SRC_DIR=/path/to/libgpod/src
```

### Usage

```bash
# Human-readable output
gpod-tool artwork-dump /Volumes/iPod

# JSON output (for scripting / diffing)
gpod-tool artwork-dump /Volumes/iPod --json
```

Only tracks that have thumbnails (as reported by `itdb_track_has_thumbnails()`) are included in the output. Tracks without artwork are skipped.

### Human-readable output

```
Artwork Dump
============

Track [52] dbid=1234567890 mhii_link=7
  Title:  Song Name
  Artist: Artist Name
  Album:  Album Name
  Artwork: id=7 dbid=9876543210
    Thumb: format=1056 file=:Artwork:F1056_1.ithmb offset=0 size=40000 200x200
    Thumb: format=1055 file=:Artwork:F1055_1.ithmb offset=0 size=10000 100x100

Summary
  Total tracks:       150
  Tracks with artwork: 148
  Unique artwork IDs: 12
  Unique mhii_links:  12
```

### JSON output

```json
{
  "success": true,
  "tracks": [
    {
      "id": 52,
      "dbid": "1234567890",
      "mhiiLink": 7,
      "title": "Song Name",
      "artist": "Artist Name",
      "album": "Album Name",
      "artwork": {
        "id": 7,
        "dbid": "9876543210",
        "thumbnails": [
          {
            "formatId": 1056,
            "filename": ":Artwork:F1056_1.ithmb",
            "offset": 0,
            "size": 40000,
            "width": 200,
            "height": 200
          }
        ]
      }
    }
  ],
  "summary": {
    "totalTracks": 150,
    "tracksWithArtwork": 148,
    "uniqueArtworkIds": 12,
    "uniqueMhiiLinks": 12
  }
}
```

### Field reference

**Per-track fields:**

| Field | Description |
|-------|-------------|
| `id` | Track ID in the iTunesDB (reassigned on every database write) |
| `dbid` | Persistent database ID (stable across writes) |
| `mhiiLink` | The `mhii_link` field from `Itdb_Track` -- links this track to an MHII record in the ArtworkDB. 0 means no link. |
| `artwork.id` | The artwork record's ID (should match `mhiiLink` when artwork is correctly linked) |
| `artwork.dbid` | Persistent artwork database ID |

**Per-thumbnail fields:**

| Field | Description |
|-------|-------------|
| `formatId` | Pixel format ID (e.g., 1055, 1056) -- determines dimensions and encoding for the device model |
| `filename` | Colon-separated iPod path to the ithmb file (e.g., `:Artwork:F1056_1.ithmb`) |
| `offset` | Byte offset into the ithmb file where this thumbnail's pixel data starts |
| `size` | Size in bytes of the pixel data at that offset |
| `width` / `height` | Thumbnail dimensions in pixels |

**Summary fields:**

| Field | Description |
|-------|-------------|
| `totalTracks` | Total tracks in the database |
| `tracksWithArtwork` | Tracks that have at least one thumbnail |
| `uniqueArtworkIds` | Distinct `artwork.id` values -- indicates how many unique artwork records exist |
| `uniqueMhiiLinks` | Distinct `mhiiLink` values -- when this differs from `uniqueArtworkIds`, the linking chain may be broken |

### Diagnosing corruption

When artwork is healthy, `uniqueArtworkIds` and `uniqueMhiiLinks` should be equal, and each track's `mhiiLink` should match its `artwork.id`. If they diverge, the ArtworkDB's linking chain is broken -- tracks point to MHII records that no longer exist, or MHII records reference ithmb data at stale offsets.

## `mhiiLink` field in libgpod-node

The `mhiiLink` field was added to the `Track` interface in `@podkit/libgpod-node` to expose `Itdb_Track.mhii_link` to TypeScript code.

**What it is:** An integer that links a track to its MHII artwork entry in the ArtworkDB. The ArtworkDB stores artwork as MHII records, each with an `image_id`. A track's `mhii_link` must match an MHII `image_id` for the iPod firmware to find the correct artwork.

**Values:**
- `0` -- no artwork link (track has no artwork, or artwork was removed)
- Any other value -- should match an MHII `image_id` in the ArtworkDB

**Why it was added:** To trace the full artwork linking chain from TypeScript during corruption investigation. Without this field, there was no way to programmatically check whether a track's artwork link is valid from the Node.js side.

**Files changed:**
- `packages/libgpod-node/native/gpod_converters.cc` -- reads `track->mhii_link` in `TrackToObject()`
- `packages/libgpod-node/src/types.ts` -- adds `mhiiLink: number` to the `Track` interface

The field is read-only in practice. It is assigned by libgpod when artwork is set on a track and the database is saved.
