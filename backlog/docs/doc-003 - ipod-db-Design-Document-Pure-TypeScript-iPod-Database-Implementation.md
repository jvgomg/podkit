---
id: doc-003
title: 'ipod-db Design Document: Pure TypeScript iPod Database Implementation'
type: other
created_date: '2026-03-12 10:45'
updated_date: '2026-04-03 19:47'
---
# @podkit/ipod-db — Design Document

This document is the **canonical reference** for replacing `@podkit/libgpod-node` (C/N-API bindings to libgpod) with a pure TypeScript implementation. It supersedes ADR-009 (PR #18) and incorporates findings from deep analysis of the libgpod 0.8.3 source code, the existing podkit codebase, and research into TypeScript binary parsing patterns.

---

## 0. Virtual iPod: Read-Only Phase (m-17)

> **Added 2026-04-03.** The Virtual iPod project (m-17) needs a read-only iTunesDB parser that runs in the browser. This accelerates the early phases of m-8 and adds a few new tasks.

The read-only parser shares foundational work with m-8:

| m-8 Task | Shared with m-17? | Notes |
|----------|-------------------|-------|
| TASK-113 (golden fixtures) | Yes | Validates both read-only and read/write parsers |
| TASK-114 (package skeleton) | Yes | BufferReader must use `DataView`/`Uint8Array` for browser compat |
| TASK-115 (BufferReader/Writer) | Reader only | BufferWriter deferred to m-8 Phase 2 |
| TASK-116 (record parsers) | Yes | Already read-only by design |
| TASK-120 (SysInfo + models) | Subset | m-17 gets read-only subset (TASK-265); m-8 adds write capabilities later |

New tasks specific to the Virtual iPod (m-17):

| Task | Description |
|------|-------------|
| TASK-264 | Read-only ArtworkDB parser + .ithmb thumbnail extractor (browser-compatible) |
| TASK-265 | Read-only SysInfo parser + model table (subset of TASK-120) |
| TASK-266 | Read-only `IpodReader` facade — high-level query API for ipod-web firmware |

**Key browser compatibility requirement:** `BufferReader` must use `DataView` for integer reads (not `Buffer.readUInt32LE()`) so it works with `Uint8Array` in Web Workers. `Buffer` extends `Uint8Array`, so this is backwards-compatible with Node.js.

**WASM was evaluated and rejected** — see doc-027 for the full spike findings. GLib has no official WASM support; the maintenance burden of community forks is disproportionate. A pure TypeScript parser is smaller, simpler, and runs everywhere.

---

## 1. Scope and Phasing

### Three Milestones

**M1 — ipod-db Core (m-8):** The 24 methods podkit-core uses today, plus all hash algorithms and full device support (including big-endian). Drop-in replacement milestone.

**M2 — ipod-db Extended API (m-9):** Smart playlist CRUD (8 methods), chapter/audiobook CRUD (4 methods), additional utility methods (12 methods). Enables future features.

**M3 — ipod-db Photo Database (m-10):** PhotoDatabase class (~15 methods) for photo/album management.

### API Surface by Milestone

| Category | M1 (Core) | M2 (Extended) | M3 (Photos) |
|----------|-----------|---------------|-------------|
| Database lifecycle | open, create, initializeIpod, save, close | openFile, setMountpoint, getFilename | — |
| Track CRUD | getTracks, addTrack, getTrack, updateTrack, removeTrack | duplicateTrack, getTrackByDbId | — |
| Track files | copyTrackToDevice, getTrackFilePath | — | — |
| Artwork | setTrackArtwork, setTrackArtworkFromData, removeTrackArtwork, hasTrackArtwork | getUniqueArtworkIds, getArtworkCapabilities | — |
| Playlists | getPlaylists, getMasterPlaylist, getPlaylistByName, createPlaylist, removePlaylist, renamePlaylist, addTrackToPlaylist, removeTrackFromPlaylist, playlistContainsTrack | getPlaylistById, getPlaylistTracks | — |
| Smart playlists | — | 8 CRUD methods | — |
| Chapters | — | 4 CRUD methods | — |
| Device | getInfo, device property | getSysInfo, setSysInfo, getDeviceCapabilities | — |
| Photos | — | — | ~15 methods |

### Device and Format Support

Full libgpod parity across all milestones:
- Little-endian and big-endian iPods
- All hash algorithms: hash58 (Classic, Nano 3-4), hash72 (Nano 5, Touch 1-3, iPhone 1-3), hashAB (Touch 4, iPhone 4, iPad 1, Nano 6 — via external libhashab, same approach as libgpod)
- All artwork pixel formats: RGB565, RGB555, UYVY, I420, RGB888, REC_RGB555
- All iPod model numbers (~200 models across 32 generations)

---

## 2. Code Organisation

### Package Structure

```
packages/ipod-db/
├── src/
│   ├── index.ts                    # Public API exports
│   ├── database.ts                 # High-level Database class (m-8, TASK-121)
│   ├── reader.ts                   # Read-only IpodReader facade (m-17, TASK-266)
│   │
│   ├── binary/                     # Binary I/O primitives
│   │   ├── reader.ts               # BufferReader cursor (DataView-based for browser compat)
│   │   ├── writer.ts               # BufferWriter cursor
│   │   └── errors.ts               # ParseError with offset context
│   │
│   ├── itunesdb/                   # iTunesDB format
│   │   ├── parser.ts               # Parse orchestration
│   │   ├── writer.ts               # Write orchestration
│   │   ├── types.ts                # Record type interfaces
│   │   └── records/                # One module per record type
│   │       ├── mhbd.ts, mhsd.ts, mhlt.ts, mhit.ts, mhod.ts
│   │       ├── mhlp.ts, mhyp.ts, mhip.ts
│   │       └── mhla.ts, mhba.ts, mhia.ts
│   │
│   ├── artworkdb/                  # ArtworkDB + .ithmb
│   │   ├── parser.ts, writer.ts, ithmb.ts
│   │   ├── pixel-formats.ts        # RGB565, RGB555, UYVY, I420, RGB888, REC_RGB555
│   │   └── types.ts
│   │
│   ├── photodb/                    # Photo Database (M3)
│   │   ├── parser.ts, writer.ts, types.ts
│   │
│   ├── device/                     # Device identification
│   │   ├── sysinfo.ts              # SysInfo text parser (NOT SysInfoExtended — see note)
│   │   ├── models.ts               # ~200 model entries, 32 generations
│   │   └── types.ts
│   │
│   ├── hash/                       # Checksum algorithms
│   │   ├── hash58.ts               # HMAC-SHA1 (Node.js crypto)
│   │   ├── hash72.ts               # SHA-1 + AES-128-CBC (Node.js crypto)
│   │   ├── hashAB.ts               # External libhashab wrapper
│   │   └── index.ts                # Device → algorithm selection
│   │
│   └── files/                      # iPod filesystem operations
│       ├── copy.ts                 # F00-F49 file copy
│       └── paths.ts                # Path conversion
│
├── __tests__/                      # Mirrors src/ structure
└── package.json
```

### SysInfoExtended: Out of Scope

SysInfoExtended is an XML/plist file used by Touch/iPhone/iPad — devices outside podkit's target range. The basic SysInfo text parser + model lookup table is sufficient for all target devices. If Touch support is ever added, SysInfoExtended can be implemented as a separate task with a plist parsing dependency.

---

## 3. Technical Decisions (All Resolved)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | API scope | M1: 24 methods. M2: extended. M3: photos | Deliver working replacement first |
| D2 | Hash support | All: hash58, hash72, hashAB | Full libgpod parity |
| D3 | Binary parsing | Manual BufferReader/Writer, zero deps | No library handles variable-header + unknown-bytes |
| D4 | Image processing | **Research needed (TASK-129)** | sharp vs FFmpeg vs WASM — must work in single-binary compilation |
| D5 | Pixel formats | All: RGB565, RGB555, UYVY, I420, RGB888, REC_RGB555 | Full device coverage |
| D6 | Unknown MHODs | Preserve as opaque buffers | Improvement over libgpod |
| D7 | Atomic writes | Temp file + rename | Crash safety |
| D8 | Database version | Write 0x30 (iTunes 9.2) | Maximum compatibility |
| D9 | String encoding | Write UTF-16LE/BE based on endianness | Read both |
| D10 | Package name | `@podkit/ipod-db` | Confirmed |
| D11 | Big-endian | Full support | libgpod parity |
| D12 | SQLite | **Research needed (TASK-130)** | Classic 3rd gen may require it |
| D13 | Compressed DBs | Implement (Node.js zlib) | Needed for Nano 5G+ |
| D14 | Photo database | M3 milestone | Future feature |
| D15 | SysInfoExtended | Not implemented | Only Touch/iPhone/iPad use it |
| D16 | WASM compilation | **Rejected** (doc-027) | GLib has no official WASM support; maintenance burden too high |
| D17 | Browser compat | DataView-based BufferReader | Works with Uint8Array in Web Workers; Buffer extends Uint8Array for Node.js compat |

### Open Research Items

**TASK-129: Image processing for single-binary compilation.** The project ships compiled single binaries per architecture. `sharp` ships native addons which may not bundle cleanly. FFmpeg (already a user dependency) can output raw pixel data in all needed formats, potentially eliminating sharp entirely. Must be resolved before Phase 3 (artwork).

**TASK-130: SQLite for iPod Classic 3rd gen.** libgpod generates SQLite databases for devices with `supportsSqliteDb()`. Classic 3rd gen is in this set. We don't have hardware to test. Need to research whether the firmware requires SQLite or rebuilds it from iTunesDB. If required, adds `better-sqlite3` dependency and a new implementation task.

---

## 4. Binary Format Details

### iTunesDB Record Hierarchy

```
mhbd (Database Header, 244 bytes)
├── mhsd type 1 → mhlt → mhit × N → mhod × M (tracks)
├── mhsd type 3 → mhlp → mhyp × N (podcasts)
├── mhsd type 2 → mhlp → mhyp × N → mhip × N (playlists)
├── mhsd type 4 → mhla → mhba × N (albums)
├── mhsd type 8 → mhli → mhii × N (artists)
├── mhsd type 6 → empty mhlt (reserved)
├── mhsd type 10 → empty mhlt (reserved)
├── mhsd type 5 → mhlp → mhyp × N (smart playlists)
└── mhsd type 9 → genius CUID (optional)
```

### Key Format Characteristics

- **All little-endian** except: SLst smart playlist rules (big-endian), chapter atom lengths (big-endian)
- **Variable header sizes**: `header_len` field controls how many bytes the header contains. Unknown trailing bytes preserved as opaque buffers
- **32+ MHOD subtypes**: String types (1-31, 200-202, 300), podcast URLs (15-16, UTF-8 no length prefix), SPL (50-51), chapter data (17, M4A atoms), playlist index (52-53, 100)
- **Write order**: MHSD sections written as 1,3,2,4,8,6,10,5,9 (not sequential)
- **Track IDs**: Renumbered starting from 52 on every write
- **Non-atomic writes in libgpod**: We improve on this with temp file + rename

### Hash Algorithms

| Algorithm | Used By | Implementation | Key Material |
|-----------|---------|---------------|--------------|
| hash58 | Classic 1-3, Nano 3-4 | HMAC-SHA1 via `crypto.createHmac` | FireWire GUID → LCM + S-box tables → 64-byte key |
| hash72 | Nano 5, Touch 1-3, iPhone 1-3 | SHA-1 + AES-128-CBC via `crypto.createCipheriv` | HashInfo file (device IV + random bytes) |
| hashAB | Touch 4, iPhone 4, iPad 1, Nano 6 | External `libhashab` binary (proprietary) | Same approach as libgpod — load at runtime |

---

## 5. Testing Strategy

### Tiers

1. **Unit tests** — BufferReader/Writer, record parse/write, pixel formats, hash algorithms, SysInfo, model table, paths
2. **Golden fixture round-trip** — 10 fixture categories generated from libgpod-node, stored as static binaries
3. **Parity tests** — Side-by-side with libgpod-node (migration period only)
4. **Property-based** — fast-check fuzz testing for round-trip validation
5. **Integration** — Full lifecycle with test iPod environments (port all 11 existing suites)
6. **Hardware validation** — Real iPods (iPod Video 5th gen available, others per TASK-132)

### Database Integrity Checker

Validation function run after every write in tests: playlist references, artwork references, master playlist, unique track IDs.

### Hardware Validation Matrix

| Device | Available | Hash | Validates | Task |
|--------|-----------|------|-----------|------|
| iPod Video 5th gen | Yes | None | Basic DB, artwork, playlists | TASK-131 |
| iPod Classic (any gen) | **Needed** | hash58 | Checksum, sparse artwork | TASK-132 |
| iPod Nano 3rd/4th gen | **Needed** | hash58 | Hash on Nano family | TASK-132 |
| iPod Nano 5th gen | **Needed** | hash72 | AES hash, HashInfo | TASK-132 |

---

## 6. Sequence of Work

### Virtual iPod Read-Only Phase (m-17, subset of m-8 Phase 0-1 + new tasks)

| Phase | Tasks | Scope |
|-------|-------|-------|
| **0: Prep** | TASK-113 (fixtures), TASK-114 (skeleton) | Shared with m-8 |
| **1: Parser** | TASK-115 (BufferReader only), TASK-116 (record parsers) | Shared with m-8 |
| **1b: Device** | TASK-265 (SysInfo + model table, read-only subset) | m-17 only |
| **1c: Artwork** | TASK-264 (ArtworkDB parser + .ithmb extractor, read-only) | m-17 only |
| **1d: API** | TASK-266 (IpodReader facade) | m-17 only |

### M1: ipod-db Core — remaining work after m-17

| Phase | Tasks | Scope |
|-------|-------|-------|
| **2: Writer** | TASK-115 (BufferWriter), TASK-117 (record writers + round-trip), TASK-118 (hash58/72/AB) | Write valid iTunesDB |
| **3: Artwork write** | TASK-119 (ArtworkDB + .ithmb + pixel formats — write path) | Full artwork pipeline |
| **4: API** | TASK-120 (full SysInfo + write capabilities, extends TASK-265), TASK-121 (Database class, 24 methods) | Public API |
| **5: Validate** | TASK-122 (port tests + parity), TASK-123 (swap + E2E), TASK-131 (iPod 5th gen hardware) | Prove correctness |
| **6: Cleanup** | TASK-124 (remove ~17k lines native infra) | Zero C/C++ |

### M2: Extended API (3 tasks, TASK-125 through TASK-127)

| Phase | Task | Scope |
|-------|------|-------|
| **7** | TASK-125 | Smart playlist CRUD (8 methods, SLst big-endian parsing) |
| **8** | TASK-126 | Chapter/audiobook CRUD (4 methods, M4A atom parsing) |
| **9** | TASK-127 | 12 additional utility methods |

### M3: Photo Database (1 task, TASK-128)

| Phase | Task | Scope |
|-------|------|-------|
| **10** | TASK-128 | PhotoDatabase class (~15 methods) |

---

## 7. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Data corruption from format error | Medium | Critical | Golden fixtures, round-trip tests, hardware validation, integrity checker |
| hash58/72 edge cases | Low | High | Test on real hardware; algorithms well-documented in libgpod source |
| Image processing doesn't bundle in single binary | Medium | Medium | TASK-129 researches alternatives; FFmpeg fallback eliminates need for sharp |
| Classic 3rd gen requires SQLite | Medium | Medium | TASK-130 researches this; build everything else first, add SQLite if needed |
| Undocumented format quirks | Medium | Medium | Preserve all unknown bytes; pass through unchanged |
| Effort underestimation | Medium | Medium | Phased delivery; each phase independently valuable |

---

## 8. Improvements Over libgpod

| Improvement | Detail |
|-------------|--------|
| **Atomic writes** | Temp file + rename (libgpod writes in-place — crash = corruption) |
| **Preserve unknown MHODs** | libgpod drops unrecognized MHOD types during write |
| **Proper errors** | Byte offset + expected/actual + record path breadcrumb |
| **Immutable data model** | Frozen snapshots; explicit mutations |
| **Async I/O** | fs.promises (libgpod: synchronous) |
| **Zero-copy slicing** | buf.subarray() for unknown bytes |
| **Type-safe enums** | TS string literals (libgpod: integer constants) |
| **Streaming track copy** | Node.js streams (libgpod: sync copy) |
| **Deterministic write order** | Documented and tested |
| **Browser-compatible** | DataView-based reader runs in Web Workers (m-17) |

---

## 9. Task Index

### Virtual iPod Read-Only (m-17) — shared + new tasks
- TASK-113: Generate golden test fixtures (shared with m-8)
- TASK-114: Create package skeleton (shared with m-8)
- TASK-115: BufferReader primitives (shared with m-8; BufferWriter deferred)
- TASK-116: iTunesDB record parsers (shared with m-8)
- TASK-264: Read-only ArtworkDB parser + .ithmb extractor
- TASK-265: Read-only SysInfo parser + model table
- TASK-266: Read-only IpodReader facade for ipod-web

### M1 — ipod-db Core (libgpod replacement)
- TASK-112: Close PR #18 — doc-003 is canonical
- TASK-113: Generate golden test fixtures
- TASK-114: Create package skeleton
- TASK-115: BufferReader/BufferWriter primitives
- TASK-116: iTunesDB record parsers
- TASK-117: iTunesDB record writers + round-trip
- TASK-118: hash58, hash72, hashAB algorithms
- TASK-119: ArtworkDB + .ithmb + pixel formats
- TASK-120: SysInfo parser + model table
- TASK-121: Database class (24-method API)
- TASK-122: Port test suites + parity tests
- TASK-123: Swap podkit-core + E2E validation
- TASK-124: Remove native infrastructure
- TASK-129: Research sharp/image processing for single binary
- TASK-130: Research Classic 3rd gen SQLite requirement
- TASK-131: Hardware validation — iPod Video 5th gen
- TASK-132: Hardware validation matrix planning

### M2 — ipod-db Extended API
- TASK-125: Smart playlist CRUD (8 methods)
- TASK-126: Chapter/audiobook CRUD (4 methods)
- TASK-127: Extended utility methods (12 methods)

### M3 — ipod-db Photo Database
- TASK-128: Photo Database (~15 methods)
