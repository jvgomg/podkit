---
id: doc-008
title: iPod Artwork Corruption — Research & Autopsy Plan
type: other
created_date: '2026-03-21 14:24'
updated_date: '2026-03-21 15:30'
---
# iPod Artwork Corruption — Research & Autopsy Plan

## Purpose

This document is a research plan for investigating artwork corruption on iPod devices managed by podkit. The goal is to understand the root cause, determine what (if anything) can be detected and repaired programmatically, and produce a technical report that enables someone else to design user-facing solutions.

**This is an investigation, not a product spec.** The deliverable is a report explaining:
- What went wrong (confirmed root cause or narrowed candidates)
- How to detect corruption programmatically (what to look for, what tools/APIs to use)
- What data needs to change to restore consistency (which files, which fields, what operations)

Someone else will design the UX. They need this report to understand the problem space.

**Status: Investigation complete.** See Findings Log below and ADR-013 for the full technical report.

---

## Observed Symptoms

- Album artwork displays incorrectly on a 5th-generation iPod Video (MA147, 60GB)
- Playing a song shows artwork from a different track/album
- After rebooting the iPod and playing the same song, a *different* wrong artwork was displayed — suggesting the corruption is not a simple fixed offset shift
- A subsequent sync (adding more songs) did not resolve the issue
- Reproduction: play songs and observe the artwork displayed during playback (this iPod model only shows artwork during playback, not in list views)

## Subject Device

- **Model:** iPod Video 5th Generation (MA147, 60GB Black)
- **Device name:** TERAPOD
- **Key characteristic:** Non-sparse artwork — `itdb_device_supports_sparse_artwork()` returns FALSE for `ITDB_IPOD_GENERATION_VIDEO_1` and `VIDEO_2`
  - Every track gets its own separate copy of artwork pixel data in .ithmb files (no deduplication)
  - More entries = more rearrangement operations per save = more opportunities for corruption

---

## Hypotheses — Final Status

### H1: libgpod ithmb rearrangement bug

**Status:** Partially confirmed

The rearrangement code itself is logically correct for in-bounds data. However, the non-atomic write sequence (rearrange in-place → append new data → write ArtworkDB) creates a window where interruption corrupts the state. The rearrangement compacts the file BEFORE new data is appended, so an interruption after compaction but before append completion leaves a truncated file with a valid ArtworkDB referencing non-existent data.

### H2: Hardware/filesystem bit-rot

**Status:** Refuted

The corruption is systematic — a perfectly contiguous offset space with no gaps, not random bit flips. The ArtworkDB is internally consistent (sequential IDs, aligned offsets, valid structure). This rules out random hardware corruption.

### H3: Pre-release podkit code wrote inconsistent state

**Status:** Plausible contributing factor

Artwork hash changes (ADR-012) would trigger mass artwork replacement across many tracks in a single sync. This maximizes the number of MEMORY-type thumbnails that need to be appended during save, creating a larger vulnerability window for write interruption.

### H4: Artwork replace path is fundamentally flawed

**Status:** Confirmed as amplifier

Replacing artwork converts IPOD→MEMORY thumbnails, forcing ithmb compaction + rebuild. This creates the fragile window where the file is compacted (small) but needs to grow large again with new data. The more tracks that get artwork replaced in one sync, the larger the gap between compacted size and required size.

### H5: Something else entirely

**Status:** H6 identified (see below)

### H6: FAT32 write ordering / buffered I/O flush failure (NEW)

**Status:** Primary suspect for triggering event

libgpod writes ithmb files via buffered stdio (`fwrite`) then writes ArtworkDB via `g_file_set_contents` (temp file + atomic rename). On FAT32 over USB, the rename may hit disk before the buffered ithmb writes are flushed. If the iPod is ejected between these events, the ArtworkDB references data that was never persisted to the ithmb file.

---

## Findings Log

### Finding F-001: ithmb file size mismatch (CRITICAL)

**Phase:** 3a (Structural integrity)
**Relates to:** H1, H4, H6
**Evidence:**

The ArtworkDB is structurally sound but references data that doesn't exist in the ithmb files:

