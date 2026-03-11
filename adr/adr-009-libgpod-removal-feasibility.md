---
title: "ADR-009: libgpod Removal Feasibility"
description: Analysis of replacing native libgpod C bindings with a pure TypeScript implementation.
sidebar:
  order: 10
---

# ADR-009: libgpod Removal Feasibility

## Status

**Research**

## Context

podkit currently depends on libgpod (a C library) via N-API native bindings (`@podkit/libgpod-node`) to read and write iPod databases. This creates several pain points:

- **Build complexity**: Requires C/C++ toolchain, GLib, pkg-config, and platform-specific build configuration
- **Distribution burden**: Prebuilt binaries must be generated per platform/architecture
- **Developer onboarding**: New contributors need libgpod-dev, GLib headers, and a working node-gyp setup
- **Maintenance**: The binding layer (~1500 lines of C++) bridges between GLib types and N-API, requiring expertise in both

The question: can all of this be replaced with pure TypeScript/Node.js?

## Analysis

### What libgpod does for us

| Capability | Complexity to reimplement | Notes |
|-----------|--------------------------|-------|
| Parse iTunesDB binary format | **Medium-High** | Well-documented but version-variant format |
| Write iTunesDB binary format | **High** | Must produce valid output for each iPod generation |
| Track metadata CRUD | **Medium** | Straightforward once parse/write works |
| Playlist management | **Medium** | Tree structure within the binary format |
| Smart playlists (rules, evaluation) | **Medium** | Rule engine with field/operator/value matching |
| File copying to F00-F49 dirs | **Low** | Simple hash-based distribution + random filenames |
| Artwork/thumbnail handling | **Medium-High** | Device-specific formats (RGB565, JPEG), multiple sizes |
| Device model detection | **Low** | SysInfo text file parsing + model lookup table |
| iPod initialization | **Low** | Directory creation + empty database + SysInfo |
| Database checksum (hash58) | **Medium** | Required for iPod Classic/Nano 3G+; uses FirewireGuid |
| Chapter data | **Low** | Simple timestamp + title list |
| GLib memory management | **N/A** | Eliminated entirely in pure TS |

### Can JavaScript do everything C can here?

**Yes, with caveats.** There is nothing in this problem domain that fundamentally requires native code. Specifically:

#### Things that are straightforward in TypeScript

- **Binary parsing/writing**: Node.js `Buffer` (or `DataView`/`TypedArray`) handles little-endian binary I/O natively. `Buffer.readUInt32LE()`, `Buffer.writeUInt16LE()`, etc. are direct equivalents to the C struct reading libgpod does.
- **File I/O**: `fs` module handles all file operations (copy, create directories, read/write binary files).
- **String encoding**: iTunesDB stores strings as UTF-16LE, which Node.js handles natively.
- **SysInfo parsing**: Plain text key-value file — trivial.
- **Model table**: Static lookup table — trivial.
- **File distribution hash**: Simple modulo operation for F00-F49 folder selection.
- **Random filename generation**: Trivial.
- **Smart playlist evaluation**: Pure logic — easier in TypeScript than C.
- **Playlist/track CRUD**: Data structure manipulation — easier in TS.

#### Things that require careful implementation

1. **iTunesDB binary format parsing**
   - The format uses nested "chunk" headers (mhbd → mhlt → mhit → mhod, etc.)
   - Each chunk has a 4-byte magic, size fields, and version-dependent layouts
   - Multiple format versions exist across iPod generations
   - The format is well-documented (iPodLinux wiki, Linux Journal articles, existing parsers in Python, Java, Rust, and C++)
   - **Verdict**: Medium-high effort but no technical barriers. `Buffer` APIs are sufficient.

2. **iTunesDB binary format writing**
   - Must produce byte-identical valid output for the target device
   - Different iPod generations expect different DB version numbers and fields
   - This is the highest-risk area — subtle bugs could corrupt databases
   - **Verdict**: High effort, high risk. Requires extensive testing against real devices.

3. **Database checksums (hash58)**
   - iPod Classic (6th gen+) and Nano 3G+ require a checksum in the database
   - The algorithm uses the device's FirewireGuid to generate the hash
   - The algorithm has been reverse-engineered and is implemented in libgpod's source
   - It uses SHA1 internally — available via Node.js `crypto` module
   - **Verdict**: Implementable. The algorithm is known and uses standard crypto primitives.

4. **HashAB (Nano 6G only)**
   - A separate signing scheme required by iPod Nano 6th generation
   - Implemented as a separate library (libhashab), not part of libgpod core
   - Uses device-specific 8-byte UUID
   - **Verdict**: Implementable if needed, but Nano 6G is a niche target.

5. **Artwork encoding**
   - iPod Video: RGB565 little-endian pixel format (5-6-5 bit packing)
   - iPod Classic: JPEG at specific dimensions
   - Image resizing needed for thumbnails
   - RGB565 conversion is simple bit manipulation: `((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)`
   - **Verdict**: RGB565 encoding is trivial math. Image resizing would need sharp or similar (already likely a dependency for other purposes). No native code required.

6. **Artwork database (.ithmb files)**
   - Concatenated raw image data with offsets tracked in the main DB
   - Device model determines which format IDs and dimensions to generate
   - **Verdict**: Simple binary concatenation once the image conversion is solved.

