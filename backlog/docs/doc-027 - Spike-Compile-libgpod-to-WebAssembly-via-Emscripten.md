---
id: doc-027
title: 'Spike: Compile libgpod to WebAssembly via Emscripten'
type: other
created_date: '2026-04-03 15:16'
updated_date: '2026-04-03 15:24'
---
# Spike: Compile libgpod to WebAssembly via Emscripten

## Goal

Determine whether libgpod 0.8.3 and its dependencies can be compiled to WebAssembly using Emscripten, producing a `.wasm` module that can parse and query an iTunesDB in a browser context. This is the critical-path feasibility question for the Virtual iPod project.

## Context

We are building a virtual iPod that runs as a pure web application. The iPod's firmware layer needs to read real iTunesDB binary databases — the same format used by physical iPods. Rather than writing a pure-TS parser, we want to compile the existing libgpod C library to WASM so we get proven, complete database support for free.

**Read-only is sufficient for this phase.** We need to parse iTunesDB, query tracks/playlists/artwork metadata. We do NOT need write support, file copying, or artwork thumbnail generation (gdk-pixbuf). Artwork metadata reading (dimensions, offsets, IDs) is needed but not image decoding.

## Dependency Chain to Compile

```
libgpod-0.8.3
├── glib-2.0 (>= 2.16)        — Core types, GList, GError, file I/O wrappers
├── gobject-2.0                — GObject type system (used by libgpod device info)
├── sqlite3                    — For newer iPod models (Nano 5G+, iTunesCDB)
├── libplist-2.0 (>= 2.3)     — Apple property list parsing (SysInfoExtended)
├── zlib                       — Compressed iTunesCDB support
├── libxml2 (optional)         — SysInfoExtended XML parsing
└── gdk-pixbuf (optional)      — EXCLUDE: only needed for artwork image encoding
```

## Build Configuration for WASM

Disable everything we don't need:
```
--disable-udev
--disable-pygobject
--with-python=no
--without-hal
--disable-gtk-doc
--without-libimobiledevice
```

Additionally disable gdk-pixbuf (not needed for read-only artwork metadata).

## Known Risks & Questions to Answer

### 1. GLib WASM compilation
- GLib is the largest dependency. It has been compiled to WASM by others but it's not trivial.
- Concerns: `g_module_open()` (dynamic loading), iconv (character encoding), GObject type registration
- **Question:** Can we compile glib-2.0 + gobject-2.0 with Emscripten? What stubs/patches are needed?

### 2. Dynamic module loading (hashAB)
- `itdb_hashAB.c` uses `g_module_open()` to dynamically load a hash module
- WASM cannot do dynamic loading
- **Question:** Can we statically link the hash module, or stub it out for read-only use?

### 3. Emscripten virtual filesystem
- libgpod uses POSIX file I/O (`fopen`, `open`, `g_file_get_contents`, etc.)
- Emscripten intercepts these via its virtual filesystem (MEMFS)
- **Question:** Does libgpod's file I/O pattern work cleanly with MEMFS? Any edge cases with `stat`, `readdir`, symlinks?

### 4. SQLite in WASM
- sql.js proves SQLite compiles to WASM. Can we use Emscripten's built-in SQLite port, or do we need to link sql.js?
- **Question:** How does libgpod link against SQLite — dynamic or static? Can we provide it at WASM link time?

### 5. libplist in WASM
- Pure C library, should be straightforward
- **Question:** Any POSIX-specific code that needs stubs?

### 6. Binary size
- **Question:** What is the total WASM binary size (libgpod + glib + sqlite + plist + zlib)?
- Target: under 5MB ideally, under 10MB acceptable

### 7. Binding surface
- The N-API layer in libgpod-node calls ~45 libgpod C functions
- For read-only we need a subset (~15-20 functions): parse, get tracks, get playlists, query device info, read artwork metadata
- **Question:** Can we expose these via Emscripten `cwrap`/`ccall` or `embind`?

## Spike Tasks

1. **Set up Emscripten toolchain** — Install emsdk, verify it works
2. **Compile zlib** — Trivial, validates the toolchain
3. **Compile SQLite** — Use emscripten-ports or compile from source
4. **Compile libplist** — Cross-compile with Emscripten
5. **Compile GLib** — The hard one. Use Meson cross-compile with Emscripten. Identify required stubs/patches.
6. **Compile libgpod** — With all deps available, attempt the build. Document every patch needed.
7. **Minimal binding test** — Write a small C program that calls `itdb_parse()` on a test iTunesDB, compile it to WASM, run it in Node.js with Emscripten's MEMFS populated with a real iTunesDB file.
8. **Document findings** — Update this document with results, binary sizes, patches needed, and go/no-go recommendation.

