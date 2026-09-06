# ADR-013: iPod Artwork Corruption — Diagnosis and Repair

## Status

**Accepted** (2026-03-21)

## Context

Users report album artwork on iPods "randomly glitching" — tracks display artwork belonging to a different track or album. This is a commonly reported issue online and has been observed firsthand on a 5th-generation iPod Video (MA147, 60GB Black). These older iPods use per-track artwork storage (no deduplication), making them particularly sensitive to artwork database inconsistencies.

This ADR documents the full investigation into the root cause, the iPod artwork internals relevant to the issue, and the design for a diagnostic/repair tool.

## Investigation Summary

### Scope of Analysis

The investigation covered every layer of the artwork pipeline:

1. **podkit sync executor** — artwork-updated, artwork-removed, artwork-added upgrade paths
2. **podkit-core IpodTrack/IpodDatabase** — handle-based snapshot pattern, artwork method delegation
3. **libgpod-node native bindings** — `SetTrackThumbnailsFromData`, `RemoveTrackThumbnails`, `ReplaceTrackFile`
4. **libgpod C internals** — the full artwork save pipeline: `itdb_prepare_thumbnails()` → `ipod_artwork_db_set_ids()` → `itdb_write_ithumb_files()` → `ipod_write_artwork_db()`
5. **ithmb file management** — in-place rearrangement, compaction, append-mode writing
6. **Sparse vs non-sparse artwork** — behavior differences between iPod generations

### What We Confirmed Is Correct

**podkit sync executor:**
- Each track's artwork is set via its specific handle — no cross-track contamination possible
- The handle-based snapshot pattern correctly delegates to the right C++ track object
- `transferArtwork()` modifies the underlying libgpod object, and subsequent `update()` calls refresh the TypeScript snapshot
- Artwork errors are caught as warnings, don't corrupt other tracks
- Single `ipod.save()` call after all operations complete (no partial saves)

**libgpod-node bindings:**
- `SetTrackThumbnailsFromData` directly wraps `itdb_track_set_thumbnails_from_data()` — no behavioral deviation
- `ReplaceTrackFile` does NOT touch artwork — artwork is handled separately
- `RemoveTrackThumbnails` directly wraps `itdb_track_remove_thumbnails()`

**libgpod track-level API:**
- `itdb_track_set_thumbnails_internal()` clears `artwork->id = 0` before setting new artwork — prevents stale ID references
- `itdb_track_remove_thumbnails()` → `itdb_artwork_remove_thumbnails()` clears `artwork->id = 0` — prevents dangling references

### Autopsy Findings (2026-03-21)

**Finding F-001: ithmb file size mismatch**

The ArtworkDB is structurally sound — 2,532 MHII entries with perfectly sequential IDs (100-2631), no gaps, no duplicates, all offsets properly aligned to slot boundaries. However, the .ithmb files contain only 246 thumbnail slots while the ArtworkDB references 2,289 unique slot positions.

Key data:
- F1028_1.ithmb: 4,920,000 bytes = 246 slots x 20,000 bytes
- F1029_1.ithmb: 19,680,000 bytes = 246 slots x 80,000 bytes
- ArtworkDB references: 2,289 unique offsets from 0 to 45,760,000 (format 1028)
- Out-of-bounds: 2,043 offsets reference positions beyond the file boundary
- In-bounds: 246 offsets perfectly cover all physical slots (0 through 4,900,000)
- Offset sharing: 243 offsets are shared by exactly 2 MHII entries (album-level deduplication)
- The offset space is perfectly contiguous (no gaps in the sequence of unique offsets)
- OOB offsets start at exactly the file boundary (4,920,000 for format 1028)

**Impact on iPod playback:**
- 2,043 tracks reference non-existent pixel data
- If firmware wraps reads (offset % file_size), every OOB track displays artwork from an unrelated album's slot — each physical slot shared by ~8-9 ghost tracks
- If firmware reads beyond file boundaries, it gets FAT32 cluster data, explaining the "different wrong artwork after reboot" symptom

