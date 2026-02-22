#!/usr/bin/env bash
#
# Build FFmpeg with libfdk_aac using Docker
#
# This script builds FFmpeg inside a Debian container and extracts
# the binary to your local machine. The binary is placed at:
#   tools/ffmpeg-linux/ffmpeg-build/bin/ffmpeg
#
# podkit will automatically detect and use this FFmpeg when available.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_NAME="podkit-ffmpeg-builder"
CONTAINER_NAME="podkit-ffmpeg-build-$$"
OUTPUT_DIR="$SCRIPT_DIR/ffmpeg-build"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# Detect current system architecture
detect_arch() {
    local arch
    arch=$(uname -m)

    case "$arch" in
        x86_64|amd64)
            echo "amd64"
            ;;
        aarch64|arm64)
            echo "arm64"
            ;;
        armv7l)
            echo "arm/v7"
            ;;
        *)
            echo "$arch"
            ;;
    esac
}

# Check for Docker
check_docker() {
    if ! command -v docker &> /dev/null; then
        error "Docker is not installed or not in PATH"
        echo ""
        echo "Install Docker:"
        echo "  macOS:  brew install --cask docker"
        echo "  Ubuntu: sudo apt install docker.io"
        echo "  Fedora: sudo dnf install docker"
        exit 1
    fi

    if ! docker info &> /dev/null; then
        error "Docker daemon is not running"
        echo ""
        echo "Start Docker and try again"
        exit 1
    fi
}

# Parse arguments
CLEAN=false
ARCH=""
SHOW_ARCHS=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --clean)
            CLEAN=true
            shift
            ;;
        --arch)
            ARCH="$2"
            shift 2
            ;;
        --list-archs)
            SHOW_ARCHS=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Build FFmpeg with libfdk_aac using Docker."
            echo "The built binary will be placed in ./ffmpeg-build/bin/"
            echo ""
            echo "By default, builds for your current system architecture."
            echo ""
            echo "Options:"
            echo "  --arch ARCH    Build for specific architecture"
            echo "  --list-archs   Show available architectures"
            echo "  --clean        Remove build image after extraction"
            echo "  -h, --help     Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                    # Auto-detect and build"
            echo "  $0 --arch amd64       # Build for x86_64 Linux"
            echo "  $0 --arch arm64       # Build for ARM64 Linux"
            exit 0
            ;;
        *)
            error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Show available architectures
if $SHOW_ARCHS; then
    echo "Available architectures:"
    echo ""
    echo "  amd64   x86_64 Linux (most servers, desktops, WSL)"
    echo "  arm64   ARM64 Linux (Raspberry Pi 4+, AWS Graviton, Apple Silicon VMs)"
    echo ""
    echo "Your system: $(detect_arch)"
    exit 0
fi

# Auto-detect architecture if not specified
if [[ -z "$ARCH" ]]; then
    ARCH=$(detect_arch)
fi

# Build the Docker image
build_image() {
    info "Building FFmpeg for linux/$ARCH..."

    cd "$SCRIPT_DIR"
    docker build --platform "linux/$ARCH" -t "$IMAGE_NAME" .
}

# Extract the built FFmpeg
extract_build() {
    info "Extracting built FFmpeg..."

    # Remove old build if exists
    if [[ -d "$OUTPUT_DIR" ]]; then
        warn "Removing existing build directory..."
        rm -rf "$OUTPUT_DIR"
    fi

    # Create container (don't start it)
    docker create --name "$CONTAINER_NAME" "$IMAGE_NAME" /bin/true

    # Copy build artifacts
    docker cp "$CONTAINER_NAME:/build/ffmpeg-build" "$OUTPUT_DIR"

    # Cleanup container
    docker rm "$CONTAINER_NAME" > /dev/null

    info "Build extracted to: $OUTPUT_DIR"
}

# Show build info
show_info() {
    echo ""
    echo "========================================"
    echo -e "  ${GREEN}Build complete!${NC}"
    echo "========================================"
    echo ""
    echo -e "Architecture:  ${CYAN}linux/$ARCH${NC}"
    echo -e "FFmpeg:        ${CYAN}$OUTPUT_DIR/bin/ffmpeg${NC}"
    echo -e "FFprobe:       ${CYAN}$OUTPUT_DIR/bin/ffprobe${NC}"
    echo ""

    # Show version if we can run it (same arch)
    if [[ -x "$OUTPUT_DIR/bin/ffmpeg" ]] && "$OUTPUT_DIR/bin/ffmpeg" -version &> /dev/null; then
        echo "Version:"
        "$OUTPUT_DIR/bin/ffmpeg" -version | head -1
        echo ""
        echo "AAC encoders:"
        "$OUTPUT_DIR/bin/ffmpeg" -encoders 2>/dev/null | grep -E "aac|fdk" | sed 's/^/  /'
        echo ""
        echo -e "${GREEN}podkit will automatically use this FFmpeg.${NC}"
    else
        echo "Note: Binary is for Linux ($ARCH) - verify on target system:"
        echo "  ./tools/ffmpeg-linux/ffmpeg-build/bin/ffmpeg -encoders | grep fdk"
        echo ""
        echo "Copy to your Linux system and podkit will auto-detect it."
    fi
}

main() {
    echo ""
    echo "========================================"
    echo "  FFmpeg Build (with libfdk_aac)"
    echo "========================================"
    echo ""
    echo "This builds FFmpeg with the high-quality Fraunhofer AAC encoder."
    echo ""

    check_docker

    echo -e "Detected architecture: ${CYAN}$ARCH${NC}"
    echo ""

    build_image
    extract_build

    if $CLEAN; then
        info "Cleaning up build image..."
        docker rmi "$IMAGE_NAME" > /dev/null 2>&1 || true
    fi

    show_info
}

main "$@"