## Existing Infrastructure

- libgpod source: downloaded by `tools/libgpod-macos/build.sh` from SourceForge
- libgpod patches: downloaded at build time (macOS callout patch + libplist-2.0 API patch)
- Test iTunesDB files: can be generated with `gpod-tool` from `tools/gpod-tool/`
- libgpod-node N-API bindings: `packages/libgpod-node/native/` (~3,840 lines, 8 files)

## Success Criteria

- [ ] libgpod.wasm compiles without errors
- [ ] Can call `itdb_parse()` from JavaScript and get a valid database handle
- [ ] Can enumerate tracks from a parsed database
- [ ] WASM binary size documented
- [ ] All required patches/stubs documented
- [ ] Go/no-go recommendation with rationale

## Findings

### Overall Assessment: GO WITH CAVEATS — but a pure-TypeScript parser is the better path

After extensive research, compiling libgpod to WASM is **technically feasible but inadvisable**. The dependency chain is deep, the maintenance burden is high, and a pure-TypeScript iTunesDB parser would be simpler, smaller, and more maintainable for read-only use. Details follow.

---

### 1. Dependency-by-Dependency Feasibility

#### zlib — TRIVIAL (No risk)
- Official Emscripten port exists at `emscripten-ports/zlib`. Just pass `-s USE_ZLIB=1` to emcc.
- Zero patches needed. This is a solved problem.

#### SQLite — TRIVIAL (No risk)
- Multiple proven WASM ports exist: sql.js (~1.5 MB WASM), the official sqlite3 WASM/JS project (~900 KB), wa-sqlite.
- SQLite's official project explicitly supports Emscripten with transparent POSIX file I/O emulation.
- Can compile from source or use existing WASM builds. No patches needed.

#### libxml2 — EASY (Low risk)
- Multiple successful WASM ports exist: xmllint-wasm, wasm-libxml2, libxml2-wasm, libxml.wasm.
- Standard `emconfigure ./configure && emmake make` workflow works.
- HTTP/FTP features can be disabled to reduce size. No significant patches needed.
- However, libxml2 may be optional for our use case (only used for SysInfoExtended XML parsing). Could be stubbed out entirely for read-only mode.

#### libplist — MODERATE (Low-medium risk)
- No known WASM port exists. No one has publicly documented compiling libplist to WASM.
- It is a pure C library with minimal dependencies (just libxml2 optionally), so it should be straightforward.
- Uses autotools, which Emscripten supports via `emconfigure`/`emmake`.
- Risk: untested territory, but the library is simple enough that unexpected issues are unlikely.
- For read-only use, libplist is only needed to parse SysInfoExtended plist files on the device. Could potentially be stubbed if we hardcode device info.

#### GLib + GObject — HARD (High risk, the critical bottleneck)
- **Has been done, but it is fragile and high-maintenance.**
- Prior art:
  - **RamiHg/glib-emscripten**: Fork of GLib 2.75.0 for Emscripten. Explicitly warns "do not use in production." Last meaningful activity: December 2022. Requires PCRE2, zlib, and libffi as sub-dependencies.
  - **kleisauke/wasm-vips**: Successfully compiles GLib 2.88.0 to WASM as part of libvips. This is the most actively maintained approach. Uses a custom Meson cross-file and a patch specific to their fork. Disables: introspection, SELinux, xattr, libmount, sysprof, NLS, assertions/checks.
  - **fluendo/gst.wasm**: Compiles GLib for GStreamer-in-the-browser. Uses Cerbero build system with custom patches.
  - **VitoVan/pango-cairo-wasm**: Compiles GLib + Cairo + Pango. Reports 1.5-3.5 MB total transfer for the full stack.
  - **GNOME Discourse thread** (discourse.gnome.org/t/wasm-support-in-glib/26752): Active discussion about adding official WASM support to GLib, but no official support exists yet.
- **Sub-dependency: libffi** — Required by GObject's type system. Compiling libffi for WASM is a known pain point. The wasm-vips project has solved this but it requires tracking their patches.
- **Sub-dependency: PCRE2** — Needed by GLib's regex support. Must also be cross-compiled.
- Key issues:
  - GLib uses Meson (not autotools), requiring a custom Emscripten cross-file
  - Must disable many subsystems that assume POSIX features unavailable in WASM
  - `g_module_open()` (dynamic module loading) will fail at runtime — must be stubbed or avoided
  - GObject type registration uses function pointers in ways that have caused issues with Emscripten's function pointer emulation
  - No official WASM support from GNOME; all ports are community forks that can fall behind