**Self-perpetuation mechanism:**
The corruption persists across syncs because:
1. On database parse, OOB offsets become IPOD-type thumbnail items in memory
2. The ithmb rearrangement can't fix them (the referenced data doesn't exist in the file)
3. Only newly added tracks get MEMORY-type thumbnails that trigger fresh writes
4. The ArtworkDB is rewritten preserving OOB offsets for all existing tracks
5. Result: corruption is permanent unless ALL artwork is force-rebuilt

### Root Cause: libgpod's In-Place ithmb Rearrangement

The most likely cause of artwork corruption is in libgpod's `ithmb_rearrange_existing_thumbnails()` function (`ithumb-writer.c:1402-1524`), which performs **in-place binary surgery** on the `.ithmb` files during every database save.

#### How the ithmb Rearrangement Works

When artwork changes (tracks added, removed, or artwork updated), the `.ithmb` files containing raw pixel data need to be compacted. libgpod does this by:

1. Collecting all still-referenced thumbnail items into a hash table keyed by `.ithmb` filename
2. Walking through each `.ithmb` file slot-by-slot (each slot is one thumbnail's worth of pixel data)
3. If a slot is unreferenced (orphaned), copying data from the **last occupied slot** in the file to fill the gap
4. Updating the `offset` field in the moved thumbnail's `Itdb_Thumb_Ipod_Item` to reflect its new position
5. Truncating the file to remove the now-empty space at the end
6. After compaction, opening the file in **append mode** (`"ab"`) and writing new thumbnails at the end

#### Why This Can Corrupt Artwork

This in-place rearrangement is inherently fragile:

1. **Offset miscalculation during compaction:** The rearrangement code moves raw pixel data between positions in the file and updates offset pointers. If the offset update is applied to the wrong thumbnail item (e.g., when multiple thumbnails share the same original offset due to a prior bug), artwork for one track could end up pointing to another track's pixel data.

2. **Partial write / interrupted save:** The rearrangement modifies the `.ithmb` file first, then the ArtworkDB is written. If the process is interrupted between these two steps (crash, USB disconnect, power loss), the ArtworkDB entries reference old offsets while the ithmb data has already been rearranged. On the next read, tracks would display whatever pixel data happens to be at their (now-stale) offset — appearing as "random" artwork from other tracks.

3. **File I/O ordering:** The rearrangement uses `open()` + `read()` + `write()` + `ftruncate()` + `close()`, then the writer opens the same file with `fopen("ab")`. On FAT32 filesystems (used by iPods), metadata updates may not be flushed atomically. An interrupted operation could leave the file in an inconsistent state.

4. **Cumulative drift:** Each save cycle performs a fresh rearrangement. Small inconsistencies can accumulate over multiple sync sessions, gradually scrambling artwork associations.

#### Non-Sparse Devices Are More Vulnerable

The 5th-gen iPod Video does not support "sparse artwork" (`itdb_device_supports_sparse_artwork()` returns `FALSE` for `ITDB_IPOD_GENERATION_VIDEO_1` and `ITDB_IPOD_GENERATION_VIDEO_2`). This means:

- **No deduplication:** Every track gets its own separate copy of artwork pixel data in the `.ithmb` file, even if multiple tracks share identical artwork (same album)
- **More data to rearrange:** More entries means more opportunities for the rearrangement logic to move data incorrectly
- **Larger ithmb files:** More pixel data means the compaction operates on larger files with more slots

Newer iPods (Classic, Nano 3+) support sparse artwork where identical images are deduplicated via shared artwork IDs. These devices have fewer unique ithmb entries to rearrange and are thus less vulnerable to this class of bug.

### Confirmed Root Cause

The confirmed corruption is a **size mismatch between the ArtworkDB and ithmb files**. The ArtworkDB was written for ithmb files containing 2,289 thumbnails, but the actual files only contain 246 thumbnails. The most likely triggering events:

1. **Write ordering on FAT32 (H6):** libgpod writes ithmb files via buffered stdio (fwrite) then writes ArtworkDB via g_file_set_contents (temp file + atomic rename). On FAT32 over USB, the rename may hit disk before the buffered ithmb writes are flushed. If the iPod is ejected between these events, the ArtworkDB references data that was never persisted.

2. **Interrupted artwork rebuild:** If podkit replaced artwork on most tracks (e.g., artwork hash upgrade from ADR-012), the save would: (a) compact the ithmb to only the unchanged tracks' slots, (b) append 2,000+ new thumbnails. If interrupted during the append, the ithmb would be truncated while the ArtworkDB expected the full file.

3. **The rearrangement is NOT the root cause** of this specific corruption. The rearrangement code correctly handles in-bounds data. The problem is that data never made it to disk, not that the rearrangement scrambled existing data. However, the rearrangement IS the mechanism that compacts the file before the append, making the system fragile to interruption.

### Hypothesis Table (Final Status)

| ID | Hypothesis | Status |
|----|-----------|--------|
| H1 | Rearrangement bug in ithmb compaction | **Partially confirmed** — not a logic error in rearrangement itself, but the non-atomic write sequence (rearrange in-place -> append new data -> write ArtworkDB) creates a window where interruption corrupts the state |
| H2 | Bit-rot / media degradation | **Refuted** — corruption is systematic (perfectly contiguous offset space, not random bit flips) |
| H3 | Pre-release code caused initial corruption | **Plausible contributing factor** — artwork hash changes in ADR-012 would trigger mass artwork replacement, maximizing the vulnerability window |
| H4 | Artwork replace path triggers corruption | **Confirmed as amplifier** — replacing artwork converts IPOD->MEMORY thumbnails, forcing ithmb compaction + rebuild, creating the fragile window |
| H5 | Something else entirely | H6 added (see below) |
| H6 | FAT32 write ordering / buffered I/O flush failure | **Primary hypothesis** — explains the exact symptom: ArtworkDB persisted but ithmb data lost |

### Contributing Factor: No Checksums in ArtworkDB

The ArtworkDB format has **no checksums, CRCs, or integrity validation** of any kind. The only structural validation is:
- 4-byte ASCII magic headers ("mhfd", "mhii", "mhni", etc.)
- `total_len` fields that should sum correctly
- `num_children` counts

There is no way for the iPod firmware or libgpod to detect that pixel data at a given ithmb offset doesn't match what was originally written for a specific track. Corruption is silent.

## iPod Artwork Architecture Reference

### File Layout on iPod

```
iPod_Control/
├── iTunes/
│   └── iTunesDB              # Track database — contains mhii_link per track
├── Artwork/
│   ├── ArtworkDB             # Artwork database — mhii entries with ithmb references
│   ├── F1028_1.ithmb         # Pixel data for format 1028 (100×100 RGB565)
│   ├── F1029_1.ithmb         # Pixel data for format 1029 (200×200 RGB565)
│   └── ...                   # Additional files if > 256 MB per format
└── Device/
    └── SysInfo               # Model identification (e.g., "ModelNumStr: MA147")
```

### ArtworkDB Binary Structure

```
MHFD (Database Header)
├── MHSD type=1 (Image List Section)
│   └── MHLI (Image List)
│       ├── MHII (Image Item — one per unique artwork)
│       │   ├── image_id      → matches track.mhii_link
│       │   ├── song_id       → track.dbid (backward compat)
│       │   └── MHOD type=2 (Thumbnail Container)
│       │       └── MHNI (Thumbnail Reference)
│       │           ├── format_id    → artwork format (1028, 1029, etc.)
│       │           ├── ithmb_offset → byte offset into .ithmb file
│       │           ├── image_size   → byte count of pixel data
│       │           └── MHOD type=3 (Filename — e.g., ":F1028_1.ithmb")
│       └── ... more MHII entries
├── MHSD type=2 (Album List Section)
│   └── MHLA → MHBA (Photo album entries, not used for music artwork)
└── MHSD type=3 (File List Section)
    └── MHLF → MHIF (Format info entries — one per artwork format)
```

### Track → Artwork Linking

The iPod firmware resolves artwork for a track through this chain:

```
iTunesDB track record
    └── mhii_link (uint32)
            │
            ▼
ArtworkDB MHII entry
    └── image_id == mhii_link
        └── MHNI child
            ├── filename: ":F1028_1.ithmb"
            ├── offset: 204800       ← byte position in ithmb file
            └── size: 20000          ← bytes of pixel data
                    │
                    ▼
.ithmb file
    └── raw RGB565 pixel data at offset 204800, length 20000
```

**Two linking strategies (used by libgpod):**
- **Non-sparse (Gen 5):** Each track gets a unique `artwork->id`. `track.mhii_link = artwork->id`. 1:1 mapping.
- **Sparse (Classic, Nano 3+):** Multiple tracks can share the same `artwork->id` if they have identical artwork. The MHII entry is written once; multiple tracks reference it via `mhii_link`.

### Artwork ID Assignment During Save

`ipod_artwork_db_set_ids()` in `db-artwork-writer.c` runs during every `itdb_write()`:

**Non-sparse path (Gen 5):**
```c
guint32 cur_id = 0x64;  // IDs start at 100
for each track in db->tracks:
    track->mhii_link = 0;
    if track has thumbnails:
        track->artwork->id = cur_id++;
        track->artwork->dbid = track->dbid;
    track->mhii_link = track->artwork->id;
```

Key observations:
- IDs are **reassigned sequentially** on every save based on track list order
- A track's artwork ID can change between saves if tracks are added/removed before it in the list
- The `mhii_link` is set unconditionally to `artwork->id`, even for tracks without thumbnails (though `artwork->id` should be 0 for those)

**Sparse path (Classic+):**
- Same sequential renumbering, but with a deduplication pass (`ipod_artwork_mark_new_doubles`) that assigns the same ID to tracks with identical artwork (within the same album)

### ithmb Pixel Format (iPod Video)

iPod Video uses RGB565 little-endian:
- 5 bits red (bits 11-15)
- 6 bits green (bits 5-10)
- 5 bits blue (bits 0-4)
- 2 bytes per pixel, no alpha channel

Two artwork sizes:
| Format ID | Size | Bytes per thumbnail |
|-----------|------|---------------------|
| 1028 | 100×100 | 20,000 bytes |
| 1029 | 200×200 | 80,000 bytes |

Thumbnails are stored back-to-back in `.ithmb` files, each file capped at 256 MB.

### Key libgpod Save Sequence

When `itdb_write()` is called, artwork is saved in this order:

1. **`itdb_prepare_thumbnails()`** — renumber all artwork IDs
2. **`itdb_write_ithumb_files()`**:
   a. For each artwork format: `ithmb_rearrange_existing_thumbnails()` — compact existing ithmb data
   b. Create `iThumbWriter` per format (opens ithmb in append mode)
   c. For each track with new/changed artwork (non-IPOD thumb type): write pixel data, convert MEMORY/FILE/PIXBUF thumb → IPOD thumb with offset
3. **`ipod_write_artwork_db()`** — write the ArtworkDB binary file referencing the ithmb offsets

**Critical order dependency:** If step 2a (rearrangement) corrupts ithmb data or offsets, step 3 writes an ArtworkDB that faithfully records the corrupted state. The corruption becomes permanent.

## Current Diagnostic Capabilities

| Capability | Available? | Details |
|-----------|-----------|---------|
| List tracks with artwork flag | Yes | `podkit device music --tracks` |
| Count unique artwork IDs | Yes | `database.getUniqueArtworkIds()` (native binding) |
| Read `mhii_link` per track | **No** | Field exists in libgpod but not exposed in TypeScript Track interface |
| Inspect ArtworkDB entries | **No** | No ArtworkDB inspection API |
| Validate ithmb offsets | **No** | No ithmb inspection API |
| Map tracks to ithmb data | **No** | Requires mhii_link + ArtworkDB parsing |
| Detect artwork mismatches | **No** | No way to compare expected vs actual pixel data |
| Repair artwork | **No** | No rebuild command |

## Proposed Solution: Artwork Repair Command

### Concept

A `podkit device artwork repair` command that rebuilds the entire artwork database from scratch — re-extracting artwork from source files and rewriting all ithmb data — without touching the audio files or track metadata on the iPod.

This bypasses the fragile ithmb rearrangement entirely by writing fresh, clean artwork data.

### Design

**Phase 1: Diagnostic subcommand (`podkit device artwork diagnose`)**

Expose information needed to understand artwork state:

1. Expose `mhii_link` in the TypeScript Track interface (requires adding to `TrackToObject` in `gpod_converters.cc`)
2. Read the ArtworkDB and report:
   - Number of MHII entries vs tracks with artwork
   - Any tracks whose `mhii_link` points to a non-existent MHII entry
   - Any MHII entries not referenced by any track (orphans)
   - Any MHNI entries with offsets that exceed the corresponding ithmb file size
   - Summary of ithmb file sizes and expected vs actual thumbnail counts
3. Output a diagnostic report (JSON and human-readable)

**Phase 2: Repair subcommand (`podkit device artwork repair`)**

Rebuild artwork from source without re-syncing audio:

1. Read current track list from iPod database (get all tracks with their sync tags)
2. Match each iPod track back to its source file using the sync tag or file path
3. For each matched track:
   a. Extract artwork from the source file (same `extractArtwork()` used during sync)
   b. Call `setArtworkFromData()` to set new artwork on the track
4. Call `save()` once — this writes fresh ithmb files and a new ArtworkDB

Because ALL tracks get new MEMORY-type thumbnails, the rearrangement code has nothing to rearrange (no existing IPOD-type thumbs). The ithmb files are written clean from scratch.

**Phase 3: Backup and comparison (`podkit device artwork backup`)**

Before repair:
1. Copy `ArtworkDB` and all `.ithmb` files to a backup directory
2. After repair, optionally compare old vs new to understand what changed

### Why This Works

The repair command sidesteps the rearrangement bug entirely:

```
Normal sync (incremental):
  existing IPOD thumbs → rearrange in place → append new → write ArtworkDB
  ↑ fragile: in-place binary surgery on ithmb files

Repair (full rebuild):
  ALL tracks → fresh MEMORY thumbs → write ALL to new ithmb → write ArtworkDB
  ↑ safe: no rearrangement needed, all data written fresh
```

### User Experience

```bash
# Diagnose artwork issues
podkit device artwork diagnose --device /Volumes/iPod

# Back up current artwork data
podkit device artwork backup --device /Volumes/iPod --output ~/ipod-artwork-backup/

# Repair artwork (requires source collection for artwork extraction)
podkit device artwork repair --device /Volumes/iPod --config config.toml

# Dry-run to preview what would change
podkit device artwork repair --device /Volumes/iPod --config config.toml --dry-run
```

### Requirements for Repair

- Source collection must be accessible (directory path or Subsonic server)
- Config file needed to locate source collections
- Tracks are matched by sync tag content (file path, quality preset) or metadata (title + artist + album)
- Tracks that can't be matched to a source keep their existing artwork (untouched)
- Tracks whose source has no artwork get their artwork removed

### Implementation Considerations

1. **mhii_link exposure:** Add `mhiiLink` to the Track interface and `TrackToObject` converter in libgpod-node. This is a read-only uint32 field.

2. **Artwork extraction reuse:** The `extractArtwork()` function from `podkit-core/src/artwork/extractor.ts` already handles FLAC, MP3, M4A, etc. The repair command can reuse this directly.

3. **Subsonic artwork:** For Subsonic sources, the repair command would need to fetch artwork via `getCoverArt`. This could be expensive for large libraries — consider caching.

4. **Progress reporting:** Artwork extraction and setting for thousands of tracks takes time. Show per-track progress with estimated completion.

5. **No audio transfer:** The repair command MUST NOT modify audio files. Only artwork operations (`setArtworkFromData`, `removeArtwork`) and sync tag updates.

6. **Sync tag preservation:** Update only the `art=` hash in sync tags. All other sync tag fields (quality, encoding) must be preserved.

## Broader Context: Known Issue in the iPod Ecosystem

This artwork corruption issue is not specific to podkit. It's a well-known problem in the iPod community, reported by users of various iPod management tools (gtkpod, Rhythmbox, Banshee, Amarok) that use libgpod. The root cause — fragile in-place ithmb rearrangement — is in libgpod itself, which all these tools share.

iTunes avoids this issue because it:
1. Has full control over the artwork database format (it defined it)
2. Likely writes artwork databases atomically rather than using in-place modification
3. Also stores artwork in MP3/M4A tags as a fallback (libgpod doesn't do this)

The libgpod documentation itself acknowledges this: "iTunes additionally stores the artwork as tags in the original music file. libgpod does not store the artwork as tags in the original music file. As a consequence, if iTunes attempts to access the artwork, it will find none, and remove libgpod's artwork."

A repair command that rebuilds artwork from scratch is a pragmatic solution that works within libgpod's constraints while avoiding the problematic code path.

## Detection Approach

Programmatic detection of this corruption is a fast O(n) check:

```
For each artwork format:
  1. Get the .ithmb file size
  2. Parse ArtworkDB MHNI entries for that format
  3. Check if any MHNI offset + size > file size
  4. If yes: corruption detected
  5. Count: how many entries are out-of-bounds
```

This can run as part of `podkit device info` or `podkit device artwork diagnose`.

## Repair Approach

The repair command (`podkit device artwork repair`) should:
1. Remove ALL thumbnails from ALL tracks (making them MEMORY-type or clearing them)
2. Re-extract artwork from the source collection for each track
3. Set fresh artwork on each track via setArtworkFromData
4. Call save() once — this writes fresh ithmb files from scratch (no rearrangement needed since there are no existing IPOD-type thumbs)
5. Verify: re-parse ArtworkDB and confirm all offsets are within ithmb file bounds

**Prevention (for future syncs):**
- After `itdb_write()`, verify that all ArtworkDB offsets are within ithmb file bounds
- If not, log an error and potentially retry the write
- Consider adding fsync after ithmb writes and before ArtworkDB write (requires libgpod modification or wrapper)
- Document that users should always "eject" the iPod properly (not just unplug) to ensure write flushing

## Tools Produced

Autopsy tools created during the investigation:

- `~/Workstation/ipod-autopsy/tools/artworkdb-parser.ts` — Binary ArtworkDB parser
- `~/Workstation/ipod-autopsy/tools/integrity-checker.ts` — Structural integrity checker
- `~/Workstation/ipod-autopsy/tools/ithmb-extractor.ts` — RGB565 ithmb to PPM/PNG converter
- `~/Workstation/ipod-autopsy/tools/cross-reference.ts` — Track <-> artwork cross-reference tool
- `~/Workstation/ipod-autopsy/tools/run-autopsy.ts` — Main autopsy runner

Binding changes:

- `packages/libgpod-node/native/gpod_converters.cc` — Added mhiiLink field to Track bindings
- `packages/libgpod-node/src/types.ts` — Added mhiiLink to Track interface

## Related Decisions

- [ADR-012](adr-012-artwork-change-detection.md): Artwork change detection — the hash-based system that detects artwork changes
- [ADR-009](adr-009-self-healing-sync.md): Self-healing sync — the upgrade detection framework
- [ADR-002](adr-002-libgpod-binding.md): libgpod binding approach — N-API bindings architecture
- [ADR-005](adr-005-test-ipod-environment.md): Test iPod environment — test iPods use MA147 (same as affected device)

## References

- [libgpod source code (fadingred/libgpod)](https://github.com/fadingred/libgpod) — `src/ithumb-writer.c`, `src/db-artwork-writer.c`
- [libgpod artwork API documentation](http://www.gtkpod.org/libgpod/docs/libgpod-Artwork.html)
- [iPod Database Specification (iPodLinux wiki)](https://web.archive.org/web/20100328043222/http://ipodlinux.org/wiki/ITunesDB)
