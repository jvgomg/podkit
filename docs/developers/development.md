---
title: Development Setup
description: Set up a development environment for contributing to podkit.
sidebar:
  order: 2
---

This guide covers setting up a development environment for podkit on macOS, Linux, and Windows.

## Overview

podkit requires the following dependencies for development:

| Dependency | Purpose | Required |
|------------|---------|----------|
| **Bun** | JavaScript runtime and package manager | Yes |
| **libgpod** | C library for iPod database access | Yes (dev only — prebuilt binaries ship with releases) |
| **FFmpeg** | Audio transcoding (FLAC to AAC) | Yes |
| **GLib 2.0** | C utility library (libgpod dependency) | Yes (dev only) |
| **libplist** | Apple property list library (libgpod dependency) | Yes (dev only) |
| **gdk-pixbuf** | Image handling for album artwork | Yes (dev only) |

:::note
End users do **not** need libgpod, GLib, or other native libraries installed. Released versions of podkit ship prebuilt native binaries with all native dependencies statically linked. These development dependencies are only needed when modifying native code or building from a git checkout.
:::

### Version Requirements

| Dependency | Minimum Version | Notes |
|------------|-----------------|-------|
| Bun | 1.0+ | For development; distributes as Node.js |
| libgpod | 0.8.3 | Last release (2013), still functional |
| FFmpeg | 4.0+ | Needs AAC encoder support |
| GLib | 2.16+ | Required by libgpod |
| libplist | 2.3+ | Required for newer iPod support |

## macOS

### Prerequisites

