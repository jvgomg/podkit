# Development Environment Setup

This guide covers setting up a development environment for podkit on macOS, Linux, and Windows.

## Overview

podkit requires the following dependencies:

| Dependency | Purpose | Required |
|------------|---------|----------|
| **Bun** | JavaScript runtime and package manager | Yes |
| **libgpod** | C library for iPod database access | Yes |
| **FFmpeg** | Audio transcoding (FLAC → AAC) | Yes |
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

libgpod is not available in Homebrew, so we build from source. The podkit repo includes a build script that handles this:

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

### Troubleshooting (macOS)

#### libgpod build fails

Ensure Homebrew packages are properly linked:
```bash
brew link --force libplist gdk-pixbuf gettext
```

#### pkg-config can't find libgpod

Verify your `PKG_CONFIG_PATH` includes `~/.local/lib/pkgconfig`:
```bash
echo $PKG_CONFIG_PATH
pkg-config --variable=pc_path pkg-config
```

#### Runtime: library not found

Ensure `DYLD_LIBRARY_PATH` is set:
```bash
echo $DYLD_LIBRARY_PATH
# Should include: /Users/yourname/.local/lib
```

---

## Linux

### Debian / Ubuntu

#### Step 1: Install System Dependencies

```bash
sudo apt update
sudo apt install -y \
    libgpod-dev \
    ffmpeg \
    libglib2.0-dev \
    libplist-dev \
    libgdk-pixbuf2.0-dev \
    pkg-config
```

#### Step 2: Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

Or via npm (if Node.js is installed):
```bash
npm install -g bun
```

#### Step 3: Verify Installation

```bash
# Check Bun
bun --version

# Check FFmpeg with AAC support
ffmpeg -encoders 2>/dev/null | grep aac

# Check libgpod
pkg-config --modversion libgpod-1.0
```

### Fedora / RHEL

#### Step 1: Install System Dependencies

```bash
sudo dnf install -y \
    libgpod-devel \
    ffmpeg \
    glib2-devel \
    libplist-devel \
    gdk-pixbuf2-devel \
    pkg-config
```

Note: FFmpeg may require enabling RPM Fusion repositories:
```bash
sudo dnf install -y \
    https://download1.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm
sudo dnf install -y ffmpeg
```

#### Step 2: Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

#### Step 3: Verify Installation

```bash
bun --version
ffmpeg -encoders 2>/dev/null | grep aac
pkg-config --modversion libgpod-1.0
```

### Arch Linux

```bash
sudo pacman -S libgpod ffmpeg glib2 libplist gdk-pixbuf2 pkg-config
curl -fsSL https://bun.sh/install | bash
```

### Troubleshooting (Linux)

#### libgpod-dev not found

On older distributions, libgpod may not be in the default repositories. You can build from source using the same approach as macOS:

```bash
# Install build dependencies
sudo apt install -y \
    libplist-dev \
    libgdk-pixbuf2.0-dev \
    intltool \
    autoconf \
    automake \
    libtool \
    gtk-doc-tools \
    pkg-config

# Use the macOS build script (works on Linux too)
cd tools/libgpod-macos
./build.sh
```

#### FFmpeg without AAC support

Some distributions ship FFmpeg without AAC due to licensing. Install from a third-party repo or build from source with `--enable-libfdk-aac` or use the native `aac` encoder.

---

## Windows

> **Status: TBD**
>
> Windows support is planned but not yet documented. Key challenges:
>
> - libgpod has limited Windows support and may require significant porting effort
> - Native Node.js bindings need Windows build toolchain (MSVC or MinGW)
> - iPod device access on Windows differs from Unix (no `/dev` nodes)
>
> Potential approaches being considered:
> - WSL2 (Windows Subsystem for Linux) as primary development environment
> - Native Windows build with vcpkg or Conan for dependencies
> - Docker-based development environment
>
> If you're interested in Windows support, please open an issue or contribute!

---

## Docker Development Environment

For a consistent cross-platform experience, you can use Docker:

```bash
# Build the development image
docker build -t podkit-dev -f Dockerfile.dev .

# Run with source mounted
docker run -it -v $(pwd):/workspace podkit-dev
```

> Note: Docker development image is planned but not yet implemented.

---

## Next Steps

After setting up your environment:

1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/your-org/podkit.git
   cd podkit
   bun install
   ```

2. Run the test suite:
   ```bash
   bun test
   ```

3. See [ARCHITECTURE.md](ARCHITECTURE.md) for codebase structure
4. See [../AGENTS.md](../AGENTS.md) for development workflow

## Getting Help

- Check [Troubleshooting](#troubleshooting-macos) sections above
- Open an issue on GitHub
- See [LIBGPOD.md](LIBGPOD.md) for libgpod-specific issues
