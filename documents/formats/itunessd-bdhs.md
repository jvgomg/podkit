# `iTunesSD` — the `bdhs` shuffle playback database

## Map

`iTunesSD` is the on-disk database the **iPod shuffle 3rd and 4th generation**
firmware reads to know what to play and in what order. It lives at
`iPod_Control/iTunes/iTunesSD` and uses the **`bdhs`** container format (named
for its 4-byte magic) — a newer, richer format than the flat fixed-record
`iTunesSD` of the shuffle 1g/2g. On these devices it sits **alongside** a normal
`iTunesDB`: the `iTunesDB` holds the rich metadata (artist/album/title, used by
iTunes and by VoiceOver), while **`iTunesSD` is what the hardware actually plays
from.** The two are kept consistent by iTunes.

podkit **does not parse `iTunesSD` itself.** It reads a shuffle's library from
the `iTunesDB` (the only artifact with usable metadata), which is why the shuffle
3g/4g are classified **`read-only`** rather than `unsupported` — see
[ADR-024](../../adr/adr-024-device-access-tiers.md). Nor does podkit ask libgpod
to write one: `bdhs` is the branch libgpod takes for everything that is *not* a
shuffle 1g/2g, an unidentified device included, so emitting it is no evidence
that the device in front of you reads it. podkit deletes the `bdhs` an
initialisation writes for a device it could not identify, and refuses to
initialise an iPod shuffle whose model number is unknown.

> **Correction.** Earlier revisions of this document claimed writing a valid
> `iTunesSD` "requires an authentication hash iTunes generates and libgpod
> cannot". That is not grounded in the source. `itdb_shuffle_write_file`
> (`itdb_itunesdb.c`) assembles the `bdhs` regions into a plain buffer and
> commits it with `g_file_set_contents` — there is no signing, hashing or
> checksum step anywhere in the shuffle write path, and
> `itdb_device_get_checksum_type` returns `ITDB_CHECKSUM_NONE` for every
> shuffle generation. The 3g/4g `read-only` tier reflects what has been
> **verified on hardware**, not a cryptographic barrier.

This document exists so that knowledge is captured, not because podkit acts
on it.

## Provenance & fixtures

