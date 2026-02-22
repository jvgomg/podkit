# FFmpeg with libfdk_aac for Linux

Build FFmpeg with the Fraunhofer FDK AAC encoder for higher quality audio transcoding.

## Why?

Standard Linux FFmpeg packages (apt, dnf) include only the native AAC encoder due to licensing restrictions. The Fraunhofer FDK AAC encoder (`libfdk_aac`) provides slightly better quality, especially at lower bitrates.

**Note:** The native FFmpeg AAC encoder is good enough for most uses. Only build this if you want the best possible quality.

## Quality Comparison

| Encoder | Quality | Availability |
|---------|---------|--------------|
| `aac_at` | Excellent | macOS only |
| `libfdk_aac` | Excellent | Requires custom build |
| `aac` (native) | Very Good | Always available |

## Quick Start

```bash
# Install dependencies (Debian/Ubuntu)
./install-deps.sh

# Build FFmpeg with libfdk_aac
./build-ffmpeg.sh

# The built ffmpeg is at: ./ffmpeg-build/bin/ffmpeg
```

## Usage with podkit

Set the `PODKIT_FFMPEG_PATH` environment variable:

```bash
export PODKIT_FFMPEG_PATH=/path/to/podkit/tools/ffmpeg-linux/ffmpeg-build/bin/ffmpeg
podkit sync --source ~/Music
```

Or add to your shell profile (`~/.bashrc` or `~/.zshrc`):

```bash
export PODKIT_FFMPEG_PATH="$HOME/path/to/podkit/tools/ffmpeg-linux/ffmpeg-build/bin/ffmpeg"
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
| Ubuntu 22.04+ | Yes | Primary target |
| Debian 12+ | Yes | |
| Fedora 38+ | Partial | Use `dnf` instead of `apt` |
| Alpine | No | Different dependencies |

## Troubleshooting

### "libfdk-aac-dev not found"

On Ubuntu, you may need to enable universe repository:

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
