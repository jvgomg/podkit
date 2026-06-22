---
title: Building from Source
description: Build podkit's native bindings from source when prebuilt binaries are not available.
sidebar:
  order: 3
---

podkit ships as a standalone binary for macOS (Intel and Apple Silicon) and Linux (x64) — install it via [Homebrew or direct download](/getting-started/installation). The CLI is **not** distributed on npm.

This page is for building podkit from source on a platform without a prebuilt binary, which compiles the native **libgpod** bindings and then produces the standalone CLI binary with `bun run compile`. It requires **libgpod** development headers.

## macOS

libgpod is not available in Homebrew, so it must be built from source. The podkit repo includes a build script:

```bash
git clone https://github.com/jvgomg/podkit.git
cd podkit/tools/libgpod-macos
./build.sh
```

This will:
1. Install Homebrew dependencies (libplist, gdk-pixbuf, autoconf, etc.)
2. Download libgpod 0.8.3 source and required patches
3. Build and install to `~/.local`

Add to your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
export PKG_CONFIG_PATH="$HOME/.local/lib/pkgconfig:$PKG_CONFIG_PATH"
export DYLD_LIBRARY_PATH="$HOME/.local/lib:$DYLD_LIBRARY_PATH"
```

Reload your shell, then install podkit:

```bash
source ~/.zshrc  # or ~/.bashrc
bun install
bun run compile   # builds the standalone podkit binary; copy it onto your PATH
```

## Ubuntu / Debian

```bash
sudo apt install -y libgpod-dev
bun install
bun run compile   # builds the standalone podkit binary; copy it onto your PATH
```

## Fedora

```bash
sudo dnf install -y libgpod-devel
bun install
bun run compile   # builds the standalone podkit binary; copy it onto your PATH
```

## Arch Linux

```bash
sudo pacman -S libgpod
bun install
bun run compile   # builds the standalone podkit binary; copy it onto your PATH
```

## Verifying the Build

```bash
podkit --version
podkit device info  # Should not show native binding errors
```

## Troubleshooting

### libgpod build fails (macOS)

Ensure Homebrew packages are properly linked:

```bash
brew link --force libplist gdk-pixbuf gettext
```

### pkg-config can't find libgpod

Verify your `PKG_CONFIG_PATH` includes `~/.local/lib/pkgconfig`:

```bash
echo $PKG_CONFIG_PATH
pkg-config --modversion libgpod-1.0
# Expected: 0.8.3
```

### Runtime: library not found

Ensure `DYLD_LIBRARY_PATH` is set:

```bash
echo $DYLD_LIBRARY_PATH
# Should include: /Users/yourname/.local/lib
```

## See Also

- [Installation](/getting-started/installation) - Standard installation
- [Development Setup](/developers/development) - Full development environment setup