Built from a real iPod shuffle (4th generation) dump captured 2026-07-05:
`iTunesSD` = 34,020 bytes (`0x84E4`), 89 tracks, its `iTunesDB` reporting the
same 89 tracks. Offsets below were derived from the header/`hths` hexdump and
cross-checked arithmetically (see [Cross-checks](#cross-checks)).

> The source dump is a **personal device** and is **not** committed. A
> pinning fixture must be **synthetic or byte-scrubbed** (fake paths, neutral
> ordering) per the corpus rule in [README.md](README.md).

Confidence legend: ✅ confirmed against the dump · 🔶 inferred / unconfirmed.

## Layout

All multi-byte integers are **little-endian**. The file is three regions:
a `bdhs` file header, an `hths` track-header block (a length-prefixed table of
offsets), and the `rths` track records those offsets point at. A trailing region
holds order index arrays.

### `bdhs` file header — offset `0x00`, length `0x40` (64 bytes) ✅

```
00000000: 6264 6873 0100 0102 4000 0000 5900 0000  bdhs....@...Y...
00000010: 0100 0000 0000 0000 0000 0000 0000 0100  ................
00000020: 5900 0000 4000 0000 0c83 0000 0000 0000  Y...@...........
00000030: 0000 0000 0000 0000 0000 0000 0000 0000  ................
```

| Offset | Width | Value (this dump) | Meaning | Conf. |
|-------:|------:|-------------------|---------|:-----:|
| `0x00` | 4 | `bdhs` | Magic. | ✅ |
| `0x04` | 4 | `01 00 01 02` | Version / format flags. Exact semantics unknown. | 🔶 |
| `0x08` | 4 | `0x40` = 64 | Header length (→ offset of the `hths` block). | ✅ |
| `0x0C` | 4 | `0x59` = 89 | **Total track count.** Matches `iTunesDB`. | ✅ |
| `0x10` | 4 | `1` | Count of a secondary list (playlists / VoiceOver set?). | 🔶 |
| `0x20` | 4 | `0x59` = 89 | Track count, repeated. | ✅ |
| `0x24` | 4 | `0x40` = 64 | Offset to `hths` block. | ✅ |
| `0x28` | 4 | `0x830C` = 33548 | Offset to a trailing section (order arrays begin below `0x84B0`). | 🔶 |

### `hths` track-header block — offset `0x40`, length `0x178` (376 bytes) ✅

```
00000040: 6874 6873 7801 0000 5900 0000 0000 0000  hths............
00000050: 0000 0000 b801 0000 2c03 0000 a004 0000  ........,.......
00000060: 1406 0000 8807 0000 fc08 0000 700a 0000  ............p...
00000070: e40b 0000 580d 0000 cc0e 0000 4010 0000  ....X.......@...
```

| Offset | Width | Value | Meaning | Conf. |
|-------:|------:|-------|---------|:-----:|
| `0x40` | 4 | `hths` | Magic. | ✅ |
| `0x44` | 4 | `0x178` = 376 | Length of this block (header + offset table). | ✅ |
| `0x48` | 4 | `0x59` = 89 | Number of offset entries (= track count). | ✅ |
| `0x54` | 4×89 | `0x1B8`, `0x32C`, `0x4A0`, … | **Offset table**: one `uint32` per track, each the absolute offset of an `rths` record. | ✅ |

The offset table starts at `0x54` and holds 89 × 4 = 356 bytes, ending at
`0x54 + 356 = 0x1B8` — exactly the first record offset. Consecutive offsets step
by **372 bytes** (`0x32C − 0x1B8 = 0x174`), the fixed `rths` record size.

### `rths` track records — first at `0x1B8`, 372 bytes each ✅ (size) / 🔶 (internal layout)

Each record carries the track's on-disk path and its playback flags. Confirmed by
`strings`, the path field holds an absolute iPod path:

```
/iPod_Control/Music/F00/JVMC.mp3
/iPod_Control/Music/F02/SBWK.mp3
/iPod_Control/Music/F01/FYZV.m4a
```

| Field | Meaning | Conf. |
|-------|---------|:-----:|
| magic | `rths` at record start. | ✅ |
| path | Absolute `/iPod_Control/Music/FXX/XXXX.ext` string, fixed-width field. | ✅ |
| playback flags | start/stop time, volume, track type (music/podcast/audiobook), bookmark, dontskip, VoiceOver reference — exact offsets within the 372-byte record not yet mapped. | 🔶 |

### Trailing order arrays — below `0x84B0` 🔶

```
000084b0: 5500 0000 0d00 0000 5700 0000 5800 0000  U.......W...X...
000084c0: 0b00 0000 0c00 0000 0a00 0000 0900 0000  ................
000084d0: 0700 0000 0800 0000 2700 0000 2900 0000  ........'...)...
000084e0: 2800 0000                                (...
```

Runs of little-endian `uint32` values in track-index range (`0x55`=85, `0x0D`=13,
`0x57`=87, …). Interpreted as **play / shuffle order** and/or the VoiceOver
navigation order — one or more index permutations over the 89 tracks. Which array
is which, and how many there are, is unconfirmed.

## Cross-checks

A valid `bdhs` dump should satisfy:

1. `bdhs` track count (`0x0C`) == `hths` entry count (`0x48`) == number of `rths`
   records == the connected device's `iTunesDB` track count. (Here: all **89**.) ✅
2. `hths` offset table length (entries × 4) + `hths` header == first `rths` offset. ✅
3. Consecutive `hths` offsets differ by the fixed `rths` record size (372). ✅
4. Every `rths` path resolves to a real file under `iPod_Control/Music/`. 🔶 (spot-checked)

A mismatch in (1) between `iTunesDB` and `iTunesSD` would mean the metadata podkit
reads no longer matches what the hardware plays — the reason a shuffle read is a
read of the *library* (`iTunesDB`), not of *playback state*. podkit does **not**
currently perform this cross-check at runtime (deliberately out of scope, ADR-024).

## Open questions

- 🔶 `0x04` version/flags semantics; whether 3g and 4g differ here.
- 🔶 `0x10` and `0x28` header fields (secondary-list count; trailing-section offset).
- 🔶 Internal byte layout of the 372-byte `rths` record beyond the path.
- 🔶 The trailing index arrays: how many, which is play order vs VoiceOver order.
- 🔶 Whether a libgpod-written `bdhs` plays at all on a 3g/4g. No signature or
  checksum stands in the way (see the correction above); the write has simply
  never been tried on hardware — the crux of why the shuffle 3g/4g is
  `read-only`.

Confirming any of these means dumping a **synthetic** shuffle library with known
contents and diffing.

## References

- [ADR-024](../../adr/adr-024-device-access-tiers.md) — why the shuffle 3g/4g are `read-only`, not `unsupported`.
- [generations.md](generations.md) — the generation × support matrix; why the shuffle 3g/4g are `read-only`.
- doc-056 — PRD: Device Access Tiers.
- External: the iPod-linux / itunesdb.org `bdhs` notes (partial; 🔶 much of the record interior).
- podkit does not have an `iTunesSD` parser; `@podkit/ipod-db` parses `iTunesDB` and `ArtworkDB` only.
