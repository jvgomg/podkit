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

## Scope: Database Operations Only (post-P2)

As of P2 (m-18 device-capability architecture), `@podkit/libgpod-node` is database-only. It handles reading and writing the iTunesDB via libgpod — nothing else.

USB firmware inquiry (`itdb_read_sysinfo_extended_from_usb`, the dlsym shim, the libusb build dependency) was removed in TASK-293.04. That capability now lives entirely in `@podkit/ipod-firmware`, which uses the `usb` npm package (which bundles its own prebuilt libusb). The native binding no longer requires libusb at build or runtime — no `HAVE_LIBUSB` patch, no `libusb-1.0-0-dev` system header.

If you encounter any remaining libusb references in `packages/libgpod-node/native/` or `binding.gyp`, they are bugs introduced after P2 and should be removed.

## Investigating New Issues

When encountering libgpod CRITICAL assertions or unexpected behavior:

1. **Reproduce with a test** - Create an integration test that triggers the issue
2. **Check libgpod source** - Look at `tools/libgpod-macos/build/libgpod-0.8.3/src/` (the `build/` subdirectory is produced by the build script in `tools/libgpod-macos/` — on a fresh checkout, run that script first)
3. **Understand the expectation** - What does libgpod expect vs. what we're providing?
4. **Fix and document** - Apply the fix and document the deviation
