---
title: Installation
description: Install podkit and its system dependencies on macOS, Linux, or Windows.
sidebar:
  order: 1
---

This guide covers installing podkit and its dependencies on macOS and Linux.

## Prerequisites

Before installing podkit, you need:

- **Node.js 20+** or **Bun** - JavaScript runtime ([nodejs.org](https://nodejs.org/) or [bun.sh](https://bun.sh/))
- **FFmpeg** - Audio transcoding (FLAC to AAC)
- **libgpod** - iPod database library
- **A supported iPod** - See [Supported Devices](/devices/supported-devices)

> **Note:** iOS devices (iPod Touch, iPhone, iPad) are not supported. podkit works with classic iPods that use USB Mass Storage mode.

## Step 1: Install Node.js or Bun

podkit runs on Node.js 20+ or Bun. Install whichever you prefer:

### Node.js

#### macOS

```bash
brew install node
```

#### Ubuntu/Debian

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

#### Fedora

```bash
sudo dnf install nodejs
```

Verify: `node --version` (should show v20.x or higher)

### Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

Verify: `bun --version`

## Step 2: Install System Dependencies

### macOS

```bash
# Install FFmpeg
brew install ffmpeg

# Build and install libgpod (not available in Homebrew)
# Clone podkit first, then run the build script:
git clone https://github.com/jvgomg/podkit.git
cd podkit/tools/libgpod-macos
./build.sh
```

The build script installs libgpod to `~/.local`. Add to your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
export PKG_CONFIG_PATH="$HOME/.local/lib/pkgconfig:$PKG_CONFIG_PATH"
export DYLD_LIBRARY_PATH="$HOME/.local/lib:$DYLD_LIBRARY_PATH"
```

Reload your shell:

```bash
source ~/.zshrc  # or ~/.bashrc
```

### Ubuntu/Debian

```bash
sudo apt update
sudo apt install -y libgpod-dev ffmpeg
```

### Fedora

```bash
# Enable RPM Fusion for FFmpeg
sudo dnf install -y \
    https://download1.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm

sudo dnf install -y libgpod-devel ffmpeg
```

### Arch Linux

```bash
sudo pacman -S libgpod ffmpeg
```

## Step 3: Install podkit

```bash
npm install -g podkit
# or
bun install -g podkit
```

Verify installation:

```bash
podkit --version
```

## Verify Your Setup

Run these commands to confirm everything is working:

```bash
# Check FFmpeg
ffmpeg -version | head -1

# Check FFmpeg has AAC support
ffmpeg -encoders 2>/dev/null | grep aac

# Check libgpod (macOS/Linux)
pkg-config --modversion libgpod-1.0

# Check podkit
podkit --version
```

## Next Steps

Once installed, continue to:

- [Quick Start](/getting-started/quick-start) - Get syncing in 5 minutes
- [First Sync](/getting-started/first-sync) - Detailed walkthrough of your first sync
