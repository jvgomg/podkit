#!/usr/bin/env bash
#
# Test the FFmpeg build scripts using Docker
#
# This script builds a Docker image that tests the build process
# on a clean Debian system, verifying that:
# - Dependencies install correctly
# - FFmpeg builds with libfdk_aac
# - Transcoding produces valid output
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_NAME="podkit-ffmpeg-test"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# Check for Docker
check_docker() {
    if ! command -v docker &> /dev/null; then
        error "Docker is not installed or not in PATH"
        echo ""
        echo "Install Docker:"
        echo "  macOS: brew install --cask docker"
        echo "  Linux: https://docs.docker.com/engine/install/"
        exit 1
    fi

    if ! docker info &> /dev/null; then
        error "Docker daemon is not running"
        echo ""
        echo "Start Docker and try again"
        exit 1
    fi
}

# Build the test image
build_image() {
    info "Building Docker test image..."
    info "This will test the build scripts on Debian 12 (bookworm)"
    echo ""

    cd "$SCRIPT_DIR"

    if docker build -t "$IMAGE_NAME" .; then
        echo ""
        info "Docker build successful!"
        return 0
    else
        echo ""
        error "Docker build failed!"
        return 1
    fi
}

# Run the test container
run_test() {
    info "Running test container..."
    echo ""
    docker run --rm "$IMAGE_NAME"
}

# Parse arguments
CLEAN=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --clean)
            CLEAN=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Test the FFmpeg build scripts using Docker."
            echo ""
            echo "Options:"
            echo "  --clean    Remove the test image after running"
            echo "  -h, --help Show this help message"
            exit 0
            ;;
        *)
            error "Unknown option: $1"
            exit 1
            ;;
    esac
done

main() {
    echo ""
    echo "========================================"
    echo "  FFmpeg Build Script Test (Docker)"
    echo "========================================"
    echo ""

    check_docker

    if build_image; then
        echo ""
        echo "========================================"
        echo "  Build Verification"
        echo "========================================"
        echo ""
        run_test

        echo ""
        echo "========================================"
        echo -e "  ${GREEN}All tests passed!${NC}"
        echo "========================================"
        echo ""

        if $CLEAN; then
            info "Cleaning up test image..."
            docker rmi "$IMAGE_NAME" > /dev/null
        else
            echo "Test image retained: $IMAGE_NAME"
            echo "Remove with: docker rmi $IMAGE_NAME"
        fi
    else
        echo ""
        echo "========================================"
        echo -e "  ${RED}Build failed!${NC}"
        echo "========================================"
        echo ""
        echo "Check the output above for errors."
        echo "Common issues:"
        echo "  - Network problems downloading FFmpeg"
        echo "  - Missing dependencies in install-deps.sh"
        echo "  - Build configuration errors"
        exit 1
    fi
}

main "$@"