Install [Homebrew](https://brew.sh) if not already installed:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### Step 1: Install Bun

```bash
brew install oven-sh/bun/bun
```

Or via the official installer:

```bash
curl -fsSL https://bun.sh/install | bash
```

### Step 2: Install FFmpeg

```bash
brew install ffmpeg
```

Verify AAC encoder support:

```bash
ffmpeg -encoders 2>/dev/null | grep aac
# Should show: aac (native) and aac_at (AudioToolbox)
```

### Step 3: Build and Install libgpod

libgpod is not available in Homebrew, so we build from source. The podkit repo includes a build script:

```bash
cd tools/libgpod-macos
./build.sh
```

This will:
1. Install Homebrew dependencies (libplist, gdk-pixbuf, autoconf, etc.)
2. Download libgpod 0.8.3 source and required patches
3. Build and install to `~/.local`

### Step 4: Configure Environment

Add to your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
# libgpod (built from source)
export PKG_CONFIG_PATH="$HOME/.local/lib/pkgconfig:$PKG_CONFIG_PATH"
export DYLD_LIBRARY_PATH="$HOME/.local/lib:$DYLD_LIBRARY_PATH"
```

Reload your shell:

```bash
source ~/.zshrc  # or ~/.bashrc
```

### Step 5: Verify Installation

```bash
# Check Bun
bun --version

# Check FFmpeg
ffmpeg -version | head -1

# Check libgpod
pkg-config --modversion libgpod-1.0
# Expected: 0.8.3
```

## Linux

### Debian / Ubuntu

```bash
# Install system dependencies
sudo apt update
sudo apt install -y \
    libgpod-dev \
    ffmpeg \
    libglib2.0-dev \
    libplist-dev \
    libgdk-pixbuf2.0-dev \
    pkg-config

# Install Bun
curl -fsSL https://bun.sh/install | bash

# Verify
bun --version
ffmpeg -encoders 2>/dev/null | grep aac
pkg-config --modversion libgpod-1.0
```

### Fedora / RHEL

```bash
# Install system dependencies
sudo dnf install -y \
    libgpod-devel \
    ffmpeg \
    glib2-devel \
    libplist-devel \
    gdk-pixbuf2-devel \
    pkg-config

# FFmpeg may require RPM Fusion
sudo dnf install -y \
    https://download1.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm
sudo dnf install -y ffmpeg

# Install Bun
curl -fsSL https://bun.sh/install | bash
```

### Arch Linux

```bash
sudo pacman -S libgpod ffmpeg glib2 libplist gdk-pixbuf2 pkg-config
curl -fsSL https://bun.sh/install | bash
```

## Getting the Code

```bash
git clone https://github.com/jvgomg/podkit.git
cd podkit
bun install
```

## Building

```bash
# Build all packages
bun run build

# Build native bindings
cd packages/libgpod-node
bun run build

# Build gpod-tool (C helper)
mise run tools:build
mise trust  # First time only
```

## Building a Standalone Binary

You can compile podkit into a single standalone executable using Bun. The binary embeds the JavaScript bundle and native libgpod addon — no runtime dependencies are needed (other than FFmpeg).

```bash
# Build dependencies and compile the CLI binary
bun run compile
```

This builds all required packages (including native bindings) and produces `packages/podkit-cli/bin/podkit`, a self-contained binary for your current platform and architecture. You can copy it anywhere:

```bash
cp packages/podkit-cli/bin/podkit /usr/local/bin/podkit
podkit --version
```

:::note
FFmpeg is still required at runtime for transcoding.
:::

## Installing a Dev Binary

You can build and install a `podkit-dev` binary for testing features that need a real binary on PATH (e.g. shell completions):

```bash
bun run --filter podkit install:dev
```

This compiles the CLI from the current source tree using `bun build --compile` and installs it to `~/.local/bin/podkit-dev`. To rebuild after making changes, run the same command again.

To set up shell completions for the dev binary, add to your `~/.zshrc`:

```bash
source <(podkit-dev completions zsh --cmd podkit-dev)
```

This gives you full tab completion including dynamic values (device names, collection names from your config). The `--cmd podkit-dev` flag gives the dev binary its own completion namespace so it doesn't conflict with a production `podkit` install.

To remove the dev binary:

```bash
bun run --filter podkit install:dev -- --clean
```

## Running Tests

```bash
# Run all tests
bun run test

# Run unit tests only
bun run test:unit

# Run integration tests
bun run test:integration

# Run E2E tests (dummy iPod)
bun run test:e2e

# Run tests for specific package
bun test packages/podkit-core
```

See [Testing](/developers/testing) for the full testing guide.

## Development Commands

```bash
# Run CLI in development mode
bun run dev

# Lint (uses oxlint)
bun run lint
bun run lint:fix        # Auto-fix lint issues

# Format (uses Prettier)
bun run format          # Format all files
bun run format:check    # Check formatting without writing

# Type check all packages
bun run typecheck

# Clean all build artifacts and node_modules
bun run clean
```

Note: builds and tests are orchestrated with [Turborepo](https://turbo.build/repo) for caching and parallelism.

## Project Structure

```
podkit/
+-- packages/
|   +-- e2e-tests/       # End-to-end CLI tests
|   +-- gpod-testing/    # Test utilities for iPod environments
|   +-- libgpod-node/    # Native Node.js bindings for libgpod
|   +-- podkit-core/     # Core sync logic, adapters, transcoding
|   +-- podkit-cli/      # Command-line interface
|
+-- tools/
|   +-- gpod-tool/       # C CLI for iPod database operations
|   +-- libgpod-macos/   # macOS build scripts for libgpod
|   +-- lima/            # Lima VM configs for cross-platform testing
|
+-- docs/                # Documentation
+-- test/                # Shared test fixtures
```

## Next Steps

- [Testing](/developers/testing) - Testing strategy and conventions
- [Architecture](/developers/architecture) - Component design
- [ADRs](https://github.com/jvgomg/podkit/tree/main/adr) - Architecture decision records

## Cross-Platform Testing with Lima

[Lima](https://lima-vm.io) runs Linux VMs on macOS for testing podkit on Debian and Alpine. This is used to validate the Linux device manager and ensure the test suite passes on Linux.

### Setup

```bash
brew install lima
```

### Running Tests on Linux

```bash
# Run tests on both Debian and Alpine (creates VMs on first run)
mise run lima:test

# Run on a specific distro
mise run lima:test:debian
mise run lima:test:alpine

# Stop VMs when done (preserves state for fast restart)
mise run lima:stop

# Delete VMs entirely
mise run lima:destroy
```

VMs are created and provisioned automatically on first run. Subsequent runs reuse the existing VMs. See `tools/lima/README.md` for VM details and troubleshooting.

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
pkg-config --variable=pc_path pkg-config
```

### Runtime: library not found

Ensure `DYLD_LIBRARY_PATH` is set:

```bash
echo $DYLD_LIBRARY_PATH
# Should include: /Users/yourname/.local/lib
```
