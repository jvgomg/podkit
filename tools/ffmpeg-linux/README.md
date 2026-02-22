# FFmpeg with libfdk_aac for Linux

Build FFmpeg with the Fraunhofer FDK AAC encoder for higher quality audio transcoding.

## Quick Start

```bash
cd tools/ffmpeg-linux

# Build FFmpeg (auto-detects your architecture)
./build-with-docker.sh

# That's it! podkit will automatically use this FFmpeg.
```

The script:
- Auto-detects your CPU architecture (x86_64 or ARM64)
- Builds FFmpeg with libfdk_aac in a Docker container
- Extracts the binary to `./ffmpeg-build/bin/ffmpeg`

**Requirements:** Docker must be installed and running.

## Why Build a Custom FFmpeg?

| Encoder | Quality | Availability |
|---------|---------|--------------|
| `aac_at` | Excellent | macOS only (built into Homebrew FFmpeg) |
| `libfdk_aac` | Excellent | Requires this custom build |
| `aac` (native) | Very Good | Always available in system FFmpeg |

The native AAC encoder (`apt install ffmpeg`) is good enough for most uses. This custom build is for users who want the best possible audio quality.

## Supported Architectures

```bash
# See available architectures
./build-with-docker.sh --list-archs
```

| Architecture | Description | Common Systems |
|--------------|-------------|----------------|
| `amd64` | x86_64 | Most servers, desktops, WSL |
| `arm64` | ARM64 | Raspberry Pi 4+, AWS Graviton, Apple Silicon VMs |

The script auto-detects your system. Override with `--arch`:

```bash
./build-with-docker.sh --arch amd64   # Force x86_64 build
./build-with-docker.sh --arch arm64   # Force ARM64 build
```

## Usage with podkit

**Automatic:** podkit checks `tools/ffmpeg-linux/ffmpeg-build/bin/ffmpeg` automatically. No configuration needed after building.

**Manual override:** Set the `PODKIT_FFMPEG_PATH` environment variable:

```bash
export PODKIT_FFMPEG_PATH=/path/to/ffmpeg
```

## Build Options

The build script accepts options:

```bash
# Minimal build (just AAC support)
./build-ffmpeg.sh

# Include additional codecs
./build-ffmpeg.sh --full

# Specify install prefix
./build-ffmpeg.sh --prefix=/usr/local
```

## Verify Installation

```bash
# Check for libfdk_aac encoder
./ffmpeg-build/bin/ffmpeg -encoders 2>/dev/null | grep fdk

# Expected output:
#  A....D libfdk_aac           Fraunhofer FDK AAC (codec aac)
```

## Platform Support

| Distribution | Tested | Notes |
|--------------|--------|-------|
| Debian 12+ | Yes | Primary target, tested with Docker |
| Ubuntu 22.04+ | Yes | |
| Fedora 38+ | Partial | Use `dnf` instead of `apt` |
| Alpine | No | Different dependencies |

## Docker Build Options

### Build for Different Architectures

Build for a specific Linux architecture (useful for CI/CD or cross-compilation):

```bash
# Build for x86_64 Linux
./build-with-docker.sh --arch amd64

# Build for ARM64 Linux (e.g., Raspberry Pi 4, AWS Graviton)
./build-with-docker.sh --arch arm64

# Clean up Docker image after build
./build-with-docker.sh --clean
```

### Testing the Build Scripts

Verify the build scripts work without extracting the binary:

```bash
# Run the full test
./test-build.sh

# Clean up test image afterward
./test-build.sh --clean
```

## Troubleshooting

### "libfdk-aac-dev not found"

**On Debian:** The `libfdk-aac-dev` package is in the non-free repository. The install script enables this automatically, but if running manually:

```bash
# Add non-free to your sources (Debian 12+)
sudo sed -i 's/main$/main contrib non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources
sudo apt update
```

**On Ubuntu:** Enable the universe repository:

```bash
sudo add-apt-repository universe
sudo apt update
```

### Build fails with missing dependencies

Run the dependency installer first:

```bash
sudo ./install-deps.sh
```

### Permission denied

Make scripts executable:

```bash
chmod +x *.sh
```

## License Note

libfdk_aac is released under a license incompatible with GPL. Building FFmpeg with `--enable-nonfree --enable-libfdk-aac` creates a binary that cannot be redistributed. This is fine for personal use.