#### libgpod itself — MODERATE-HARD (Medium risk, conditional on GLib)
- Uses autotools (`configure`/`make`), which Emscripten supports via `emconfigure`/`emmake`.
- 25 source files in `src/`, ~17 headers. Not a huge codebase.
- **hashAB/hash58/hash72**: These hash modules use `g_module_open()` for dynamic loading. For read-only parsing, these are NOT needed — they are only used when writing databases. Can be stubbed to return "unsupported."
- libgpod 0.8.3 is from 2014 and uses autoconf. The autotools + Emscripten integration is well-documented and generally works.
- Will need patches for:
  - Stubbing out `g_module_open()` calls in hash modules
  - Disabling udev/HAL/libimobiledevice (configure flags handle this)
  - Possibly adjusting file path handling for MEMFS compatibility

---

### 2. Technical Risk Analysis

#### Risk 1: GLib maintenance burden (SEVERITY: HIGH)
GLib has no official WASM support. Every approach relies on community forks that apply patches on top of GLib releases. These patches break when GLib updates. The wasm-vips project is the most actively maintained, but it patches GLib for image processing needs, not general-purpose use. We would need to either track their patches or maintain our own fork.

#### Risk 2: libffi for WASM (SEVERITY: MEDIUM-HIGH)
GObject requires libffi for its type system. libffi is architecture-specific by nature (it generates machine code for calling conventions). The WASM port exists but is fragile. If libffi breaks, GObject breaks, and everything above it breaks.

#### Risk 3: Binary size (SEVERITY: MEDIUM)
Estimated total WASM binary size:
- GLib + GObject + libffi: ~1.5-2.5 MB (based on pango-cairo-wasm reporting 1.5-3.5 MB for GLib+Cairo+Pango combined)
- SQLite: ~0.9-1.5 MB
- libplist: ~0.1-0.2 MB
- zlib: ~0.1 MB
- libxml2: ~0.3-0.5 MB (if included)
- libgpod: ~0.2-0.4 MB
- **Estimated total: 3-5 MB uncompressed WASM, ~1.5-2.5 MB gzipped**

This is within the acceptable range (under 5 MB target, under 10 MB acceptable) but is large for what amounts to a database parser. A pure-TypeScript parser would add 0 MB of WASM overhead.

#### Risk 4: MEMFS limitations (SEVERITY: LOW)
MEMFS stores all files in memory. iTunesDB files are typically 1-50 MB. The 2 GB limit is not a concern. Performance should be fine for read-only parsing. No issues expected here.

#### Risk 5: Autotools + Emscripten for libgpod (SEVERITY: LOW)
`emconfigure ./configure && emmake make` is a well-documented workflow. libgpod's configure script supports disabling most optional features. This is unlikely to cause major issues.

#### Risk 6: Ongoing WASM build maintenance (SEVERITY: HIGH)
We would need to maintain a WASM build pipeline for: GLib, libffi, PCRE2, SQLite, libplist, libxml2, zlib, and libgpod. That is 8 C libraries, each with their own build systems and potential Emscripten incompatibilities. Any update to any of them could break the build.

---

### 3. Alternative Approaches

#### Alternative A: Pure TypeScript iTunesDB Parser (RECOMMENDED)

**Feasibility: HIGH.** The iTunesDB binary format is well-documented and not excessively complex.

**Format overview:**
- Hierarchical tree structure flattened into sequential binary chunks
- ~12 record types: mhbd (database), mhsd (dataset), mhlt (track list), mhit (track item), mhlp (playlist list), mhyp (playlist), mhip (playlist item), mhla (album list), mhia (album item), mhod (data/string object)
- Each chunk has a consistent header: 4-byte type ID, 4-byte header size, 4-byte total size
- Little-endian integers throughout
- Strings in mhod containers (UTF-8 or UTF-16)
- Variable-length headers that grew across iTunes versions (0x9c to 0x1b4 bytes for track items)

**Existing implementations that prove this is tractable:**
- A Ruby script ("ipod2json" by drench) parses iTunesDB to JSON in a single file
- Rust parsers exist (raleighlittles/iTunesDB-Parser, iPodControl/itunes-db-parser) that handle the format
- libitunesdb2 (C++, MCJack123) parses the format with no GLib dependency
- iTunesDBParser (Java) provides a full object-oriented parser
- The iPod Linux wiki documents the format thoroughly at ipodlinux.org/ITunesDB

