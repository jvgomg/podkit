# libgpod macOS Build Tools

This directory contains scripts to build libgpod from source on macOS using Homebrew dependencies.

## Background

libgpod is a library for accessing iPod contents. It's not available in Homebrew, so we build it from source.

- **Version:** 0.8.3 (last release: 2013)
- **Source:** https://sourceforge.net/projects/gtkpod/files/libgpod/
- **Status:** Unmaintained but functional for classic iPods

## Quick Start

```bash
# Install dependencies and build libgpod (one command)
./build.sh

# Or step by step:
./build.sh deps      # Install Homebrew dependencies only
./build.sh download  # Download source and patches
./build.sh build     # Configure and build
./build.sh install   # Install to ~/.local
./build.sh verify    # Verify installation
```

After installation, add to your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
export PKG_CONFIG_PATH="$HOME/.local/lib/pkgconfig:$PKG_CONFIG_PATH"
export DYLD_LIBRARY_PATH="$HOME/.local/lib:$DYLD_LIBRARY_PATH"
```

## What Gets Installed

By default, libgpod installs to `~/.local` (no sudo required):

```
~/.local/
├── lib/
│   ├── libgpod.dylib      # Shared library
│   ├── libgpod.a          # Static library
│   └── pkgconfig/
│       └── libgpod-1.0.pc # pkg-config file
├── include/
│   └── gpod-1.0/          # Header files
└── bin/
    └── ipod-read-sysinfo-extended  # Utility tool
```

To install to a different location:
```bash
PREFIX=/opt/libgpod ./build.sh
```

## Dependencies

The build script installs these Homebrew packages:

| Package | Purpose |
|---------|---------|
| `libplist` | Apple property list library (required for newer iPods) |
| `gdk-pixbuf` | Image loading library (for album art) |
| `intltool` | Internationalization tools |
| `autoconf` / `automake` / `libtool` | Build system |
| `gtk-doc` | Documentation generator |
| `pkg-config` | Build configuration |
| `gettext` | Localization |

## Patches Applied

Two patches are required for modern systems:

1. **`patch-tools-generic-callout.c.diff`** (from MacPorts)
   - Fixes compilation on macOS

2. **`libgpod-libplist.patch`** (from PLD Linux)
   - Updates API calls for libplist 2.x compatibility
   - Changes `plist_dict_insert_item` → `plist_dict_set_item`

## Verification

After installation:

```bash
# Check version
pkg-config --modversion libgpod-1.0
# Expected: 0.8.3

# Check compiler flags
pkg-config --cflags --libs libgpod-1.0

# Check library
file ~/.local/lib/libgpod.4.dylib
# Expected: Mach-O 64-bit dynamically linked shared library arm64
```

## Troubleshooting

### pkg-config can't find libgpod

Ensure your shell profile has:
```bash
export PKG_CONFIG_PATH="$HOME/.local/lib/pkgconfig:$PKG_CONFIG_PATH"
```

Then reload: `source ~/.zshrc` (or `~/.bashrc`)

### Build fails with missing headers

Ensure Homebrew packages are linked:
```bash
brew link --force libplist gdk-pixbuf gettext
```

### Runtime: library not found

Ensure your shell profile has:
```bash
export DYLD_LIBRARY_PATH="$HOME/.local/lib:$DYLD_LIBRARY_PATH"
```

## Clean Up

```bash
./build.sh clean      # Remove build artifacts (keeps downloads)
./build.sh distclean  # Remove everything including downloads
```

## Directory Structure

```
tools/libgpod-macos/
├── README.md          # This file
├── build.sh           # Build script
├── downloads/         # Downloaded source and patches (gitignored)
└── build/             # Build directory (gitignored)
```