| Metric | Value |
|--------|-------|
| MHII entries in ArtworkDB | 2,532 |
| Unique artwork IDs | 2,532 (sequential 100-2631, no gaps) |
| Unique ithmb offsets referenced | 2,289 |
| Offsets shared by 2 entries | 243 (album-level dedup) |
| F1028_1.ithmb actual size | 4,920,000 bytes (246 slots) |
| F1029_1.ithmb actual size | 19,680,000 bytes (246 slots) |
| Offsets within file bounds | 246 (covering slots 0-245 perfectly) |
| Offsets BEYOND file bounds | 2,043 (starting at exactly the file boundary) |
| Offset alignment errors | 0 |
| Offset continuity gaps | 0 (perfectly contiguous 0 to 45,760,000) |

**Interpretation:** The ArtworkDB was written for ithmb files containing 2,289 thumbnails (~45.8 MB), but the actual files only contain 246 thumbnails (~4.9 MB). The corruption is a **size mismatch**, not a pointer corruption. The ArtworkDB offsets are exactly what you'd expect for a fully-populated file — the data was just never written (or was lost).

**Impact:** 2,043 tracks (~81%) display artwork from the wrong album. The "different wrong artwork after reboot" symptom is consistent with iPod firmware reading beyond ithmb file boundaries into adjacent FAT32 cluster data, which changes between boots.

**Self-perpetuation:** The corruption persists across syncs because OOB offsets become IPOD-type thumbnails in memory, pass through rearrangement unchanged (the data doesn't exist to relocate), and get written back to the ArtworkDB with the same bad offsets.

**Confidence:** High

### Finding F-002: Thumbnail extraction confirms valid pixel data in existing slots

**Phase:** 3c (Visual confirmation)
**Evidence:** Extracted and decoded RGB565 pixel data from F1029_1.ithmb slots 0-4 and 241-245. All produced valid, recognizable album artwork images (200×200 pixels). The 246 slots that DO exist contain correct, uncorrupted artwork data.

**Interpretation:** The corruption is limited to the size mismatch. The artwork data that IS present in the ithmb files is correct and uncorrupted.

**Confidence:** High

---

## Research Plan — Completion Status

### Phase 0: Backup the iPod ✅

iPod backed up to `~/Workstation/ipod-autopsy/ipod-backup/`. All analysis performed against backup.

### Phase 1: Code Audit ✅

Audited `ithumb-writer.c`, `db-artwork-writer.c`, `db-artwork-parser.c`. Key findings:
- Rearrangement logic is correct for in-bounds data
- Non-atomic write sequence (ithmb modified → new data appended → ArtworkDB written) is the fragile point
- No checksums or integrity validation in ArtworkDB format
- Self-perpetuation mechanism identified (OOB IPOD thumbs survive through read→rearrange→write cycles)

### Phase 2: Build Analysis Tools ✅

Tools built:
- `~/Workstation/ipod-autopsy/tools/artworkdb-parser.ts` — Binary ArtworkDB parser
- `~/Workstation/ipod-autopsy/tools/integrity-checker.ts` — Structural integrity checker
- `~/Workstation/ipod-autopsy/tools/ithmb-extractor.ts` — RGB565 ithmb to PPM/PNG converter
- `~/Workstation/ipod-autopsy/tools/cross-reference.ts` — Track ↔ artwork cross-reference
- `~/Workstation/ipod-autopsy/tools/run-autopsy.ts` — Main autopsy runner
- Added `mhiiLink` field to libgpod-node Track bindings

### Phase 3: Autopsy ✅

- 3a (Structural integrity): Complete — F-001 identified
- 3b (Offset pattern analysis): Complete — perfectly contiguous offset space, no rearrangement artifacts
- 3c (Visual confirmation): Complete — valid artwork in existing slots confirmed
- 3d (Source comparison): Not needed — structural diagnosis is definitive

### Phase 4: Report ✅

See ADR-013 for the full technical report including detection approach, repair strategy, and prevention recommendations.

---

## Key Resources

| Resource | Location |
|----------|----------|
| ADR-013 (full technical report) | `adr/adr-013-ipod-artwork-corruption-diagnosis-and-repair.md` |
| Integrity report (JSON) | `~/Workstation/ipod-autopsy/findings/integrity-report.json` |
| Finding F-001 detail | `~/Workstation/ipod-autopsy/findings/F-001-ithmb-truncation.md` |
| Extracted thumbnails | `~/Workstation/ipod-autopsy/findings/thumbnails/` |
| iPod backup | `~/Workstation/ipod-autopsy/ipod-backup/` |
| Analysis tools | `~/Workstation/ipod-autopsy/tools/` |
| Track export (JSON) | `~/Workstation/ipod-autopsy/findings/tracks-export.json` |
| libgpod source | `tools/libgpod-macos/build/libgpod-0.8.3/src/` |