### What a C library can do that JS cannot

In the general case, C can do things like direct memory access, kernel syscalls, and hardware interrupts. **None of these are relevant here.** The iPod interaction is entirely through standard filesystem operations on a mounted FAT32 volume. There are:

- **No USB-level protocols** — the iPod appears as mass storage
- **No cryptographic hardware tokens** — checksums use standard SHA1
- **No kernel drivers** — just file read/write on a mounted volume
- **No performance-critical hot paths** — database operations happen once per sync, not in a loop
- **No real-time constraints** — sync is a batch operation

### Existing prior art

Multiple non-C implementations of iTunesDB parsers exist:

| Project | Language | Read | Write | Status |
|---------|----------|------|-------|--------|
| libitunesdb2 | C++ | Yes | Yes | Active, supports latest format |
| repear (iTunesDB.py) | Python | Yes | Yes | Working parser/writer |
| iTunesDB-Parser | Rust | Yes | No | Read-only |
| hachoir | Python | Yes | No | Read-only parser |
| iTunesDBParser | Java | Yes | No | Read-only |

The Python implementation (repear) is particularly interesting as it demonstrates that a high-level language can successfully read and write iTunesDB files.

### Risks

1. **Database corruption**: A bug in the binary writer could brick an iPod's music database. libgpod has 20+ years of bug fixes. Mitigation: extensive integration tests against real devices, byte-comparison against known-good databases.

2. **Format coverage**: We may miss edge cases for specific iPod models we don't own. Mitigation: focus on the models we actively support (Video 5/5.5G, Classic 6/7G).

3. **Artwork regression**: Getting artwork encoding pixel-perfect is fiddly. Mitigation: automated visual regression tests, test fixtures from real iPods.

4. **hash58 correctness**: If the checksum is wrong, iPod Classic will reject the database entirely. Mitigation: test against real Classic hardware, compare checksums with libgpod output.

### Benefits of removal

- **Zero native dependencies** — pure npm install, no C++ toolchain needed
- **Simplified CI/CD** — no prebuildify, no platform-specific build matrix
- **Easier contribution** — TypeScript-only codebase
- **Better error messages** — no opaque GLib assertion failures
- **Full control** — no working around libgpod bugs (the 4 documented behavioral deviations become unnecessary)
- **Smaller binary** — no statically linked C library
- **Bun compatibility** — no node-gyp/N-API compatibility concerns

### Effort estimate

| Component | Rough size | Priority |
|-----------|-----------|----------|
| iTunesDB parser (read) | ~800-1200 lines | P0 |
| iTunesDB writer | ~600-1000 lines | P0 |
| Track/playlist data model | ~300-500 lines | P0 |
| File copy + path management | ~100-200 lines | P0 |
| SysInfo + model detection | ~100-200 lines | P0 |
| Artwork encoding (RGB565 + JPEG) | ~200-400 lines | P1 |
| Artwork database (.ithmb) | ~200-300 lines | P1 |
| hash58 checksum | ~100-200 lines | P1 (Classic only) |
| Smart playlist engine | ~200-400 lines | P2 |
| Chapter data | ~50-100 lines | P2 |
| Test suite (unit + integration) | ~1000-2000 lines | P0 |

Total: roughly 3,000-6,500 lines of TypeScript + tests.

## Recommendation

**Feasible, recommend proceeding with a phased approach.**

The removal is technically feasible — there is nothing in the problem domain that requires native code. The iTunesDB format is well-documented, multiple reference implementations exist in high-level languages, and all binary operations map cleanly to Node.js Buffer APIs.

### Suggested phases

1. **Phase 1 — Read-only parser**: Build a TypeScript iTunesDB parser and validate it produces identical data to libgpod when reading databases from real iPods.

2. **Phase 2 — Writer for iPod Video**: Implement database writing targeting iPod Video 5/5.5G (no checksum required). Validate with real hardware.

3. **Phase 3 — Artwork**: Implement artwork encoding and .ithmb writing. Test with real devices.

4. **Phase 4 — iPod Classic support**: Implement hash58 checksum for Classic compatibility.

5. **Phase 5 — Migration**: Swap `@podkit/libgpod-node` for the new pure-TS package. Run full E2E test suite.

Each phase can be validated independently, and the project can fall back to libgpod bindings if any phase reveals unexpected blockers.

## References

- [iPodLinux iTunesDB Specification](https://web.archive.org/web/20110514113255/http://ipl.derpapst.org/wiki/ITunesDB)
- [Linux Journal: Learning the iTunesDB File Format](https://www.linuxjournal.com/article/6334)
- [libgpod source (GitHub)](https://github.com/libgpod/libgpod)
- [libitunesdb2 — C++ parser supporting latest format](https://github.com/MCJack123/libitunesdb2)
- [repear — Python iTunesDB parser/writer](https://github.com/worstje/repear)
- [iTunesDB-Parser — Rust parser](https://github.com/raleighlittles/iTunesDB-Parser)
- [libhashab — HashAB for Nano 6G](https://github.com/neheb/libhashab)
- [libgpod README.overview — hash58/hash72 documentation](https://github.com/neuschaefer/libgpod/blob/master/README.overview)
