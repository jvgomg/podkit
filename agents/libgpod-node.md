# libgpod-node: Native Bindings

Guidance for working on the libgpod N-API bindings. See [AGENTS.md](../AGENTS.md) for project overview.

The `@podkit/libgpod-node` package provides N-API bindings to libgpod. While it aims to closely follow libgpod's API, **some operations have enhanced behavior** to handle edge cases that libgpod doesn't address automatically.

## Documentation Requirement

**When modifying libgpod-node native code:**

1. **Document behavioral deviations** - If the binding behaves differently from raw libgpod, document it in:
   - `packages/libgpod-node/README.md` under "Behavioral Deviations from libgpod"
   - Inline comments in the native C++ code explaining the deviation

2. **Explain the "why"** - Include:
   - What libgpod does (or doesn't do)
   - What problems this causes (assertion failures, data corruption, etc.)
   - How our implementation differs
   - Why we can't just use libgpod's default behavior

3. **Add test coverage** - Create integration tests that verify the edge case is handled correctly

## Current Deviations

See `packages/libgpod-node/README.md` for the full list. Key deviations:

| Operation | libgpod Issue | Our Fix |
|-----------|---------------|---------|
| `removeTrack()` | Doesn't remove from playlists | Remove from all playlists first |
| `create()` | No master playlist | Create master playlist |
| `clearTrackChapters()` | NULL chapterdata crashes | Create empty chapterdata |
| `replaceTrackFile()` | `copyTrackToDevice()` no-ops if already transferred | Reset `transferred` flag, overwrite file in place |

## Custom libgpod Build (SysInfoExtended USB)

The prebuild CI applies a **custom patch** to libgpod that adds `itdb_read_sysinfo_extended_from_usb()` to the library. This function reads device identity XML from iPod firmware via USB vendor control transfers (libusb).

**Why a patch?** The upstream libgpod 0.8.3 tarball has the `HAVE_LIBUSB` conditional in `configure.ac` and `tools/Makefile.am`, but the actual `itdb_usb.c` source file was only compiled into a standalone binary (`ipod-read-sysinfo-extended`), never into the library itself. Our patch:
1. Copies `itdb_usb.c` into `src/` (the library)
2. Adds `HAVE_LIBUSB` conditional to `src/Makefile.am`
3. Adds the public declaration to `src/itdb.h`

**Build implications:**
- `build-static-deps.sh` builds libusb 1.0.27 as a static dependency
- `get-ldflags.sh` uses `-Wl,-force_load` (macOS) / `-Wl,--whole-archive` (Linux) for `libgpod.a` — this forces all object files into the binary, including `itdb_usb.o` which is only referenced via `dlsym` at runtime
- The N-API binding resolves the symbol at runtime via `dlsym(RTLD_DEFAULT, "itdb_read_sysinfo_extended_from_usb")` — if the symbol isn't present (e.g., system libgpod without the patch), the function gracefully returns null

**Files involved:**
- `tools/prebuild/patches/itdb_usb.c` — the C source
- `tools/prebuild/patches/apply-sysinfo-usb.sh` — applies the patch to a fresh libgpod source tree
- `tools/prebuild/build-static-deps.sh` — builds libusb + applies patch
- `packages/libgpod-node/native/gpod_binding.cc` — dlsym resolution

## Investigating New Issues

When encountering libgpod CRITICAL assertions or unexpected behavior:

1. **Reproduce with a test** - Create an integration test that triggers the issue
2. **Check libgpod source** - Look at `tools/libgpod-macos/build/libgpod-0.8.3/src/`
3. **Understand the expectation** - What does libgpod expect vs. what we're providing?
4. **Fix and document** - Apply the fix and document the deviation
