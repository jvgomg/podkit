#!/usr/bin/env bash
#
# Build FFmpeg with libfdk_aac support for podkit
#
# This creates a local FFmpeg build with the Fraunhofer FDK AAC encoder.
# The resulting binary is for personal use only (non-redistributable due to licensing).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FFMPEG_VERSION="7.1"
BUILD_DIR="$SCRIPT_DIR/ffmpeg-build"
SRC_DIR="$SCRIPT_DIR/ffmpeg-src"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# Parse arguments
FULL_BUILD=false
PREFIX=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --full)
            FULL_BUILD=true
            shift
            ;;
        --prefix=*)
            PREFIX="${1#*=}"
            shift
            ;;
        --prefix)
            PREFIX="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --full          Include additional codecs (mp3, opus, vorbis)"
            echo "  --prefix=PATH   Install to PATH instead of local directory"
            echo "  -h, --help      Show this help message"
            exit 0
            ;;
        *)
            error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Set build prefix
if [[ -z "$PREFIX" ]]; then
    PREFIX="$BUILD_DIR"
fi

# Check for required tools
check_dependencies() {
    local missing=()

    for cmd in gcc make pkg-config yasm wget; do
        if ! command -v "$cmd" &> /dev/null; then
            missing+=("$cmd")
        fi
    done

    # Check for libfdk-aac
    if ! pkg-config --exists fdk-aac 2>/dev/null; then
        missing+=("libfdk-aac-dev")
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        error "Missing dependencies: ${missing[*]}"
        echo ""
        echo "Install them with:"
        echo "  sudo ./install-deps.sh"
        exit 1
    fi
}

# Download FFmpeg source
download_ffmpeg() {
    if [[ -d "$SRC_DIR/ffmpeg-$FFMPEG_VERSION" ]]; then
        info "FFmpeg source already downloaded"
        return
    fi

    info "Downloading FFmpeg $FFMPEG_VERSION..."
    mkdir -p "$SRC_DIR"
    cd "$SRC_DIR"

    wget -q --show-progress \
        "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz" \
        -O "ffmpeg-$FFMPEG_VERSION.tar.xz"

    info "Extracting..."
    tar xf "ffmpeg-$FFMPEG_VERSION.tar.xz"
    rm "ffmpeg-$FFMPEG_VERSION.tar.xz"
}

# Configure FFmpeg
configure_ffmpeg() {
    cd "$SRC_DIR/ffmpeg-$FFMPEG_VERSION"

    info "Configuring FFmpeg..."

    local configure_opts=(
        --prefix="$PREFIX"
        --enable-gpl
        --enable-nonfree
        --enable-libfdk-aac
        --disable-doc
        --disable-htmlpages
        --disable-manpages
        --disable-podpages
        --disable-txtpages
        # Disable unnecessary components for audio-only use
        --disable-ffplay
        --disable-network
        --disable-devices
        --disable-filters
        --enable-filter=aresample
        --enable-filter=volume
        # Keep only necessary demuxers/muxers
        --disable-demuxers
        --enable-demuxer=flac
        --enable-demuxer=wav
        --enable-demuxer=aiff
        --enable-demuxer=mp3
        --enable-demuxer=ogg
        --enable-demuxer=mov
        --disable-muxers
        --enable-muxer=ipod
        --enable-muxer=mp4
        --enable-muxer=mov
        # Keep only necessary decoders/encoders
        --disable-decoders
        --enable-decoder=flac
        --enable-decoder=alac
        --enable-decoder=pcm_s16le
        --enable-decoder=pcm_s24le
        --enable-decoder=pcm_s32le
        --enable-decoder=mp3
        --enable-decoder=vorbis
        --enable-decoder=aac
        --disable-encoders
        --enable-encoder=libfdk_aac
        --enable-encoder=aac
        # Disable video/subtitle
        --disable-swscale
        --disable-postproc
        --disable-bsfs
    )

    if $FULL_BUILD; then
        info "Full build: including additional codecs..."
        configure_opts+=(
            --enable-libmp3lame
            --enable-libopus
            --enable-libvorbis
            --enable-encoder=libmp3lame
            --enable-encoder=libopus
            --enable-encoder=libvorbis
            --enable-decoder=opus
        )
    fi

    ./configure "${configure_opts[@]}"
}

# Build FFmpeg
build_ffmpeg() {
    cd "$SRC_DIR/ffmpeg-$FFMPEG_VERSION"

    local nproc
    nproc=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)

    info "Building FFmpeg (using $nproc cores)..."
    make -j"$nproc"

    info "Installing to $PREFIX..."
    make install
}

# Verify build
verify_build() {
    local ffmpeg_bin="$PREFIX/bin/ffmpeg"

    if [[ ! -x "$ffmpeg_bin" ]]; then
        error "Build failed: $ffmpeg_bin not found"
        exit 1
    fi

    info "Verifying libfdk_aac support..."
    if "$ffmpeg_bin" -encoders 2>/dev/null | grep -q libfdk_aac; then
        info "libfdk_aac encoder available!"
    else
        warn "libfdk_aac encoder not found in build"
    fi

    echo ""
    echo "============================================"
    echo -e "${GREEN}Build successful!${NC}"
    echo "============================================"
    echo ""
    echo "FFmpeg binary: $ffmpeg_bin"
    echo ""
    echo "To use with podkit, set:"
    echo "  export PODKIT_FFMPEG_PATH=\"$ffmpeg_bin\""
    echo ""
    echo "Available AAC encoders:"
    "$ffmpeg_bin" -encoders 2>/dev/null | grep -E "aac|fdk" | sed 's/^/  /'
}

# Cleanup source files
cleanup() {
    if [[ -d "$SRC_DIR" ]]; then
        info "Cleaning up source files..."
        rm -rf "$SRC_DIR"
    fi
}

main() {
    info "Building FFmpeg $FFMPEG_VERSION with libfdk_aac"
    info "Build directory: $PREFIX"
    echo ""

    check_dependencies
    download_ffmpeg
    configure_ffmpeg
    build_ffmpeg
    verify_build

    echo ""
    read -rp "Remove source files to save space? [y/N] " response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        cleanup
    fi
}

main "$@"