**Advantages over WASM approach:**
- Zero binary overhead (no WASM download)
- No C dependency chain to maintain
- TypeScript-native: works in any JS environment (browser, Node, Deno, Bun)
- Easier to debug, test, and extend
- Can share types directly with the rest of the podkit codebase
- Modern tooling: TypeScript's DataView API handles binary parsing natively
- Libraries like `binary-parser` or `@binary-files/structjs` can help with declarative struct definitions
- Read-only parsing is the simplest possible use case for this format

**Disadvantages:**
- Must implement the parser ourselves (estimated 1,500-3,000 lines of TypeScript)
- May miss edge cases that libgpod handles (version-specific quirks, undocumented fields)
- Would not handle iTunesCDB (SQLite-based format for newer iPods) without also including sql.js
- Artwork database parsing (ArtworkDB / ithmb files) adds additional format complexity

**Effort estimate:** 2-4 weeks for a read-only parser covering tracks, playlists, artwork metadata, and device info. The format is well-documented enough that a competent implementation is achievable.

#### Alternative B: Server-side libgpod-node + JSON API

Run libgpod-node on a backend (the existing Node.js bindings), expose a REST/WebSocket API, and have the browser consume JSON.

**Advantages:** Zero new code for parsing; reuses existing battle-tested bindings.
**Disadvantages:** Requires a server; not a pure web app; adds latency; defeats the purpose of a self-contained virtual iPod.

This is a viable fallback if the virtual iPod needs to work with real connected iPods, but does not satisfy the goal of a pure browser experience.

#### Alternative C: Compile only the parser core, stub everything else

A middle ground: take just `itdb_itunesdb.c` and its direct dependencies from libgpod, replace GLib types (GList, GError, gchar, etc.) with minimal C stubs, and compile that narrow slice to WASM.

**Advantages:** Much smaller binary; avoids the GLib dependency entirely.
**Disadvantages:** Essentially writing a new parser anyway, but in C with manual GLib stub maintenance. Worse developer experience than TypeScript. The libgpod source files are deeply intertwined with GLib types — extracting them cleanly is non-trivial.

Not recommended. If we are going to write custom code, TypeScript is the better language for this project.

---

### 4. Recommendation

**Do not compile libgpod to WASM. Write a pure TypeScript iTunesDB parser instead.**

Rationale:
1. **GLib is the dealbreaker.** It has no official WASM support. Every existing port is a fragile community fork. The maintenance burden of tracking GLib + libffi + PCRE2 patches for WASM is disproportionate to the value gained.
2. **The format is documented and tractable.** Multiple independent implementations (Ruby, Rust, C++, Java) prove that parsing iTunesDB without libgpod is feasible. The format is a straightforward hierarchical binary structure.
3. **Read-only dramatically simplifies scope.** We do not need write support, hash generation, or device communication. The read path is the simplest part of the iTunesDB format.
4. **TypeScript is the natural choice for a browser app.** Zero WASM overhead, native integration with the rest of the codebase, modern tooling, easier debugging.
5. **Binary size matters for a web app.** 3-5 MB of WASM for a database parser is excessive when TypeScript can do it in 0 MB of additional download.

**Caveats and open questions for the TypeScript approach:**
- **iTunesCDB (SQLite format):** Newer iPods (Nano 5G+) use an SQLite-based database alongside or instead of iTunesDB. If we need to support these, we would need sql.js (~900 KB-1.5 MB WASM). This is a well-solved problem and acceptable.
- **ArtworkDB parsing:** The artwork database (ArtworkDB file + ithmb thumbnail files) is a separate binary format. It follows similar mhXX-style headers and is documented, but adds implementation scope.
- **Undocumented fields:** libgpod handles many undocumented/version-specific quirks accumulated over 15+ years. A new parser will initially miss some of these. For a virtual iPod display use case, this is acceptable — we need artist/title/album/duration, not every obscure metadata field.
- **Testing:** We can validate the TypeScript parser against libgpod-node's output on the same iTunesDB files, giving us a built-in correctness oracle.

### 5. Suggested Next Steps

1. Create a task for building a pure TypeScript iTunesDB parser package
2. Use the iPod Linux wiki format specification as the primary reference
3. Start with mhbd/mhsd/mhlt/mhit/mhod (database + tracks + string data) — this covers the core use case
4. Add mhlp/mhyp/mhip (playlists) as a second phase
5. Add ArtworkDB parsing as a third phase
6. Validate against real iTunesDB files generated by gpod-tool and dumped from physical iPods
7. If iTunesCDB support is needed, integrate sql.js as a separate concern
