---
title: Development Setup
description: Set up a development environment for contributing to podkit.
sidebar:
  order: 2
---

# Development Environment Setup

This guide covers setting up a development environment for podkit on macOS, Linux, and Windows.

## Overview

podkit requires the following dependencies:

| Dependency | Purpose | Required |
|------------|---------|----------|
| **Bun** | JavaScript runtime and package manager | Yes |
| **libgpod** | C library for iPod database access | Yes |
| **FFmpeg** | Audio transcoding (FLAC to AAC) | Yes |
| **GLib 2.0** | C utility library (libgpod dependency) | Yes |
| **libplist** | Apple property list library (libgpod dependency) | Yes |
| **gdk-pixbuf** | Image handling for album artwork | Yes |

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
|
+-- docs/                # Documentation
+-- test/                # Shared test fixtures
```

## Next Steps

- [Testing](/developers/testing) - Testing strategy and conventions
- [Architecture](/developers/architecture) - Component design
- [ADRs](/developers/adr/) - Architecture decision records

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
